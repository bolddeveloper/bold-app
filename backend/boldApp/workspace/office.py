"""Office editor bridge: original IDs, temporary trashed conversion, original saves."""
from contextlib import contextmanager
import hashlib
import json
from django.conf import settings
from django.core.cache import cache
from rest_framework.exceptions import APIException, NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView
from .service import FILE_FIELDS, MIMES, google, metadata, file_id
from .models import GoogleConnection, OfficeWorkspace
from .views import audit

OFFICE = {
    "application/msword": "docs",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docs",
    "application/vnd.ms-excel": "sheets",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "sheets",
    "application/vnd.ms-powerpoint": "slides",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "slides",
}
EXTENSIONS = {"doc": "docs", "docx": "docs", "xls": "sheets", "xlsx": "sheets", "ppt": "slides", "pptx": "slides"}
EXPORTS = {"docs": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "sheets": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "slides": "application/vnd.openxmlformats-officedocument.presentationml.presentation"}
LIMIT = 20 * 1024 * 1024


class OfficeConflict(APIException):
    status_code = 409
    default_detail = "El archivo original cambió. Conserva tus cambios y vuelve a cargar antes de guardar."


def office_kind(item):
    mime = item.get("mimeType", "")
    return OFFICE.get(mime) or (EXTENSIONS.get(item.get("name", "").rsplit(".", 1)[-1].lower()) if mime in ("", "application/octet-stream", "application/zip") else None)


def checksum(item):
    return str(item.get("md5Checksum") or item.get("version", ""))


def modern_source(item):
    return item.get("mimeType") in EXPORTS.values() or item.get("name", "").rsplit(".", 1)[-1].lower() in ("docx", "xlsx", "pptx")


def validate_source(item, allow_legacy=False):
    kind = office_kind(item)
    if not kind or item.get("trashed"):
        raise ValidationError({"detail": "Selecciona un archivo Office disponible."})
    if not modern_source(item) and not allow_legacy:
        raise ValidationError({"detail": "Abre los formatos antiguos .doc, .xls y .ppt en Google para conservar el original."})
    if not item.get("capabilities", {}).get("canCopy") or not item.get("capabilities", {}).get("canDownload"):
        raise PermissionDenied("Google no permite leer este archivo en el editor BOLD.")
    if int(item.get("size") or 0) > LIMIT:
        raise ValidationError({"detail": "Abre archivos Office de hasta 20 MB en BOLD."})
    return kind


@contextmanager
def office_workspace(user, item, create=True, allow_legacy=False):
    kind = validate_source(item, allow_legacy=allow_legacy)
    subject = GoogleConnection.objects.filter(user=user).values_list("subject", flat=True).first() or ""
    scope = {"user": user, "google_subject": subject, "source_id": item["id"]}
    key = hashlib.sha256(f"{user.pk}:{subject}:{item['id']}".encode()).hexdigest()
    lock = "bold-office-original:" + key
    # ponytail: local-process lock; use shared cache before running multiple workers.
    if not cache.add(lock, True, timeout=600):
        raise OfficeConflict("Este archivo está procesando otra operación. Reintenta en unos segundos.")
    working = None
    try:
        session = OfficeWorkspace.objects.filter(**scope).first()
        if session and session.checksum == checksum(item):
            try:
                working = metadata(user, session.working_id)
            except NotFound:
                working = None
        if not working:
            if not create:
                raise OfficeConflict()
            content = google(user, "GET", "/files/" + item["id"], params={"alt": "media", "supportsAllDrives": "true"}, raw=True)
            if len(content.content) > LIMIT:
                raise ValidationError({"detail": "Abre archivos Office de hasta 20 MB en BOLD."})
            info = {"name": "BOLD temporal " + key[:12], "mimeType": MIMES[kind], "appProperties": {"boldOfficeTemporary": key}}
            source_mime = EXPORTS[kind] if modern_source(item) else {"docs": "application/msword", "sheets": "application/vnd.ms-excel", "slides": "application/vnd.ms-powerpoint"}[kind]
            parts = {"metadata": (None, json.dumps(info), "application/json; charset=UTF-8"), "file": (item["name"], content.content, source_mime)}
            working = google(user, "POST", "/files", api="upload", params={"uploadType": "multipart", "fields": FILE_FIELDS}, files=parts)
            if working.get("mimeType") != MIMES[kind]:
                raise ValidationError({"detail": "Google no pudo leer este archivo Office."})
            session, _ = OfficeWorkspace.objects.update_or_create(**scope, defaults={"working_id": working["id"], "checksum": checksum(item)})
        if working.get("trashed"):
            google(user, "PATCH", "/files/" + working["id"], body={"trashed": False})
        yield session, working, kind
    finally:
        try:
            if working:
                google(user, "PATCH", "/files/" + working["id"], body={"trashed": True})
        finally:
            cache.delete(lock)


