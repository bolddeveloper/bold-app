from copy import deepcopy
from functools import partial
from pathlib import Path
import base64
import uuid

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import Prefetch, Q
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ViewSet
from rest_framework.serializers import IntegerField, UUIDField

from boldApp.administrativo.services import record_system_event
from boldApp.autenticacion.services import issue_ws_ticket
from boldApp.core.models import OrganizationalUnit
from boldApp.core.permissions import HasActiveAssignment
from boldApp.tareas.models import Comment, TaskStatus
from boldApp.tareas.serializers import CommentSerializer
from . import drive, engine
from .access import accessible, module_allowed, require_file, require_module
from .document import agenda, blank, duplicate, recreate_agenda, validate_document
from .models import Folder, ImportReview, Member, Preference, Revision, Workbook
from .operations import apply_operation, mark_pending, publish
from .task_bridge import task_permission


def name(value):
    if not isinstance(value, str) or not 1 <= len(value.strip()) <= 160:
        raise ValidationError("El nombre debe contener entre 1 y 160 caracteres.")
    return value.strip()


def folder_for(request, identity):
    return get_object_or_404(Folder, pk=UUIDField().run_validation(identity), owner=request.user, deleted_at__isnull=True) if identity else None


class SheetsViewSet(ViewSet):
    permission_classes = [HasActiveAssignment]
    lookup_value_regex = "[0-9a-fA-F-]{36}"

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if request.method in {"POST", "PUT", "PATCH", "DELETE"} and not isinstance(request.data, dict):
            raise ValidationError("Envía un objeto con los datos de la operación.")


def serialized(workbook, request, full=True):
    if workbook.owner_id == request.user.id:
        role = "owner"
    else:
        members = getattr(workbook, "_sheet_members", None)
        role = members[0].role if members else Member.objects.filter(workbook=workbook, account=request.user).values_list("role", flat=True).first()
        if not role:
            raise PermissionDenied("El archivo no está disponible para esta cuenta.")
    preferences = getattr(workbook, "_sheet_preferences", None)
    preference = (preferences[0] if preferences else None) if preferences is not None else Preference.objects.filter(account=request.user, workbook=workbook).first()
    if not hasattr(request, "_sheet_capabilities"):
        request._sheet_capabilities = {key: module_allowed(request.assignment, key) for key in ["edit", "assign", "share", "export", "delete"]}
    result = {"id": str(workbook.id), "name": workbook.name, "folder": str(workbook.folder_id) if workbook.folder_id else None, "owner": str(workbook.owner_id), "role": role, "revision": workbook.revision, "is_template": workbook.is_template, "initial_agenda": workbook.initial_agenda, "deleted_at": workbook.deleted_at, "updated_at": workbook.updated_at, "sync_state": workbook.sync_state, "sync_error": workbook.sync_error, "calculation_error": workbook.calculation_error, "calculated_revision": workbook.calculated_revision, "drive_url": workbook.drive_url, "drive_folder": workbook.drive_folder, "synced_revision": workbook.synced_revision, "favorite": bool(preference and preference.favorite), "filters": preference.filters if preference else {}, "can": {key: allowed and (role == "owner" if key in {"share", "delete"} else role != "reader" if key in {"edit", "assign"} else True) for key, allowed in request._sheet_capabilities.items()}}
    if full:
        result["document"] = workbook.document
        result["links"] = [{"row": str(link.row_id), "task": str(link.task_id)} for link in workbook.task_links.filter(active=True)]
        result["can_recreate_reference"] = bool(settings.DEBUG and settings.SHEETS_AGENDA_SOURCE and workbook.initial_agenda and workbook.revision == 0 and role == "owner" and result["can"]["edit"] and module_allowed(request.assignment, "create"))
    return result


class LibraryView(APIView):
    permission_classes = [HasActiveAssignment]

    def get(self, request):
        require_module(request.assignment)
        files = accessible(request.assignment).select_related("owner", "folder").prefetch_related(Prefetch("members", queryset=Member.objects.filter(account=request.user), to_attr="_sheet_members"), Prefetch("preference_set", queryset=Preference.objects.filter(account=request.user), to_attr="_sheet_preferences"))
        templates = [] if Workbook.objects.filter(owner=request.user, system_template="agenda").exists() else [{"id": "agenda", "name": "Agenda de triunfos", "sheets": ["Liderazgo", "Procesos", "IT", "Herramientas", "Copia de Procesos", "Bold Lab"], "can": {"edit": module_allowed(request.assignment, "create") and module_allowed(request.assignment, "edit"), "delete": module_allowed(request.assignment, "delete")}}]
        return Response({"files": [serialized(file, request, False) for file in files], "folders": [{"id": str(folder.id), "name": folder.name, "parent": str(folder.parent_id) if folder.parent_id else None} for folder in Folder.objects.filter(owner=request.user, deleted_at__isnull=True)], "templates": templates, "can_create": module_allowed(request.assignment, "create"), "can_initial_agenda": settings.DEBUG and module_allowed(request.assignment, "create") and not Workbook.objects.filter(initial_agenda=True).exists()})


