"""Channel attachments in the configured corporate root, never public Drive URLs."""
import json
import uuid

from rest_framework.exceptions import ValidationError
from boldApp.workspace.image_storage import drive_folder, storage_user
from boldApp.workspace.models import ImageStorageRoot
from boldApp.workspace.service import file_id, google
from .media import EXTENSIONS
from .models import ChannelMedia


def store_channel_media(message, prepared):
    root = ImageStorageRoot.objects.select_for_update().filter(active=True).select_related("user").first()
    if not root:
        raise ValidationError("Configura el destino corporativo de Drive en Administración → Conectores para enviar archivos.")
    user = storage_user(root)
    folder = drive_folder(root, [("slack", "Slack"),
        (f"department:{message.channel.unit_id}", f"Departamento · {message.channel.unit_id}"),
        (f"channel:{message.channel_id}", f"Canal · {message.channel_id}"),
        (f"employee:{message.author_id}", f"Empleado · {message.author_id}")])
    identity = uuid.uuid5(uuid.NAMESPACE_URL, f"bold-slack:{message.channel_id}:{message.author_id}:{message.client_id}:{prepared['digest']}")
    marker = str(identity)
    existing = google(user, "GET", "/files", params={"q": f"'{folder}' in parents and trashed=false and appProperties has {{ key='bold_slack_media' and value='{marker}' }}",
        "fields": "files(id)", "supportsAllDrives": "true", "includeItemsFromAllDrives": "true"}).get("files", [])
    name = f"{prepared['kind']}-{marker}.{EXTENSIONS[prepared['mime_type']]}"
    result = existing[0] if existing else google(user, "POST", "/files", api="upload",
        params={"uploadType": "multipart", "fields": "id", "supportsAllDrives": "true"},
        files={"metadata": (None, json.dumps({"name": name, "parents": [folder], "appProperties": {"bold_slack_media": marker}}), "application/json"),
               "file": (name, prepared["content"], prepared["mime_type"])})
    return ChannelMedia.objects.create(id=identity, message=message, root=root, drive_id=file_id(result["id"]),
        **{key: value for key, value in prepared.items() if key != "content"})
