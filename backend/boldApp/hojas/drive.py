from copy import deepcopy
from datetime import timedelta
from functools import partial
from hashlib import md5
import json
import uuid
from types import SimpleNamespace

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError

from boldApp.workspace.service import google, metadata, file_id
from .access import require_file
from .document import blocks, decorate, validate_document
from .engine import export, import_file, directory
from .models import ImportReview, Revision, Workbook
from .operations import Conflict, mark_pending, publish
from .task_bridge import apply_tasks

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
EXTERNAL = "Incorporando cambios de Drive…"


def error_message(exc, fallback):
    detail = getattr(exc, "detail", fallback)
    if isinstance(detail, dict):
        detail = detail.get("detail", fallback)
    return str(detail)


def remember_base(workbook, document, revision):
    workbook.versions.filter(reason="drive_base").delete()
    Revision.objects.create(workbook=workbook, revision=revision, document=document, reason="drive_base")


def valid_folder(user, folder):
    folder = file_id(folder)
    data = metadata(user, folder)
    if data.get("trashed") or data.get("mimeType") != "application/vnd.google-apps.folder" or not data.get("capabilities", {}).get("canAddChildren"):
        raise ValidationError("Selecciona una carpeta de Drive donde puedas guardar archivos.")
    return data["id"]


@transaction.atomic
def bind(workbook_id, request, folder):
    workbook = Workbook.objects.select_for_update().get(pk=workbook_id)
    require_file(request.assignment, workbook, "edit")
    if workbook.owner_id != request.user.id:
        raise PermissionDenied("Solo quien creó el archivo puede elegir su destino de Drive.")
    workbook.drive_folder = valid_folder(request.user, folder)
    if not workbook.drive_id:
        reserved = google(request.user, "GET", "/files/generateIds", params={"count": 1, "space": "drive", "type": "files"})
        workbook.drive_id = reserved["ids"][0]
    workbook.drive_account = request.user
    workbook.revision += 1
    mark_pending(workbook)
    workbook.save()
    return workbook


def raw_metadata(workbook):
    response = google(workbook.drive_account, "GET", "/files/" + file_id(workbook.drive_id), params={"fields": "id,name,parents,version,md5Checksum,trashed,size,webViewLink,appProperties,capabilities", "supportsAllDrives": "true"}, raw=True)
    return response.json(), response.headers.get("ETag")


def accept_metadata(workbook, data):
    workbook.drive_created = True
    workbook.drive_version = str(data.get("version", ""))
    workbook.drive_checksum = data.get("md5Checksum", "")
    workbook.drive_url = data.get("webViewLink") or "https://drive.google.com/file/d/" + workbook.drive_id + "/view"


def matches_upload(workbook, data):
    return bool(workbook.upload_checksum) and data.get("md5Checksum") == workbook.upload_checksum and data.get("appProperties", {}).get("boldWorkbook") == str(workbook.id) and data.get("appProperties", {}).get("boldRevision") == str(workbook.upload_revision) and data.get("name") == workbook.upload_name + ".xlsx" and workbook.upload_folder in data.get("parents", [])


def confirms_upload(workbook, data):
    return workbook.upload_uncertain and matches_upload(workbook, data)