class DirectoryView(APIView):
    permission_classes = [HasActiveAssignment]

    def get(self, request):
        require_module(request.assignment)
        return Response({"people": engine.directory(), "units": [{"id": str(unit.id), "name": unit.name} for unit in OrganizationalUnit.objects.all()], "statuses": [{"id": str(status.id), "unit": str(status.unit_id or ""), "name": status.name, "category": status.category} for status in TaskStatus.objects.all()]})


class FolderViewSet(SheetsViewSet):
    permission_classes = [HasActiveAssignment]

    def create(self, request):
        require_module(request.assignment, "create")
        folder = Folder.objects.create(owner=request.user, name=name(request.data.get("name")), parent=folder_for(request, request.data.get("parent")))
        return Response({"id": str(folder.id), "name": folder.name}, status=201)

    def partial_update(self, request, pk=None):
        require_module(request.assignment, "edit")
        folder = folder_for(request, pk)
        if "name" in request.data:
            folder.name = name(request.data["name"])
        if "parent" in request.data:
            parent = folder_for(request, request.data["parent"])
            visited = {folder.id}
            current = parent
            while current:
                if current.id in visited:
                    raise ValidationError("No puedes mover una carpeta dentro de sí misma.")
                visited.add(current.id)
                current = current.parent
            folder.parent = parent
        folder.save()
        return Response({"id": str(folder.id), "name": folder.name})

    def destroy(self, request, pk=None):
        require_module(request.assignment, "delete")
        folder = folder_for(request, pk)
        if Folder.objects.filter(parent=folder, deleted_at__isnull=True).exists() or Workbook.objects.filter(folder=folder, deleted_at__isnull=True).exists():
            raise ValidationError("Mueve los archivos y subcarpetas antes de eliminar esta carpeta.")
        folder.deleted_at = timezone.now()
        folder.save(update_fields=["deleted_at"])
        return Response(status=204)


