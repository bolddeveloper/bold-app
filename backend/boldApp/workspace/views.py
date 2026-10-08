import json
import re
from datetime import datetime
from django.http import HttpResponse, FileResponse
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView
from boldApp.administrativo.services import record_system_event
from .service import FILE_FIELDS, MIMES, google, file_id, metadata, require_capability, thumbnail


def audit(request, action, identity):
    record_system_event("workspace." + action, request, module_code="docs", target_type="google_file", metadata={"google_file_id": identity})


def literal(value):
    return str(value).replace("\\", "\\\\").replace("'", "\\'")


class FilesView(APIView):
    def get(self, request):
        view = request.query_params.get("view", "my")
        if view not in ("my", "all", "shared", "starred", "trash", "recent", "storage"):
            raise ValidationError("Vista inválida.")
        clauses = ["trashed = " + ("true" if view == "trash" else "false")]
        parent = request.query_params.get("parent", "")
        if parent:
            clauses.append("'" + file_id(parent) + "' in parents")
        elif view == "my" and not request.query_params.get("search"):
            clauses.append("'root' in parents")
        if view == "shared":
            clauses.append("sharedWithMe = true")
        if view == "starred":
            clauses.append("starred = true")
        if view == "recent":
            clauses.append("viewedByMeTime > '1970-01-01T00:00:00'")
        if view == "storage":
            clauses.append("'me' in owners")
            clauses.append("mimeType != '" + MIMES["folder"] + "'")
        owner = request.query_params.get("owner")
        if owner:
            owner = "me" if owner == "me" else serializers.EmailField().run_validation(owner)
            clauses.append("'" + literal(owner) + "' in owners")
        after = request.query_params.get("after")
        if after:
            try:
                datetime.strptime(after, "%Y-%m-%d")
            except (ValueError, TypeError):
                raise ValidationError("Fecha inválida.")
            clauses.append("modifiedTime >= '" + after + "T00:00:00Z'")
        if request.query_params.get("search"):
            clauses.append("name contains '" + literal(request.query_params["search"][:200]) + "'")
        if request.query_params.get("type") in MIMES:
            clauses.append("mimeType = '" + MIMES[request.query_params["type"]] + "'")
        elif request.query_params.get("type") in ("image", "pdf"):
            clauses.append("mimeType contains 'image/'" if request.query_params["type"] == "image" else "mimeType = 'application/pdf'")
        order = request.query_params.get("order") or {"recent": "viewedByMeTime desc", "storage": "quotaBytesUsed desc"}.get(view, "folder,name")
        if order not in ("folder,name", "folder,name desc", "modifiedTime", "modifiedTime desc", "viewedByMeTime desc", "quotaBytesUsed", "quotaBytesUsed desc"):
            raise ValidationError("Orden inválido.")
        params = {"q": " and ".join(clauses), "fields": "nextPageToken,files(" + FILE_FIELDS + ")", "pageSize": 100, "orderBy": "folder,name", "supportsAllDrives": "true", "includeItemsFromAllDrives": "true"}
        params["orderBy"] = order
        if request.query_params.get("page"):
            params["pageToken"] = request.query_params["page"][:2000]
        if request.query_params.get("drive"):
            params.update({"driveId": file_id(request.query_params["drive"]), "corpora": "drive"})
        return Response(google(request.user, "GET", "/files", params=params))

    def post(self, request):
        kind = request.data.get("type")
        if kind not in MIMES:
            raise ValidationError("Tipo de archivo inválido.")
        name = request.data.get("name", "Sin título")
        if not isinstance(name, str) or not name.strip() or len(name) > 255:
            raise ValidationError("El nombre debe contener entre 1 y 255 caracteres.")
        body = {"name": name.strip(), "mimeType": MIMES[kind]}
        if request.data.get("parent"):
            body["parents"] = [file_id(request.data["parent"])]
        item = google(request.user, "POST", "/files", body=body, params={"fields": FILE_FIELDS, "supportsAllDrives": "true"})
        audit(request, "created", item["id"])
        return Response(item, status=201)


