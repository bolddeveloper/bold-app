"""Native Google editors. Files remain in Google; no document content is persisted."""
from django.conf import settings
import json
import re

from rest_framework.exceptions import APIException, PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from .service import MIMES, file_id, google, metadata
from .views import audit
from .office import office_kind, office_workspace, save_original, checksum, OfficeConflict


RESOURCES = {"docs": "documents", "sheets": "spreadsheets", "slides": "presentations"}
OPERATIONS = {
    "docs": {"insertText", "deleteContentRange", "updateTextStyle", "updateParagraphStyle",
             "createParagraphBullets", "deleteParagraphBullets", "insertTable", "insertInlineImage", "insertPageBreak"},
    "sheets": {"updateCells", "repeatCell", "addSheet", "updateSheetProperties", "appendDimension",
               "insertDimension", "deleteDimension", "sortRange", "mergeCells", "unmergeCells", "addChart"},
    "slides": {"insertText", "deleteText", "updateTextStyle", "updateParagraphStyle", "createSlide",
               "duplicateObject", "deleteObject", "createShape", "createImage", "updatePageElementTransform",
               "updateShapeProperties", "updatePageProperties", "updateSlidesPosition"},
}


class EditorConflict(APIException):
    status_code = 409
    default_detail = "El archivo cambió en Google. Conservamos tus cambios en pantalla; vuelve a cargar antes de guardar."


def resource(user, identity, item=None):
    item = item or metadata(user, file_id(identity))
    kind = next((key for key in RESOURCES if MIMES[key] == item.get("mimeType")), None)
    if not kind or item.get("trashed"):
        raise ValidationError("Selecciona un documento, hoja o presentación de Google disponible.")
    return item, kind, f"/{RESOURCES[kind]}/{identity}"


def read_content(user, kind, path, params):
    if kind == "docs":
        return google(user, "GET", path, api=kind, params={"includeTabsContent": "true"})
    if kind == "sheets":
        options = {"fields": "spreadsheetId,properties,sheets(properties),namedRanges"}
        if params.get("range"):
            # A bounded A1 rectangle, with a sheet title or numeric sheet ID resolved on the client.
            value = params["range"]
            match = re.fullmatch(r"(.+)!([A-Z]{1,3})([1-9][0-9]*):([A-Z]{1,3})([1-9][0-9]*)", value)
            if not match or len(value) > 400:
                raise ValidationError("Rango de hoja inválido.")
            column = lambda label: sum((ord(char) - 64) * 26 ** index for index, char in enumerate(label[::-1]))
            rows = int(match[5]) - int(match[3]) + 1
            columns = column(match[4]) - column(match[2]) + 1
            if rows < 1 or columns < 1 or rows * columns > 10000:
                raise ValidationError("Carga como máximo 10 000 celdas por página.")
            options = {"ranges": value, "includeGridData": "true"}
        return google(user, "GET", path, api=kind, params=options)
    return google(user, "GET", path, api=kind)


class EditorView(APIView):
    def get(self, request, identity):
        item = metadata(request.user, file_id(identity))
        if office_kind(item):
            if not settings.GOOGLE_WORKSPACE_EDITORS_ENABLED:
                raise PermissionDenied("Los editores de BOLD están desactivados.")
            with office_workspace(request.user, item) as (session, working, kind):
                path = f"/{RESOURCES[kind]}/{working['id']}"
                content = read_content(request.user, kind, path, request.query_params)
                response = Response({"file": item, "kind": kind, "content": content, "source_checksum": session.checksum})
        else:
            item, kind, path = resource(request.user, identity, item)
            content = read_content(request.user, kind, path, request.query_params)
            response = Response({"file": item, "kind": kind, "content": content})
        response["Cache-Control"] = "private, no-store"
        return response

    def post(self, request, identity):
        if not settings.GOOGLE_WORKSPACE_EDITORS_ENABLED:
            raise PermissionDenied("Los editores de BOLD están desactivados. Abre el archivo en Google para editar.")
        if not isinstance(request.data, dict):
            raise ValidationError("Envía un objeto de cambios válido.")
        item = metadata(request.user, file_id(identity))
        if office_kind(item):
            if not item.get("capabilities", {}).get("canEdit"):
                raise PermissionDenied("Google no permite editar el archivo original.")
            if request.data.get("source_checksum") != checksum(item):
                raise OfficeConflict()
            with office_workspace(request.user, item, create=False) as (session, working, kind):
                path = f"/{RESOURCES[kind]}/{working['id']}"
                try:
                    self.apply_changes(request, item, kind, path, identity)
                    result = save_original(request, item, session, kind)
                except Exception:
                    # Never reload unsaved intermediate edits as if the original was saved.
                    session.delete()
                    raise
                response = Response(result)
                response["Cache-Control"] = "private, no-store"
                return response
        item, kind, path = resource(request.user, identity, item)
        return self.apply_changes(request, item, kind, path, identity)

    def apply_changes(self, request, item, kind, path, identity):
        if not item.get("capabilities", {}).get("canEdit"):
            raise PermissionDenied("Tienes acceso de lectura; solicita permiso de edición en Google.")
        requests = request.data.get("requests")
        if not isinstance(requests, list) or not 1 <= len(requests) <= 500:
            raise ValidationError("Envía entre 1 y 500 cambios.")
        if len(json.dumps(requests, ensure_ascii=False)) > 1_000_000:
            raise ValidationError("Guarda los cambios en bloques más pequeños.")
        for operation in requests:
            if not isinstance(operation, dict) or len(operation) != 1 or not set(operation) <= OPERATIONS[kind]:
                raise ValidationError("Operación de edición inválida.")
            if not isinstance(next(iter(operation.values())), dict):
                raise ValidationError("Contenido de operación inválido.")
        # Do not silently replay a write after a network failure or against a different revision.
        body = {"requests": requests}
        if kind in ("docs", "slides"):
            revision = request.data.get("revision")
            if not isinstance(revision, str) or not revision or len(revision) > 2000:
                raise ValidationError("Carga una revisión del archivo antes de guardar.")
            current = google(request.user, "GET", path, api=kind, params={"fields": "revisionId"})
            if current.get("revisionId") != revision:
                raise EditorConflict()
            body["writeControl"] = {"requiredRevisionId": revision}
        else:
            version = request.data.get("version")
            if not version or (not office_kind(item) and str(item.get("version")) != str(version)):
                raise EditorConflict()
            # Sheets has no revision precondition. This check detects existing remote edits;
            # each batch touches only selected cells, never replacing the entire spreadsheet.
        result = google(request.user, "POST", path + ":batchUpdate", api=kind, body=body)
        if not office_kind(item):
            audit(request, "content_updated", identity)
        response = Response(result)
        response["Cache-Control"] = "private, no-store"
        return response
