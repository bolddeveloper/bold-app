"""One encrypted OAuth client, with server-selected services and permission scopes."""
import hashlib
import json
from django.conf import settings
from django.db import transaction
from cryptography.fernet import InvalidToken
from rest_framework.exceptions import APIException, ValidationError
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView
from boldApp.administrativo.permissions import IsCompanyOwner
from boldApp.administrativo.services import record_system_event
from boldApp.autenticacion.services import decrypt_secret, encrypt_secret
from .models import GoogleOAuthConfiguration, GoogleConnection

SCOPES = {
    "gmail": {"https://www.googleapis.com/auth/gmail.readonly"},
    "drive": {"https://www.googleapis.com/auth/drive"},
    "calendar": {"https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.calendars.readonly"},
    "tasks": {"https://www.googleapis.com/auth/tasks"},
    "contacts": {"https://www.googleapis.com/auth/contacts.readonly", "https://www.googleapis.com/auth/contacts.other.readonly"},
}
for editor in ("docs", "sheets", "slides"):
    SCOPES[editor] = SCOPES["drive"]


def configuration():
    row = GoogleOAuthConfiguration.objects.filter(pk=1).first()
    if row:
        return {"configured": row.enabled and bool(row.client_id and row.client_secret_encrypted), "client_id": row.client_id, "secret": row.client_secret_encrypted, "version": str(row.version), "source": "managed", "project_id": row.project_id}
    identity = settings.GOOGLE_WORKSPACE_CLIENT_ID
    return {"configured": bool(identity and settings.GOOGLE_WORKSPACE_CLIENT_SECRET and settings.GOOGLE_WORKSPACE_REDIRECT_URI), "client_id": identity, "secret": "", "version": "env-" + hashlib.sha256(identity.encode()).hexdigest()[:16], "source": "server", "project_id": ""}


def credentials():
    config = configuration()
    if not config["configured"]:
        raise ValidationError("El dueño debe configurar el cliente Google en Conectores.")
    try:
        secret = decrypt_secret(config["secret"]) if config["source"] == "managed" else settings.GOOGLE_WORKSPACE_CLIENT_SECRET
    except (InvalidToken, ValueError):
        raise ValidationError("No se pudo descifrar la configuración Google. El dueño debe volver a subir el JSON.")
    return config["client_id"], secret


def services(connection, config=None):
    config = config or configuration()
    granted = set(connection.scopes.split()) if connection else set()
    return {key: {"status": "unconfigured" if not config["configured"] else "available" if connection and (not connection.client_id or connection.client_id == config["client_id"]) and required <= granted else "authorization_required"} for key, required in SCOPES.items()}


def public_connection(user):
    config = configuration()
    connection = GoogleConnection.objects.filter(user=user).first() if config["configured"] else None
    if connection and connection.client_id and connection.client_id != config["client_id"]:
        connection = None
    from urllib.parse import urlparse
    callback = urlparse(settings.GOOGLE_WORKSPACE_REDIRECT_URI)
    return {"configured": config["configured"], "connected": bool(connection), "email": connection.email if connection else "", "connection_key": hashlib.sha256(f"{user.pk}:{connection.subject}:{config['version']}:{sorted(connection.scopes.split())}".encode()).hexdigest() if connection else "", "configuration_version": config["version"], "preference_key": str(user.pk), "services": services(connection, config), "time_zone": connection.time_zone if connection else "UTC", "callback_origin": f"{callback.scheme}://{callback.netloc}", "owner": user.is_superuser}


