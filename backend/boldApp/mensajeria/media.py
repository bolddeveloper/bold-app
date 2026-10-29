"""Private chat media. Drive IDs and tokens never leave the backend.

One bounded attachment per message; deterministic markers recover a completed
Drive upload after an interrupted transaction. No public Drive permission is made.
"""
import hashlib
import io
import json
import uuid
import warnings
import unicodedata

from PIL import Image, ImageOps, UnidentifiedImageError
from django.core.files.uploadhandler import FileUploadHandler
from rest_framework.exceptions import ValidationError
from boldApp.workspace.models import ImageStorageRoot
from boldApp.workspace.image_storage import drive_folder, storage_user
from boldApp.workspace.service import google, file_id
from .models import MessageMedia
from .document_uploads import DOCUMENT_MIMES, prepare_document

MAX_BYTES = 10 * 1024 * 1024
MAX_PIXELS = 24_000_000
EXTENSIONS = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp",
              "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", **{mime: extension for extension, mime in DOCUMENT_MIMES.items()}}


class BoundedUpload(FileUploadHandler):
    """Reject excess while parsing, not after a huge file is written to disk."""
    def __init__(self, request=None):
        super().__init__(request)
        self.total = 0
        self.files_seen = 0

    def new_file(self, *args, **kwargs):
        super().new_file(*args, **kwargs)
        self.files_seen += 1
        if self.files_seen > 1:
            raise ValidationError("Envía un archivo por mensaje: imagen, nota de voz o documento.")

    def receive_data_chunk(self, raw_data, start):
        self.total += len(raw_data)
        if self.total > MAX_BYTES:
            raise ValidationError("El archivo supera los 10 MB.")
        return raw_data

    def file_complete(self, file_size):
        return None


def prepare(upload):
    if not upload or not 0 < upload.size <= MAX_BYTES:
        raise ValidationError("Cada archivo debe pesar como máximo 10 MB y no estar vacío.")
    content = upload.read(MAX_BYTES + 1)
    if len(content) > MAX_BYTES:
        raise ValidationError("El archivo supera los 10 MB.")
    mime = (upload.content_type or "").split(";")[0].lower()
    width = height = None
    if mime.startswith("image/"):
        if mime not in ("image/png", "image/jpeg", "image/webp"):
            raise ValidationError("Usa una imagen PNG, JPEG o WebP.")
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(io.BytesIO(content)) as source:
                    if source.format not in ("PNG", "JPEG", "WEBP") or source.width * source.height > MAX_PIXELS:
                        raise ValueError()
                    source.load()
                    image = ImageOps.exif_transpose(source)
                    image.thumbnail((2560, 2560))
                    # Re-encode pixels only: discard GPS, EXIF, comments and other metadata.
                    image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
                    clean = Image.new(image.mode, image.size)
                    clean.paste(image)
                    width, height = clean.size
                    output = io.BytesIO()
                    clean.save(output, format="WEBP", quality=88, method=4)
                    content, mime = output.getvalue(), "image/webp"
        except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
            raise ValidationError("La imagen no es válida o supera los 24 megapíxeles.") from exc
        kind = "image"
    elif mime.startswith("audio/"):
        signatures = {"audio/webm": content.startswith(b"\x1aE\xdf\xa3") and b"webm" in content[:4096],
                      "audio/ogg": content.startswith(b"OggS") and b"OpusHead" in content[:4096],
                      "audio/mp4": len(content) > 12 and content[4:8] == b"ftyp"}
        if not signatures.get(mime):
            raise ValidationError("La nota de voz debe ser WebM, Ogg/Opus o M4A válida.")
        kind = "audio"
    else:
        mime = prepare_document(upload.name, mime, content)
        kind = "document"
    # Display/search metadata only. Never retain the sender's local path or use
    # this name as a filesystem path, Drive destination or response header.
    filename = str(upload.name or "").replace("\\", "/").rsplit("/", 1)[-1]
    filename = "".join(char for char in filename if not unicodedata.category(char).startswith("C"))[:180]
    return {"content": content, "mime_type": mime, "kind": kind, "width": width, "height": height, "filename": filename,
            "digest": hashlib.sha256(content).hexdigest(), "size_bytes": len(content)}


def store(message, prepared):
    # This lock also serializes creation of the common corporate folder by
    # concurrent pilot uploads. No user-selected remote IDs/paths are accepted.
    root = ImageStorageRoot.objects.select_for_update().filter(active=True).select_related("user").first()
    if not root:
        raise ValidationError("Configura el destino corporativo de Drive en Administración → Conectores para enviar archivos.")
    user = storage_user(root)
    folder = drive_folder(root, [("chat", "Chat"),
        (f"employee:{message.author_id}", f"Empleado · {message.author_id}"),
        (f"conversation:{message.conversation_id}", f"Conversación · {message.conversation_id}")])
    identity = uuid.uuid5(uuid.NAMESPACE_URL, f"bold-chat:{message.conversation_id}:{message.author_id}:{message.client_id}:{prepared['digest']}")
    marker = str(identity)
    existing = google(user, "GET", "/files", params={"q": f"'{folder}' in parents and trashed=false and appProperties has {{ key='bold_chat_media' and value='{marker}' }}",
        "fields": "files(id)", "supportsAllDrives": "true", "includeItemsFromAllDrives": "true"}).get("files", [])
    name = f"{prepared['kind']}-{marker}.{EXTENSIONS[prepared['mime_type']]}"
    result = existing[0] if existing else google(user, "POST", "/files", api="upload",
        params={"uploadType": "multipart", "fields": "id", "supportsAllDrives": "true"},
        files={"metadata": (None, json.dumps({"name": name, "parents": [folder], "appProperties": {"bold_chat_media": marker}}), "application/json"),
               "file": (name, prepared["content"], prepared["mime_type"])})
    return MessageMedia.objects.create(id=identity, message=message, root=root, drive_id=file_id(result["id"]),
        **{key: value for key, value in prepared.items() if key != "content"})


def media_data(message):
    media = getattr(message, "media", None)
    if media is None:
        return None
    return {"id": str(media.pk), "kind": media.kind, "mime_type": media.mime_type,
            "size_bytes": media.size_bytes, "width": media.width, "height": media.height, "filename": media.filename}


def private_media_response(media):
    # Both domains authorize their own parent resource before entering here.
    # This helper never decides membership and never exposes a remote identifier.
    from django.http import HttpResponse
    from boldApp.workspace.image_storage import storage_user
    from boldApp.workspace.service import google, file_id
    result = google(storage_user(media.root), "GET", "/files/" + file_id(media.drive_id),
        params={"alt": "media", "supportsAllDrives": "true"}, raw=True)
    content = result.content
    if len(content) != media.size_bytes or hashlib.sha256(content).hexdigest() != media.digest:
        raise ValidationError("El archivo de Drive cambió fuera de BOLD. No se puede mostrar esta versión.")
    response = HttpResponse(content, content_type=media.mime_type)
    disposition = "attachment" if media.kind == "document" else "inline"
    response["Content-Disposition"] = f'{disposition}; filename="bold-{media.kind}-{media.pk}.{EXTENSIONS[media.mime_type]}"'
    response["X-Content-Type-Options"] = "nosniff"
    response["Content-Security-Policy"] = "default-src 'none'; sandbox"
    return response