@transaction.atomic
def check_external(workbook_id, assignment):
    workbook = Workbook.objects.select_for_update(of=("self",)).select_related("drive_account", "creator__employee__user_account", "creator__position__unit", "creator__position__job_role").get(pk=workbook_id)
    require_file(assignment, workbook)
    if not workbook.drive_account_id or not workbook.drive_created:
        return workbook
    if workbook.lease_until and workbook.lease_until > timezone.now():
        return workbook
    try:
        data, _ = raw_metadata(workbook)
        if data.get("trashed") or not data.get("capabilities", {}).get("canEdit"):
            raise PermissionDenied("El archivo de Drive fue eliminado o ya no permite edición.")
        if confirms_upload(workbook, data):
            accept_metadata(workbook, data)
            workbook.upload_uncertain = False
            workbook.synced_revision = workbook.upload_revision
            workbook.sync_error, workbook.attempts = "", 0
            if workbook.revision == workbook.upload_revision:
                workbook.sync_state, workbook.sync_after, workbook.pending_since = "current", None, None
            else:
                workbook.sync_state = "pending"
                mark_pending(workbook)
        elif str(data.get("version", "")) != workbook.drive_version:
            if data.get("md5Checksum") and data["md5Checksum"] == workbook.drive_checksum:
                accept_metadata(workbook, data)
            else:
                workbook.sync_state, workbook.sync_error = "importing", ""
                workbook.sync_after = timezone.now() + timedelta(seconds=1)
                from .tasks import enqueue
                transaction.on_commit(partial(enqueue, str(workbook.pk), workbook.sync_after))
    except (NotFound, PermissionDenied) as exc:
        workbook.sync_state, workbook.sync_error, workbook.sync_after = "error", error_message(exc, "No se pudo consultar Drive."), None
    workbook.save()
    return workbook