class FileView(APIView):
    def get(self, request, identity):
        return Response(metadata(request.user, identity))

    def patch(self, request, identity):
        item = metadata(request.user, identity)
        body = {}
        for field, capability in [("name", "canRename"), ("trashed", "canTrash"), ("starred", None), ("folderColorRgb", None)]:
            if field not in request.data:
                continue
            required = "canUntrash" if field == "trashed" and request.data[field] is False else capability
            if required and not item.get("capabilities", {}).get(required):
                raise PermissionDenied("Google no permite modificar este archivo.")
            value = request.data[field]
            if field == "name" and (not isinstance(value, str) or not value.strip() or len(value) > 255):
                raise ValidationError("Nombre inválido.")
            if field == "folderColorRgb" and (item.get("mimeType") != MIMES["folder"] or not isinstance(value, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", value)):
                raise ValidationError("Color de carpeta inválido.")
            if field in ("trashed", "starred") and not isinstance(value, bool):
                raise ValidationError("Valor inválido.")
            body[field] = value
        if not body:
            raise ValidationError("No hay cambios válidos.")
        result = google(request.user, "PATCH", "/files/" + file_id(identity), body=body, params={"fields": FILE_FIELDS, "supportsAllDrives": "true"})
        audit(request, "updated", identity)
        return Response(result)


class CopyView(APIView):
    def post(self, request, identity):
        item = require_capability(request.user, identity, "canCopy")
        result = google(request.user, "POST", "/files/" + file_id(identity) + "/copy", body={"name": "Copia de " + item["name"]}, params={"fields": FILE_FIELDS, "supportsAllDrives": "true"})
        audit(request, "copied", identity)
        return Response(result, status=201)


class UploadView(APIView):
    def post(self, request):
        upload = request.FILES.get("file")
        if not upload:
            raise ValidationError("Elige un archivo para subir.")
        info = {"name": upload.name[:255]}
        if request.data.get("parent"):
            info["parents"] = [file_id(request.data["parent"])]
        convert = request.data.get("convert")
        if convert in ("docs", "sheets", "slides"):
            info["mimeType"] = MIMES[convert]
        files = {"metadata": (None, json.dumps(info), "application/json; charset=UTF-8"), "file": (upload.name, upload, upload.content_type or "application/octet-stream")}
        item = google(request.user, "POST", "/files", api="upload", params={"uploadType": "multipart", "fields": FILE_FIELDS, "supportsAllDrives": "true"}, files=files)
        audit(request, "uploaded", item["id"])
        return Response(item, status=201)


class DownloadView(APIView):
    def get(self, request, identity):
        item = require_capability(request.user, identity, "canDownload")
        if item["mimeType"] == MIMES["folder"]:
            from .folder_archive import folder_archive, archive_name
            response = FileResponse(folder_archive(request.user, item), as_attachment=True, filename=archive_name(item["name"]) + ".zip", content_type="application/zip")
            response["Cache-Control"] = "private, no-store"
            return response
        kind = next((key for key, mime in MIMES.items() if mime == item["mimeType"]), None)
        exports = {"docs": {"pdf": "application/pdf", "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}, "sheets": {"pdf": "application/pdf", "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}, "slides": {"pdf": "application/pdf", "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation"}}
        from .office import office_kind, office_workspace
        office = office_kind(item) if request.query_params.get("editor_export") == "true" else None
        if office:
            extension = request.query_params.get("export_format", "pdf")
            if extension not in exports[office]:
                raise ValidationError("Formato inválido.")
            if extension == "pdf":
                with office_workspace(request.user, item) as (_, working, _):
                    result = google(request.user, "GET", "/files/" + working["id"] + "/export", params={"mimeType": "application/pdf"}, raw=True)
            else:
                result = google(request.user, "GET", "/files/" + file_id(identity), params={"alt": "media", "supportsAllDrives": "true"}, raw=True)
        elif kind in exports:
            # "format" is reserved for DRF renderer negotiation; use a distinct export parameter.
            extension = request.query_params.get("export_format", "pdf")
            if extension not in exports[kind]:
                raise ValidationError("Formato inválido.")
            result = google(request.user, "GET", "/files/" + file_id(identity) + "/export", params={"mimeType": exports[kind][extension]}, raw=True)
        else:
            result = google(request.user, "GET", "/files/" + file_id(identity), params={"alt": "media", "supportsAllDrives": "true"}, raw=True)
        response = HttpResponse(result.content, content_type=result.headers.get("Content-Type", "application/octet-stream"))
        response["Cache-Control"] = "private, no-store"
        return response


class ThumbnailView(APIView):
    def get(self, request, identity):
        result = thumbnail(request.user, identity)
        response = HttpResponse(result.content, content_type=result.headers["Content-Type"])
        response["Cache-Control"] = "private, no-store"
        response["X-Content-Type-Options"] = "nosniff"
        return response


class DrivesView(APIView):
    def get(self, request):
        return Response(google(request.user, "GET", "/drives", params={"pageSize": 100, "fields": "nextPageToken,drives(id,name)", "pageToken": request.query_params.get("page", "")}))


class PermissionsView(APIView):
    def get(self, request, identity):
        metadata(request.user, identity)
        return Response(google(request.user, "GET", "/files/" + file_id(identity) + "/permissions", params={"fields": "nextPageToken,permissions(id,type,role,emailAddress,displayName,permissionDetails)", "pageSize": 100, "pageToken": request.query_params.get("page", ""), "supportsAllDrives": "true"}))

    def post(self, request, identity):
        require_capability(request.user, identity, "canShare")
        email = serializers.EmailField().run_validation(request.data.get("email"))
        role = request.data.get("role")
        if role not in ("reader", "commenter", "writer"):
            raise ValidationError("Rol inválido.")
        result = google(request.user, "POST", "/files/" + file_id(identity) + "/permissions", body={"type": "user", "emailAddress": email, "role": role}, params={"supportsAllDrives": "true", "sendNotificationEmail": "false"})
        audit(request, "shared", identity)
        return Response(result, status=201)


class PermissionView(APIView):
    def patch(self, request, identity, permission):
        require_capability(request.user, identity, "canShare")
        role = request.data.get("role")
        if role not in ("reader", "commenter", "writer"):
            raise ValidationError("Rol inválido.")
        result = google(request.user, "PATCH", "/files/" + file_id(identity) + "/permissions/" + file_id(permission), body={"role": role}, params={"supportsAllDrives": "true"})
        audit(request, "permission_updated", identity)
        return Response(result)

    def delete(self, request, identity, permission):
        require_capability(request.user, identity, "canShare")
        google(request.user, "DELETE", "/files/" + file_id(identity) + "/permissions/" + file_id(permission), params={"supportsAllDrives": "true"})
        audit(request, "permission_removed", identity)
        return Response(status=204)


class MoveView(APIView):
    def post(self, request, identity):
        target = file_id(str(request.data.get("parent", "")))
        item = metadata(request.user, identity)
        if item.get("trashed") or target == identity:
            raise ValidationError("Destino inválido.")
        if target != "root":
            destination = require_capability(request.user, target, "canAddChildren")
            if destination.get("mimeType") != MIMES["folder"] or destination.get("trashed"):
                raise ValidationError("Selecciona una carpeta disponible.")
            # Reject moving a folder into a descendant; cap traversal for malformed trees.
            if item.get("mimeType") == MIMES["folder"]:
                ancestor, seen = destination, set()
                for _ in range(100):
                    if ancestor["id"] == identity or ancestor["id"] in seen:
                        raise ValidationError("No puedes mover una carpeta dentro de sí misma.")
                    seen.add(ancestor["id"])
                    parents = ancestor.get("parents", [])
                    if not parents:
                        break
                    ancestor = metadata(request.user, parents[0])
                else:
                    raise ValidationError("La ruta del destino es demasiado profunda.")
        capabilities = item.get("capabilities", {})
        if not (capabilities.get("canMoveItemWithinDrive") or capabilities.get("canMoveItemOutOfDrive")):
            raise PermissionDenied("Google no permite mover este archivo.")
        if target in item.get("parents", []):
            return Response(item)
        params = {"addParents": target, "fields": FILE_FIELDS, "supportsAllDrives": "true"}
        if item.get("parents"):
            params["removeParents"] = ",".join(item["parents"])
        result = google(request.user, "PATCH", "/files/" + file_id(identity), body={}, params=params)
        audit(request, "moved", identity)
        return Response(result)


class AboutView(APIView):
    def get(self, request):
        return Response(google(request.user, "GET", "/about", params={"fields": "storageQuota,user(displayName,emailAddress,photoLink),folderColorPalette"}))


class PreviewView(APIView):
    def get(self, request, identity):
        item = require_capability(request.user, identity, "canDownload")
        mime = item.get("mimeType", "")
        if not (mime.startswith("image/") and mime != "image/svg+xml" or mime == "application/pdf"):
            raise ValidationError("Abre este formato en el visor de Google.")
        if int(item.get("size", 0)) > 20 * 1024 * 1024:
            raise ValidationError("Abre archivos de más de 20 MB en Google.")
        result = google(request.user, "GET", "/files/" + file_id(identity), params={"alt": "media", "supportsAllDrives": "true"}, raw=True)
        response = HttpResponse(result.content, content_type=mime)
        response["X-Content-Type-Options"] = "nosniff"
        response["Cache-Control"] = "private, no-store"
        return response
