import base64
import binascii
import json
import logging
from io import BytesIO
from urllib.parse import quote, urlencode

from django.core.handlers.wsgi import WSGIRequest
from django.http import Http404
from django.urls import resolve
from rest_framework.exceptions import ValidationError
from urllib3.filepost import encode_multipart_formdata

from boldApp.administrativo.services import record_system_event
from .authentication import validate_authorization
from .catalog import operations


logger = logging.getLogger(__name__)
MAX_FILE_BYTES = 20 * 1024 * 1024
MAX_BODY_BYTES = 32 * 1024 * 1024
ALLOWED_HEADERS = {"if-match", "idempotency-key", "x-client-mutation-id"}


def request_body(data, files):
    if not files:
        return json.dumps(data, ensure_ascii=False).encode(), "application/json"
    fields = [(key, value if isinstance(value, str) else json.dumps(value)) for key, value in data.items()]
    total = 0
    for item in files:
        name = item.get("name", "")
        field = item.get("field", "")
        if not name or not field or any(character in name + field for character in "\r\n/\\\0"):
            raise ValidationError("Indica un nombre de archivo y un campo válidos.")
        encoded = item.get("base64", "")
        media_type = item.get("content_type", "application/octet-stream")
        if not isinstance(media_type, str) or any(character in media_type for character in "\r\n\0"):
            raise ValidationError("El tipo de archivo no es válido.")
        if not isinstance(encoded, str) or len(encoded) > (MAX_FILE_BYTES * 4 // 3 + 4):
            raise ValidationError("El archivo supera el límite permitido.")
        try:
            content = base64.b64decode(encoded, validate=True)
        except (binascii.Error, ValueError) as error:
            raise ValidationError("El contenido del archivo no es Base64 válido.") from error
        total += len(content)
        if total > MAX_FILE_BYTES:
            raise ValidationError("El conjunto de archivos supera 20 MB.")
        fields.append((field, (name, content, media_type)))
    return encode_multipart_formdata(fields)


def execute(authorization, operation_id, path_parameters=None, query=None, data=None, files=None, headers=None, *, write=False, describe=False):
    user, session = validate_authorization(authorization)
    operation = operations().get(operation_id)
    if not operation:
        raise ValidationError("Operación desconocida. Consulta primero bold_catalog.")
    if not describe and (operation.method != "GET") != write:
        raise ValidationError("Utiliza la herramienta de lectura o escritura correspondiente.")
    if write and "bold.write" not in authorization.scopes:
        raise ValidationError("Autoriza los cambios en BOLD para utilizar esta acción.")
    path_parameters = path_parameters or {}
    if set(path_parameters) != set(operation.parameters):
        raise ValidationError({"path_parameters": list(operation.parameters)})
    path = operation.path
    for key, value in path_parameters.items():
        value = str(value)
        if not value or any(character in value for character in "/\\\0%?#"):
            raise ValidationError("Identificador de recurso inválido.")
        path = path.replace("{" + key + "}", quote(value, safe=""))
    match = resolve(path)
    if match.func != operation.callback:
        raise Http404
    headers = headers or {}
    if not set(key.lower() for key in headers).issubset(ALLOWED_HEADERS):
        raise ValidationError("Solo se admiten cabeceras de versión e identificadores de operación.")
    body, content_type = request_body(data or {}, files or [])
    if len(body) > MAX_BODY_BYTES:
        raise ValidationError("La solicitud supera 32 MB.")
    from .oauth import public_origin
    from urllib.parse import urlsplit
    origin = urlsplit(public_origin())
    request = WSGIRequest({
        "REQUEST_METHOD": "OPTIONS" if describe else operation.method, "PATH_INFO": path,
        "QUERY_STRING": urlencode(query or {}, doseq=True),
        "SERVER_NAME": origin.hostname, "SERVER_PORT": str(origin.port or (443 if origin.scheme == "https" else 80)),
        "wsgi.url_scheme": origin.scheme, "wsgi.input": BytesIO(body),
        "CONTENT_LENGTH": str(len(body)), "CONTENT_TYPE": content_type,
        "HTTP_HOST": origin.netloc, "HTTP_X_ASSIGNMENT_ID": str(authorization.assignment_id),
        "HTTP_USER_AGENT": "BOLD MCP",
    })
    for key, value in headers.items():
        request.META["HTTP_" + key.upper().replace("-", "_")] = str(value)
    request._bold_mcp_authorization = authorization
    request.user = user
    request.auth = session
    response = match.func(request, **match.kwargs)
    if hasattr(response, "render"):
        response.render()
    try:
        if response.streaming:
            buffer = BytesIO()
            for chunk in response.streaming_content:
                if buffer.tell() + len(chunk) > MAX_FILE_BYTES:
                    raise ValidationError("El archivo supera 20 MB. Descárgalo desde BOLD.")
                buffer.write(chunk)
            content = buffer.getvalue()
        else:
            content = response.content
        if len(content) > MAX_BODY_BYTES:
            raise ValidationError("La respuesta es demasiado grande. Utiliza filtros o paginación.")
        media_type = response.get("Content-Type", "").split(";")[0]
        if media_type == "application/json":
            result = {"status": response.status_code, "data": json.loads(content or b"null")}
        elif media_type.startswith("text/"):
            result = {"status": response.status_code, "text": content.decode("utf-8", errors="replace")}
        else:
            result = {"status": response.status_code, "file": {
                "mime_type": media_type, "base64": base64.b64encode(content).decode("ascii"),
                "disposition": response.get("Content-Disposition", ""),
            }}
    finally:
        response.close()
    try:
        record_system_event(
            "mcp.operation", request, module_code="mcp", actor=user,
            target_type="mcp_authorization", target_id=authorization.pk,
            metadata={"operation": operation_id, "method": operation.method, "status": response.status_code},
        )
    except Exception:
        logger.exception("No se pudo registrar la operación MCP %s", operation_id)
    return result