def sync(workbook_id, lease=None):
    claimed = lease is not None
    lease = lease or uuid.uuid4()
    with transaction.atomic():
        workbook = Workbook.objects.select_for_update(of=("self",)).select_related("drive_account", "creator__employee__user_account", "creator__position__unit", "creator__position__job_role").get(pk=workbook_id)
        now = timezone.now()
        if workbook.deleted_at or not workbook.drive_account_id or workbook.sync_state in {"external", "unbound", "current"} or workbook.sync_after and workbook.sync_after > now or claimed and workbook.sync_lease != lease or not claimed and workbook.lease_until and workbook.lease_until > now:
            return
        workbook.sync_lease, workbook.lease_until = lease, now + timedelta(seconds=120)
        workbook.sync_state = "syncing"
        workbook.save(update_fields=["sync_lease", "lease_until", "sync_state"])
        revision = workbook.revision
    publish(workbook.id, {"sync_state": "syncing"})
    try:
        require_file(workbook.creator, workbook, "export")
        require_file(workbook.creator, workbook, "edit")
        if not workbook.drive_account.is_active:
            raise PermissionDenied("La cuenta de destino no está activa.")
        content = export(workbook)
        checksum = md5(content).hexdigest()
        try:
            data, etag = raw_metadata(workbook)
        except NotFound:
            if workbook.drive_created:
                raise PermissionDenied("El archivo de Drive fue eliminado. La sincronización se pausó; no se creará una copia.")
            data, etag = None, None
        if data:
            if data.get("trashed") or not data.get("capabilities", {}).get("canEdit"):
                raise PermissionDenied("El archivo fue eliminado o ya no permite edición.")
            if not workbook.drive_created:
                if not confirms_upload(workbook, data):
                    raise Conflict(EXTERNAL)
                accept_metadata(workbook, data)
            elif str(data.get("version", "")) != workbook.drive_version and not confirms_upload(workbook, data):
                raise Conflict(EXTERNAL)
        # Persist the intended checksum before uncertain network responses or worker restarts.
        with transaction.atomic():
            current = Workbook.objects.select_for_update().get(pk=workbook_id)
            if current.sync_lease != lease:
                return
            if current.deleted_at or current.sync_state == "external":
                current.sync_lease, current.lease_until = None, None
                current.save(update_fields=["sync_lease", "lease_until"])
                return
            current.upload_checksum = checksum
            current.upload_uncertain = True
            current.upload_revision, current.upload_name, current.upload_folder = revision, workbook.name, workbook.drive_folder
            current.save(update_fields=["upload_checksum", "upload_uncertain", "upload_revision", "upload_name", "upload_folder"])
        require_file(workbook.creator, workbook, "edit")
        body = {"name": workbook.name + ".xlsx", "mimeType": XLSX, "appProperties": {"boldWorkbook": str(workbook.id), "boldRevision": str(revision)}}
        params = {"uploadType": "multipart", "fields": "id,name,version,md5Checksum,webViewLink", "supportsAllDrives": "true"}
        if data:
            parents = data.get("parents", [])
            if workbook.drive_folder not in parents:
                params["addParents"] = workbook.drive_folder
                if parents:
                    params["removeParents"] = ",".join(parents)
            path, method = "/files/" + workbook.drive_id, "PATCH"
        else:
            body.update(id=workbook.drive_id, parents=[workbook.drive_folder])
            path, method = "/files", "POST"
        google(workbook.drive_account, method, path, api="upload", params=params, files={"metadata": (None, json.dumps(body), "application/json; charset=UTF-8"), "file": (workbook.name + ".xlsx", content, XLSX)}, extra_headers={"If-Match": etag} if etag else None)
        verified, _ = raw_metadata(workbook)
        with transaction.atomic():
            current = Workbook.objects.select_for_update().get(pk=workbook_id)
            if current.sync_lease != lease:
                return
            if verified.get("trashed") or not verified.get("capabilities", {}).get("canEdit"):
                raise PermissionDenied("El archivo fue eliminado o ya no permite edición.")
            if not matches_upload(current, verified):
                raise Conflict(EXTERNAL)
            accept_metadata(current, verified)
            current.upload_uncertain = False
            current.synced_revision = revision
            remember_base(current, workbook.document, revision)
            current.sync_error, current.attempts = "", 0
            current.pending_since = None if current.revision == revision else current.pending_since
            current.sync_after = None if current.revision == revision else timezone.now() + timedelta(seconds=3)
            current.sync_state = "current" if current.revision == revision else "pending"
            current.sync_lease, current.lease_until = None, None
            current.save()
            if current.sync_after:
                from .tasks import enqueue
                transaction.on_commit(partial(enqueue, str(current.id), current.sync_after))
        publish(workbook.id, {"sync_state": current.sync_state, "synced_revision": revision})
    except Exception as exc:
        with transaction.atomic():
            current = Workbook.objects.select_for_update().get(pk=workbook_id)
            if current.sync_lease != lease:
                return
            current.attempts += 1
            external = isinstance(exc, Conflict) or getattr(exc, "google_code", "") == "precondition_failed"
            terminal = isinstance(exc, (PermissionDenied, NotFound)) or external
            current.sync_state = "importing" if external else "error"
            current.sync_error = "" if external else error_message(exc, "No se pudo sincronizar Drive. Reintenta; tus datos siguen guardados.")
            current.sync_after = timezone.now() + timedelta(seconds=3) if external else timezone.now() + timedelta(seconds=min(300, 15 * 2 ** current.attempts)) if not terminal and current.attempts < 5 else None
            current.sync_lease, current.lease_until = None, None
            current.save()
            if current.sync_after:
                from .tasks import enqueue
                transaction.on_commit(partial(enqueue, str(current.id), current.sync_after))
        publish(workbook.id, {"sync_state": current.sync_state, "sync_error": current.sync_error})


def review_external(workbook, request):
    require_file(request.assignment, workbook, "edit")
    require_file(request.assignment, workbook, "export")
    if not workbook.drive_created:
        raise ValidationError("Este archivo todavía no se guardó en Drive.")
    before, _ = raw_metadata(workbook)
    if before.get("trashed"):
        raise ValidationError("El archivo fue eliminado de Drive.")
    if before.get("size") and int(before["size"]) > 20_000_000:
        raise ValidationError("Máximo de 20 MB por archivo Excel.")
    content = google(workbook.drive_account, "GET", "/files/" + workbook.drive_id, params={"alt": "media", "supportsAllDrives": "true"}, raw=True).content
    result = import_file(workbook, content)
    after, _ = raw_metadata(workbook)
    if before["version"] != after["version"]:
        raise Conflict("Drive cambió durante la revisión. Vuelve a revisar esa versión.")
    return ImportReview.objects.create(workbook=workbook, reviewer=request.user, drive_version=str(after["version"]), drive_checksum=after.get("md5Checksum", ""), base_revision=workbook.revision, document=result["document"], excel_content=content, issues=result["issues"], changes=result["changes"])