def save_original(request, item, session, kind):
    if checksum(metadata(request.user, item["id"])) != session.checksum:
        raise OfficeConflict()
    exported = google(request.user, "GET", "/files/" + session.working_id + "/export", params={"mimeType": EXPORTS[kind]}, raw=True)
    current = google(request.user, "GET", "/files/" + item["id"], params={"fields": FILE_FIELDS, "supportsAllDrives": "true"}, raw=True)
    if checksum(current.json()) != session.checksum:
        raise OfficeConflict()
    parts = {"metadata": (None, json.dumps({"mimeType": EXPORTS[kind]}), "application/json; charset=UTF-8"), "file": (item["name"], exported.content, EXPORTS[kind])}
    etag = current.headers.get("ETag")
    result = google(request.user, "PATCH", "/files/" + item["id"], api="upload", params={"uploadType": "multipart", "fields": FILE_FIELDS, "supportsAllDrives": "true"}, files=parts, extra_headers={"If-Match": etag} if etag else None)
    session.checksum = checksum(result)
    session.save(update_fields=["checksum"])
    audit(request, "office_original_updated", item["id"])
    return result


def convert_legacy(request, item, kind):
    subject = GoogleConnection.objects.filter(user=request.user).values_list("subject", flat=True).first() or str(request.user.pk)
    key = hashlib.sha256(f"{subject}:{item['id']}".encode()).hexdigest()
    lock = "bold-office-conversion:" + key
    # ponytail: local-process lock; use shared cache before running multiple workers.
    if not cache.add(lock, True, timeout=600):
        raise OfficeConflict("Este archivo se está convirtiendo. Reintenta en unos segundos.")
    try:
        matches = google(request.user, "GET", "/files", params={"q": "appProperties has { key='boldOfficeModern' and value='" + key + "' }", "fields": "files(" + FILE_FIELDS + ")", "pageSize": 2, "supportsAllDrives": "true", "includeItemsFromAllDrives": "true"}).get("files", [])
        if matches:
            converted = metadata(request.user, matches[0]["id"])
            if converted.get("trashed"):
                raise OfficeConflict("El archivo convertido está en la papelera. Restáuralo para volver a abrirlo; no crearemos otro.")
            if office_kind(converted) != kind or not modern_source(converted):
                raise ValidationError("El archivo convertido cambió de formato. Ábrelo desde Drive.")
            return converted
        with office_workspace(request.user, item, allow_legacy=True) as (_, working, _):
            exported = google(request.user, "GET", "/files/" + working["id"] + "/export", params={"mimeType": EXPORTS[kind]}, raw=True)
            extension = {"docs": "docx", "sheets": "xlsx", "slides": "pptx"}[kind]
            name = item["name"].rsplit(".", 1)[0] + "." + extension
            info = {"name": name, "mimeType": EXPORTS[kind], "appProperties": {"boldOfficeModern": key}}
            if item.get("parents"):
                info["parents"] = item["parents"]
            parts = {"metadata": (None, json.dumps(info), "application/json; charset=UTF-8"), "file": (name, exported.content, EXPORTS[kind])}
            converted = google(request.user, "POST", "/files", api="upload", params={"uploadType": "multipart", "fields": FILE_FIELDS, "supportsAllDrives": "true"}, files=parts)
            audit(request, "office_legacy_converted", item["id"])
            return converted
    finally:
        cache.delete(lock)


class OfficeView(APIView):
    def post(self, request, identity):
        if not settings.GOOGLE_WORKSPACE_EDITORS_ENABLED:
            raise PermissionDenied("Los editores de BOLD están desactivados.")
        item = metadata(request.user, file_id(identity))
        kind = validate_source(item, allow_legacy=True)
        if not modern_source(item):
            item = convert_legacy(request, item, kind)
        # Opening selects the original. Conversion is deferred to the editor read.
        return Response({**item, "editorKind": kind})
