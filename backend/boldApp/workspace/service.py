from datetime import timedelta
import re

import requests
from cryptography.fernet import InvalidToken
from django.conf import settings
from django.utils import timezone
from rest_framework.exceptions import APIException, NotFound, PermissionDenied, ValidationError

from boldApp.autenticacion.services import decrypt_secret, encrypt_secret
from .models import GoogleConnection

BASES = {
    "gmail": "https://gmail.googleapis.com/gmail/v1",
    "calendar": "https://www.googleapis.com/calendar/v3",
    "tasks": "https://tasks.googleapis.com/tasks/v1",
    "people": "https://people.googleapis.com/v1",
    "drive": "https://www.googleapis.com/drive/v3",
    "upload": "https://www.googleapis.com/upload/drive/v3",
    "docs": "https://docs.googleapis.com/v1",
    "sheets": "https://sheets.googleapis.com/v4",
    "slides": "https://slides.googleapis.com/v1",
}
MIMES = {"docs": "application/vnd.google-apps.document", "sheets": "application/vnd.google-apps.spreadsheet", "slides": "application/vnd.google-apps.presentation", "folder": "application/vnd.google-apps.folder"}
FILE_FIELDS = "id,name,mimeType,parents,modifiedTime,createdTime,viewedByMeTime,size,quotaBytesUsed,description,folderColorRgb,starred,trashed,webViewLink,capabilities,owners(displayName,emailAddress),shared,version,md5Checksum"


class GoogleUnavailable(APIException):
    status_code = 503
    default_detail = "Google no está disponible. Reintenta sin cerrar tus cambios."


class Reconnect(APIException):
    status_code = 409
    default_detail = "Vuelve a conectar tu cuenta de Google."


def configured():
    from .google_config import configuration
    return configuration()["configured"]


def file_id(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,200}", value):
        raise ValidationError("ID de archivo inválido.")
    return value


def access_token(user):
    from .google_config import credentials
    identity, secret = credentials()
    connection = GoogleConnection.objects.filter(user=user).first()
    if not connection:
        raise Reconnect("Conecta tu cuenta de Google para usar Drive y Docs.")
    if connection.client_id and connection.client_id != identity:
        raise Reconnect()
    try:
        if connection.expires_at and connection.expires_at > timezone.now() + timedelta(seconds=60):
            return decrypt_secret(connection.access_token_encrypted)
        response = requests.post("https://oauth2.googleapis.com/token", data={"client_id": identity, "client_secret": secret, "refresh_token": decrypt_secret(connection.refresh_token_encrypted), "grant_type": "refresh_token"}, timeout=15)
        if response.status_code in (400, 401):
            raise Reconnect()
        response.raise_for_status()
        token = response.json()
        connection.access_token_encrypted = encrypt_secret(token["access_token"])
        connection.expires_at = timezone.now() + timedelta(seconds=token.get("expires_in", 3600))
        connection.save(update_fields=["access_token_encrypted", "expires_at", "updated_at"])
        return token["access_token"]
    except (InvalidToken, ValueError, KeyError) as exc:
        raise Reconnect() from exc
    except requests.RequestException as exc:
        raise GoogleUnavailable() from exc


def google(user, method, path, *, api="drive", params=None, body=None, files=None, raw=False, extra_headers=None, timeout=None):
    # All hosts and resource paths are server-selected, never supplied as URLs by the browser.
    try:
        headers = {"Authorization": "Bearer " + access_token(user), **(extra_headers or {})}
        if files:
            prepared = requests.Request(method, BASES[api] + path, params=params, files=files, headers=headers).prepare()
            prepared.headers["Content-Type"] = prepared.headers["Content-Type"].replace("multipart/form-data", "multipart/related")
            with requests.Session() as session:
                response = session.send(prepared, timeout=40)
        else:
            response = requests.request(method, BASES[api] + path, params=params, json=body, headers=headers, timeout=timeout or (8 if api in ("people", "gmail") else 40))
    except requests.RequestException as exc:
        raise GoogleUnavailable() from exc
    if response.status_code == 401:
        GoogleConnection.objects.filter(user=user).update(expires_at=timezone.now())
        raise Reconnect()
    if response.status_code == 403:
        if any(reason in response.text for reason in ("SERVICE_DISABLED", "accessNotConfigured", "API_DISABLED")):
            error = PermissionDenied("Habilita esta API en el proyecto Google Cloud del cliente OAuth.")
            error.google_code = "api_disabled"
            raise error
        raise PermissionDenied("Tu cuenta Google no permite esta acción. Comprueba los permisos del archivo y las APIs habilitadas.")
    if response.status_code == 404:
        raise NotFound("El archivo no existe o tu cuenta no tiene acceso.")
    if response.status_code == 410 and method == "DELETE":
        return {}
    if response.status_code == 412:
        error = APIException("El archivo original cambió. Vuelve a cargar antes de guardar.")
        error.status_code = 409
        raise error
    if response.status_code == 429 or response.status_code >= 500:
        raise GoogleUnavailable()
    if response.status_code >= 400:
        raise ValidationError("Google rechazó los cambios. Comprueba el archivo y vuelve a cargar antes de reintentar.")
    return response if raw else response.json() if response.content else {}


def metadata(user, identity):
    return google(user, "GET", "/files/" + file_id(identity), params={"fields": FILE_FIELDS, "supportsAllDrives": "true"})


def require_capability(user, identity, capability):
    item = metadata(user, identity)
    if not item.get("capabilities", {}).get(capability):
        raise PermissionDenied("Google no te permite realizar esta acción en este archivo.")
    return item