def update_external(workbook_id, lease):
    from .drive_merge import merge_documents
    from .tasks import enqueue
    workbook = Workbook.objects.select_related("drive_account", "creator__employee__user_account", "creator__position__unit", "creator__position__job_role").get(pk=workbook_id)
    request = SimpleNamespace(assignment=workbook.creator, user=workbook.creator.employee.user_account, data={}, META={}, auth=None)
    review = None
    try:
        require_file(request.assignment, workbook, "edit")
        review = review_external(workbook, request)
        if review.issues:
            raise ValidationError("La actualización de Drive necesita resolver identificadores, personas u opciones ambiguas. Conservamos ambas versiones.")
        baseline = workbook.versions.filter(reason="drive_base", revision=workbook.synced_revision).first()
        data, _ = raw_metadata(workbook)
        with transaction.atomic():
            current = Workbook.objects.select_for_update().get(pk=workbook_id)
            if current.sync_lease != lease:
                return
            if str(data["version"]) != review.drive_version:
                current.sync_state, current.sync_after = "importing", timezone.now() + timedelta(seconds=3)
                current.save(update_fields=["sync_state", "sync_after"])
                transaction.on_commit(partial(enqueue, str(current.pk), current.sync_after))
                return
            cell_conflicts = []
            if not baseline and current.revision != current.synced_revision:
                # Without a common base, keep BOLD and archive the incoming file before uploading.
                merged = deepcopy(current.document)
                cell_conflicts.append("Archivo")
            else:
                merged = merge_documents(baseline.document if baseline else workbook.document, current.document, review.document, cell_conflicts=cell_conflicts, chart_preference="local", prefer_local=True)
            validate_document(merged)
            Revision.objects.create(workbook=current, revision=current.revision, document=current.document, excel_content=current.excel_content, reason="before_drive_import")
            if cell_conflicts:
                Revision.objects.create(workbook=current, revision=current.revision, document=review.document, excel_content=review.excel_content, reason="drive_conflict")
            previous = current.document
            current.document = merged
            apply_tasks(current, previous, request)
            current.revision += 1
            current.excel_content = review.excel_content
            current.excel_revision = current.revision if merged == review.document else 0
            accept_metadata(current, data)
            current.upload_uncertain = False
            current.sync_error, current.attempts = "", 0
            current.sync_state = "current"
            current.synced_revision = current.revision
            current.sync_after, current.pending_since = None, None
            remember_base(current, review.document, current.revision)
            if merged != review.document:
                mark_pending(current)
            current.save()
            review.applied_at = timezone.now()
            review.save(update_fields=["applied_at"])
            from boldApp.administrativo.services import record_system_event
            record_system_event("sheets.drive_import", request, module_code="sheets", target_type="workbook", target_id=current.id, metadata={"review": str(review.id), "automatic": True, "drive_version": review.drive_version, "retained_cells": cell_conflicts})
            transaction.on_commit(partial(publish, current.id, {"revision": current.revision, "source": "drive", "sync_state": current.sync_state}))
    except Exception as exc:
        message = error_message(exc, "No se pudo incorporar el Excel de Drive. Tus cambios siguen guardados; reintenta.")
        with transaction.atomic():
            current = Workbook.objects.select_for_update().get(pk=workbook_id)
            if current.sync_lease != lease:
                return
            current.sync_state, current.sync_error, current.sync_after = "error", message, None
            current.save(update_fields=["sync_state", "sync_error", "sync_after"])
        publish(workbook_id, {"sync_state": "error", "sync_error": message})