class ConfigurationView(APIView):
    permission_classes = [IsCompanyOwner]
    parser_classes = [MultiPartParser]

    def get(self, request):
        config = configuration()
        return Response({key: config[key] for key in ("configured", "client_id", "version", "source", "project_id")} | {"callback": settings.GOOGLE_WORKSPACE_REDIRECT_URI})

    def put(self, request):
        upload = request.FILES.get("file")
        if not upload or upload.size > 65536:
            raise ValidationError("Sube el JSON OAuth de Google Cloud, de hasta 64 KB.")
        try:
            data = json.loads(upload.read().decode("utf-8-sig"))
            web = data["web"]
            identity, secret = web["client_id"], web["client_secret"]
            if not isinstance(identity, str) or not identity.endswith(".apps.googleusercontent.com") or len(identity) > 255 or not isinstance(secret, str) or not 1 <= len(secret) <= 4096:
                raise ValueError()
            redirects = web.get("redirect_uris", [])
            if not isinstance(redirects, list) or not all(isinstance(url, str) for url in redirects) or settings.GOOGLE_WORKSPACE_REDIRECT_URI not in redirects:
                raise ValueError()
            project = web.get("project_id", "")
            if not isinstance(project, str) or len(project) > 255:
                raise ValueError()
        except (ValueError, KeyError, TypeError, UnicodeError):
            raise ValidationError("JSON inválido. Usa un cliente de Aplicación web con el callback de BOLD autorizado.")
        with transaction.atomic():
            row, created = GoogleOAuthConfiguration.objects.select_for_update().get_or_create(pk=1)
            previous_client = settings.GOOGLE_WORKSPACE_CLIENT_ID if created else row.client_id
            if previous_client != identity:
                GoogleConnection.objects.all().delete()
            row.enabled, row.client_id, row.client_secret_encrypted, row.project_id = True, identity, encrypt_secret(secret), project
            row.version += 1
            row.save()
        record_system_event("google.configuration_updated", request, module_code="administration")
        return self.get(request)

    def delete(self, request):
        with transaction.atomic():
            row, _ = GoogleOAuthConfiguration.objects.select_for_update().get_or_create(pk=1)
            row.enabled, row.client_id, row.client_secret_encrypted, row.project_id = False, "", "", ""
            row.version += 1
            row.save()
            GoogleConnection.objects.all().delete()
        record_system_event("google.configuration_removed", request, module_code="administration")
        return Response({"configured": False, "version": str(row.version)})


class VerifyView(APIView):
    permission_classes = [IsCompanyOwner]

    def post(self, request):
        from .service import google
        config = configuration()
        results = public_connection(request.user)["services"]
        probes = {"gmail": ("gmail", "/users/me/profile", {"fields": "emailAddress"}), "drive": ("drive", "/files", {"pageSize": 1, "fields": "files(id)"}), "calendar": ("calendar", "/calendars/primary", {"fields": "id,timeZone"}), "tasks": ("tasks", "/users/@me/lists", {"maxResults": 1}), "contacts": ("people", "/people/me/connections", {"pageSize": 1, "personFields": "names"})}
        for key, (api, path, params) in probes.items():
            if results[key]["status"] != "available":
                continue
            try:
                google(request.user, "GET", path, api=api, params=params)
                results[key] = {"status": "available", "verified": True}
            except APIException as error:
                code = getattr(error, "google_code", "")
                results[key] = {"status": "api_disabled" if code == "api_disabled" else "reconnect_required" if error.status_code == 409 else "temporary_error" if error.status_code >= 500 else "permission_denied", "message": str(error.detail)}
        from .service import MIMES
        for editor, resource, field in (("docs", "documents", "documentId"), ("sheets", "spreadsheets", "spreadsheetId"), ("slides", "presentations", "presentationId")):
            if results[editor]["status"] != "available":
                continue
            try:
                files = google(request.user, "GET", "/files", params={"q": "trashed=false and mimeType='" + MIMES[editor] + "'", "pageSize": 1, "fields": "files(id)"}).get("files", [])
                if not files:
                    results[editor] = {"status": "unknown", "message": "Autorizado; no hay un archivo de este tipo para comprobar su API sin crear uno."}
                    continue
                google(request.user, "GET", "/" + resource + "/" + files[0]["id"], api=editor, params={"fields": field})
                results[editor] = {"status": "available", "verified": True}
            except APIException as error:
                results[editor] = {"status": "api_disabled" if getattr(error, "google_code", "") == "api_disabled" else "reconnect_required" if error.status_code == 409 else "temporary_error" if error.status_code >= 500 else "permission_denied", "message": str(error.detail)}
        return Response({"configured": config["configured"], "services": results, "callback": settings.GOOGLE_WORKSPACE_REDIRECT_URI, "note": "La configuración no prueba autorización sin una cuenta conectada. Estas verificaciones solo consultan metadatos; no crean ni modifican archivos."})