class FileViewSet(SheetsViewSet):
    permission_classes = [HasActiveAssignment]

    def file(self, request, pk, action="read", deleted=False):
        workbook = get_object_or_404(accessible(request.assignment), pk=UUIDField().run_validation(pk))
        require_file(request.assignment, workbook, action, include_deleted=deleted)
        return workbook

    def retrieve(self, request, pk=None):
        return Response(serialized(self.file(request, pk), request))

    @transaction.atomic
    def create(self, request):
        require_module(request.assignment, "create")
        title = name(request.data.get("name"))
        try:
            identity = UUIDField().run_validation(request.data["id"])
        except (KeyError, ValueError, TypeError) as exc:
            raise ValidationError("La creación necesita un identificador idempotente.") from exc
        existing = Workbook.objects.filter(pk=identity).first()
        if existing:
            require_file(request.assignment, existing)
            if existing.owner_id != request.user.id:
                raise PermissionDenied()
            return Response(serialized(existing, request))
        is_template = request.data.get("is_template", False)
        if not isinstance(is_template, bool):
            raise ValidationError("is_template debe ser un booleano.")
        destination = "" if is_template else drive.valid_folder(request.user, request.data.get("drive_folder"))
        source = request.data.get("template")
        uploaded = request.FILES.get("excel")
        content = None
        if source == "agenda":
            customized = Workbook.objects.filter(owner=request.user, system_template="agenda").first()
            if customized:
                require_file(request.assignment, customized)
            document = duplicate(customized.document) if customized else agenda()
        else:
            document = duplicate(self.file(request, source).document) if source else blank(title)
        document["id"], document["name"] = str(identity), title
        if uploaded:
            if source or not uploaded.name.lower().endswith(".xlsx") or uploaded.size > 20_000_000:
                raise ValidationError("Selecciona un archivo .xlsx de hasta 20 MB, sin combinarlo con una plantilla.")
            content = uploaded.read()
            document = engine.call("import", document, file=base64.b64encode(content).decode(), newFile=True, advanced=True)["document"]
        validate_document(document)
        if content:
            content = engine.call("export", document, directory=[], links=[], revision=1, recalculate=False, source=base64.b64encode(content).decode(), sourceOnly=True)
        reserved = "" if is_template else drive.google(request.user, "GET", "/files/generateIds", params={"count": 1, "space": "drive", "type": "files"})["ids"][0]
        try:
            with transaction.atomic():
                workbook = Workbook.objects.create(id=identity, owner=request.user, creator=request.assignment, name=title, folder=folder_for(request, request.data.get("folder")), document=document, revision=1, is_template=is_template, drive_account=None if is_template else request.user, drive_folder=destination, drive_id=reserved, excel_content=content, excel_revision=1 if content else 0)
        except IntegrityError:
            workbook = Workbook.objects.get(pk=identity)
            require_file(request.assignment, workbook)
            if workbook.owner_id != request.user.id:
                raise PermissionDenied()
            return Response(serialized(workbook, request))
        mark_pending(workbook)
        from .images import bind_images
        bind_images(workbook, request)
        workbook.save()
        record_system_event("sheets.created", request, module_code="sheets", target_type="workbook", target_id=workbook.id)
        return Response(serialized(workbook, request), status=201)

    @action(detail=False, methods=["post", "delete"], url_path="template-agenda")
    @transaction.atomic
    def template_agenda(self, request):
        require_module(request.assignment, "delete" if request.method == "DELETE" else "edit")
        if request.method == "POST":
            require_module(request.assignment, "create")
        document = agenda()
        workbook, _ = Workbook.objects.get_or_create(
            owner=request.user, system_template="agenda",
            defaults={"id": document["id"], "creator": request.assignment, "name": document["name"], "document": document, "revision": 1, "is_template": True},
        )
        if request.method == "DELETE":
            return self.destroy(request, str(workbook.pk))
        require_file(request.assignment, workbook, "edit")
        return Response(serialized(workbook, request))

    @action(detail=False, methods=["post"], url_path="initial-agenda")
    def initial_agenda(self, request):
        require_module(request.assignment, "create")
        if not settings.DEBUG:
            raise PermissionDenied("La Agenda sin carpeta solo está disponible para la prueba local inicial.")
        existing = Workbook.objects.filter(initial_agenda=True).first()
        if existing:
            require_file(request.assignment, existing)
            if not settings.SHEETS_AGENDA_SOURCE or existing.revision != 0 or existing.owner_id != request.user.id:
                return Response(serialized(existing, request))
            require_file(request.assignment, existing, "edit")
            from .document import blocks, row_values
            if any(value not in (None, "") for sheet, block in blocks(existing.document) for row in block["rowIds"] for key, value in row_values(sheet, block, row).items() if key not in {"total", "difference", "value"}):
                raise ValidationError("La Agenda ya contiene información. Conservamos sus datos; usa la versión existente.")
        document = agenda()
        if settings.SHEETS_AGENDA_SOURCE:
            source = Path(settings.SHEETS_AGENDA_SOURCE)
            if not source.is_file() or source.suffix.lower() != ".xlsx" or source.stat().st_size > 20_000_000:
                raise ValidationError("La referencia local de Agenda debe ser un Excel válido de hasta 20 MB.")
            document = recreate_agenda(engine.call("recreate", document, file=base64.b64encode(source.read_bytes()).decode()))
        try:
            with transaction.atomic():
                if existing:
                    workbook = Workbook.objects.select_for_update().get(pk=existing.id)
                    if workbook.revision != 0:
                        raise ValidationError("La Agenda cambió durante la recreación. Conservamos esos cambios.")
                    Revision.objects.create(workbook=workbook, revision=0, document=workbook.document, reason="before_agenda_recreation")
                    document["id"], document["name"] = str(workbook.id), workbook.name
                    workbook.document, workbook.revision = document, 1
                    workbook.save(update_fields=["document", "revision", "updated_at"])
                    transaction.on_commit(partial(publish, workbook.id, {"revision": workbook.revision}))
                else:
                    workbook = Workbook.objects.create(id=document["id"], owner=request.user, creator=request.assignment, name=document["name"], document=document, revision=1, initial_agenda=True)
        except IntegrityError:
            workbook = Workbook.objects.get(initial_agenda=True)
            require_file(request.assignment, workbook)
        from .tasks import enqueue
        transaction.on_commit(partial(enqueue, str(workbook.id), timezone.now()))
        return Response(serialized(workbook, request), status=201)

    @transaction.atomic
    def partial_update(self, request, pk=None):
        self.file(request, pk, "edit")
        workbook = Workbook.objects.select_for_update().get(pk=pk)
        if "name" in request.data:
            workbook.name = name(request.data["name"])
            workbook.document["name"] = workbook.name
        if "folder" in request.data:
            if workbook.owner_id != request.user.id:
                raise PermissionDenied("Solo el propietario organiza este archivo en carpetas.")
            workbook.folder = folder_for(request, request.data["folder"])
        if "is_template" in request.data:
            if workbook.owner_id != request.user.id:
                raise PermissionDenied()
            workbook.is_template = bool(request.data["is_template"])
        workbook.revision += 1
        mark_pending(workbook)
        workbook.save()
        transaction.on_commit(partial(publish, workbook.id, {"revision": workbook.revision}))
        return Response(serialized(workbook, request))

    @transaction.atomic
    def destroy(self, request, pk=None):
        self.file(request, pk, "delete")
        workbook = Workbook.objects.select_for_update().get(pk=pk)
        Revision.objects.create(workbook=workbook, revision=workbook.revision, document=workbook.document, reason="before_delete")
        workbook.deleted_at = timezone.now()
        workbook.sync_after = None
        workbook.task_links.update(active=False)
        workbook.save()
        transaction.on_commit(partial(publish, workbook.id, {"revoked": True}))
        return Response(status=204)

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def restore(self, request, pk=None):
        workbook = self.file(request, pk, "delete", True)
        workbook = Workbook.objects.select_for_update().get(pk=workbook.pk)
        from .document import blocks
        for _, block in blocks(workbook.document):
            block["task"]["enabled"] = False
        workbook.deleted_at = None
        workbook.revision += 1
        mark_pending(workbook)
        workbook.save()
        return Response(serialized(workbook, request))

    @action(detail=True, methods=["post"])
    def operations(self, request, pk=None):
        self.file(request, pk, "edit")
        return Response(serialized(apply_operation(pk, request), request))

    @action(detail=True, methods=["get"])
    def export(self, request, pk=None):
        workbook = self.file(request, pk, "export")
        content = engine.export(workbook)
        response = HttpResponse(content, content_type=drive.XLSX)
        from urllib.parse import quote
        response["Content-Disposition"] = "attachment; filename*=UTF-8''" + quote(workbook.name + ".xlsx")
        return response

    @action(detail=True, methods=["get", "put", "delete"])
    @transaction.atomic
    def members(self, request, pk=None):
        workbook = self.file(request, pk, "share")
        if request.method != "GET":
            from boldApp.core.models import PositionAssignment
            assignment = get_object_or_404(PositionAssignment.objects.select_related("employee__user_account", "position__unit", "position__job_role"), pk=UUIDField().run_validation(request.data.get("assignment")), is_active=True, released_at__isnull=True, employee__is_active=True, employee__user_account__is_active=True)
            account = assignment.employee.user_account
            if account.id == workbook.owner_id:
                raise ValidationError("No puedes quitar ni cambiar al propietario.")
            if request.method == "DELETE":
                Member.objects.filter(workbook=workbook, account=account).delete()
            else:
                role = request.data.get("role")
                if role not in {"reader", "editor"}:
                    raise ValidationError("Elige Lector o Editor.")
                member, created = Member.objects.update_or_create(workbook=workbook, account=account, defaults={"role": role})
                if created and module_allowed(assignment):
                    from boldApp.notificaciones.services import create_notification
                    create_notification(recipient=assignment, actor=request.assignment, event_type="sheets.shared", title="Te compartieron «" + workbook.name + "»", body="Acceso de " + ("editor" if role == "editor" else "lector"), route={"module": "sheets", "file_id": str(workbook.id)}, resource_type="file", resource_id=workbook.id)
            record_system_event("sheets.members_changed", request, module_code="sheets", target_type="workbook", target_id=workbook.id, metadata={"account": str(account.id)})
            transaction.on_commit(partial(publish, workbook.id, {"access_changed": True}))
        return Response([{"account": str(member.account_id), "name": member.account.employee.full_name, "email": member.account.email, "role": member.role} for member in workbook.members.select_related("account__employee")])

    @action(detail=True, methods=["put"])
    def preference(self, request, pk=None):
        workbook = self.file(request, pk)
        data = request.data
        if not isinstance(data.get("filters", {}), dict) or len(str(data.get("filters", {}))) > 16000:
            raise ValidationError("Filtros inválidos.")
        preference, _ = Preference.objects.get_or_create(account=request.user, workbook=workbook)
        if "filters" in data:
            preference.filters = data["filters"]
        if "favorite" in data:
            preference.favorite = bool(data["favorite"])
        preference.save()
        return Response({"filters": preference.filters, "favorite": preference.favorite})

    @action(detail=True, methods=["get"], url_path="row-comments")
    def row_comments(self, request, pk=None):
        workbook = self.file(request, pk)
        link = get_object_or_404(workbook.task_links.select_related("task__unit"), row_id=UUIDField().run_validation(request.query_params.get("row")), active=True)
        task_permission(request.assignment, "tasks.task.read", link.task.unit, link.task)
        rows = Comment.objects.filter(task=link.task, image_section="comments").select_related("author_assignment__employee").order_by("created_at")[:500]
        return Response([{**CommentSerializer(comment).data, "author_name": comment.author_assignment.employee.full_name} for comment in rows])

    @action(detail=True, methods=["get"])
    def versions(self, request, pk=None):
        workbook = self.file(request, pk, "edit")
        return Response([{"id": version.pk, "revision": version.revision, "reason": version.reason, "created_at": version.created_at} for version in workbook.versions.exclude(reason="drive_base").defer("excel_content", "document").order_by("-created_at")[:30]])

    @action(detail=True, methods=["post"], url_path="restore-version")
    def restore_version(self, request, pk=None):
        workbook = self.file(request, pk, "assign")
        require_file(request.assignment, workbook, "edit")
        version = get_object_or_404(workbook.versions, pk=IntegerField(min_value=1).run_validation(request.data.get("version")))
        with transaction.atomic():
            workbook = Workbook.objects.select_for_update().get(pk=pk)
            from .task_bridge import apply_tasks
            Revision.objects.create(workbook=workbook, revision=workbook.revision, document=workbook.document, excel_content=workbook.excel_content, reason="before_restore")
            previous = workbook.document
            workbook.document = deepcopy(version.document)
            apply_tasks(workbook, previous, request)
            workbook.revision += 1
            workbook.excel_content = version.excel_content
            workbook.excel_revision = workbook.revision if version.excel_content else 0
            mark_pending(workbook)
            workbook.save()
            transaction.on_commit(partial(publish, workbook.id, {"revision": workbook.revision}))
        return Response(serialized(workbook, request))

    @action(detail=True, methods=["get", "post"], url_path="drive")
    def drive_binding(self, request, pk=None):
        workbook = self.file(request, pk)
        if request.method == "POST":
            workbook = drive.bind(pk, request, request.data.get("folder"))
        elif workbook.drive_account_id:
            workbook = drive.check_external(pk, request.assignment)
        return Response(serialized(workbook, request))

    @action(detail=True, methods=["post"], url_path="drive/retry")
    def drive_retry(self, request, pk=None):
        with transaction.atomic():
            self.file(request, pk, "edit")
            workbook = Workbook.objects.select_for_update().get(pk=pk)
            if workbook.sync_state == "external":
                raise ValidationError("Revisa los cambios externos antes de reanudar.")
            if not workbook.drive_account_id:
                raise ValidationError("Elige primero una carpeta de Drive.")
            mark_pending(workbook)
            workbook.save()
        return Response(serialized(workbook, request))

    @action(detail=True, methods=["post"], url_path="drive/review")
    def drive_review(self, request, pk=None):
        review = drive.review_external(self.file(request, pk, "edit"), request)
        return Response({"id": str(review.id), "issues": review.issues, "changes": review.changes, "drive_version": review.drive_version})

    @action(detail=True, methods=["post"], url_path="drive/apply")
    def drive_apply(self, request, pk=None):
        self.file(request, pk, "edit")
        get_object_or_404(ImportReview, pk=UUIDField().run_validation(request.data.get("review")), workbook_id=pk, reviewer=request.user)
        return Response(serialized(drive.apply_review(pk, request.data["review"], request), request))

    @action(detail=True, methods=["post"])
    def ticket(self, request, pk=None):
        workbook = self.file(request, pk)
        raw = issue_ws_ticket(request.user, request.auth, request.assignment.id, workbook.id, "sheets")
        return Response({"ticket": raw, "expires_in": settings.AUTH_WEBSOCKET_TICKET_TTL_SECONDS})

    @action(detail=True, methods=["post"])
    def recalculate(self, request, pk=None):
        workbook = self.file(request, pk, "edit")
        workbook.calculation_error = ""
        workbook.save(update_fields=["calculation_error"])
        from .tasks import enqueue
        enqueue(str(workbook.id), timezone.now())
        return Response(serialized(workbook, request))