@transaction.atomic
def apply_review(workbook_id, review_id, request):
    workbook = Workbook.objects.select_for_update().get(pk=workbook_id)
    require_file(request.assignment, workbook, "edit")
    require_file(request.assignment, workbook, "assign")
    review = ImportReview.objects.select_for_update().get(pk=review_id, workbook=workbook, reviewer=request.user)
    if review.applied_at:
        return workbook
    if workbook.lease_until and workbook.lease_until > timezone.now():
        raise Conflict("Hay una sincronización en curso. Espera a que termine y vuelve a aplicar la revisión.")
    data, _ = raw_metadata(workbook)
    if str(data["version"]) != review.drive_version or workbook.revision != review.base_revision or timezone.now() - review.created_at > timedelta(minutes=30):
        raise Conflict("Drive o BOLD cambió después de la revisión. Vuelve a revisar; conservamos tus datos.")
    document = deepcopy(review.document)
    resolutions = request.data.get("resolutions", {})
    if not isinstance(resolutions, dict):
        raise ValidationError("Resoluciones inválidas.")
    valid_people = {person["id"]: person for person in directory()}
    for issue in review.issues:
        resolution = resolutions.get(issue["id"])
        if resolution is None:
            raise ValidationError("Resuelve todos los identificadores, responsables y opciones antes de aplicar.")
        sheet = document["sheets"][issue["sheet"]]
        cell = sheet["cellData"][str(issue["row"])][str(issue["column"])]
        if issue["type"] == "identity":
            if resolution != "new" and resolution not in issue["candidates"]:
                raise ValidationError("Identificador de fila no válido.")
            if resolution != "new":
                for block in sheet["__bold"]["blocks"]:
                    block["rowIds"] = [resolution if value == issue["value"] else value for value in block["rowIds"]]
                cell["v"] = resolution
        elif issue["type"] in {"responsible", "collaborators"}:
            block = next(block for block in sheet["__bold"]["blocks"] if block["startRow"] < issue["row"] <= block["startRow"] + len(block["rowIds"]))
            person = valid_people.get(resolution)
            if resolution and (not person or block["type"] != "tasks" and block["task"].get("enabled") and person["unit"] != block["task"]["unit"]):
                raise ValidationError("Selecciona una persona válida del departamento.")
            cell["v"] = ",".join(filter(None, [cell.get("v", ""), resolution])) if issue["type"] == "collaborators" else resolution
        else:
            if resolution not in {option["value"] for option in issue["candidates"]}:
                raise ValidationError("Opción no válida.")
            cell["v"] = resolution
    validate_document(document)
    Revision.objects.create(workbook=workbook, revision=workbook.revision, document=workbook.document, excel_content=workbook.excel_content, reason="before_drive_import")
    previous = workbook.document
    workbook.document = document
    apply_tasks(workbook, previous, request)
    workbook.revision += 1
    workbook.excel_content, workbook.excel_revision = review.excel_content, workbook.revision
    accept_metadata(workbook, data)
    workbook.sync_state, workbook.sync_error = "current", ""
    workbook.synced_revision = workbook.revision
    workbook.sync_after, workbook.pending_since = None, None
    workbook.upload_checksum = review.drive_checksum
    workbook.upload_uncertain = False
    workbook.save()
    remember_base(workbook, workbook.document, workbook.revision)
    review.applied_at = timezone.now()
    review.save(update_fields=["applied_at"])
    from boldApp.administrativo.services import record_system_event
    record_system_event("sheets.drive_import", request, module_code="sheets", target_type="workbook", target_id=workbook.id, metadata={"review": str(review.id), "drive_version": review.drive_version})
    transaction.on_commit(partial(publish, workbook.id, {"revision": workbook.revision, "source": "drive"}))
    from .tasks import enqueue
    transaction.on_commit(partial(enqueue, str(workbook.id), timezone.now()))
    return workbook
