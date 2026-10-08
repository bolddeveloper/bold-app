"""Private, resource-authorized image storage using the selected administrator's Drive."""
import base64
import binascii
import hashlib
import json
import re
import uuid
from threading import RLock
from html import escape
from html.parser import HTMLParser
from urllib.parse import urlsplit

from django.db import transaction
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError

from .models import GoogleConnection, ImageBinding, ImageStorageFolder, ImageStorageRoot, StoredImage
from .service import google, metadata, MIMES, Reconnect

IMAGE_PATH = re.compile(r"^/api/v2/media/images/([0-9a-f-]{36})/$")
MIME_EXTENSIONS = {"image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp"}


def image_id(value):
    if not isinstance(value, str):
        return None
    try:
        match = IMAGE_PATH.fullmatch(urlsplit(value).path)
    except ValueError:
        return None
    if not match:
        return None
    try:
        return uuid.UUID(match[1])
    except ValueError:
        return None


def image_url(image):
    return f"/api/v2/media/images/{image.pk}/"


def storage_user(root):
    from .google_config import configuration
    config = configuration()
    connection = GoogleConnection.objects.filter(user=root.user, subject=root.subject, client_id=config["client_id"]).first()
    if not root.user.is_active or not config["configured"] or not connection or "https://www.googleapis.com/auth/drive" not in connection.scopes.split():
        raise Reconnect("La cuenta del almacenamiento de imágenes debe volver a conectar Drive.")
    return root.user


def resource(kind, identity):
    from boldApp.core.models import UserAccount, JobRole
    from boldApp.autenticacion.models import PrivateNote
    from boldApp.tareas.models import Task, Project, Comment, Attachment
    from boldApp.sugerencias.models import Suggestion
    from .models import ImageDocument
    if kind == "note":
        return PrivateNote.objects.filter(user_id=identity).first()
    model = {"profile": UserAccount, "task": Task, "project": Project, "comment": Comment, "attachment": Attachment, "suggestion": Suggestion, "role": JobRole, "document": ImageDocument}.get(kind)
    return model.objects.filter(pk=identity).first() if model else None


def resource_key(instance):
    name = instance._meta.model_name
    kind = {"useraccount": "profile", "privatenote": "note", "jobrole": "role", "imagedocument": "document"}.get(name, name)
    return kind, instance.user_id if kind == "note" else instance.pk


def can_read(request, kind, instance, field=None, image=None):
    if not instance or getattr(instance, "deleted_at", None):
        return False
    if kind == "profile":
        return instance.is_active and instance.employee.is_active
    if kind == "note":
        return instance.user_id == request.user.pk
    if kind == "document":
        return can_read_document(request, instance, image)
    from boldApp.core.permissions import HasActiveAssignment
    if not HasActiveAssignment().has_permission(request, None):
        return False
    if kind == "role":
        return True
    if kind == "suggestion":
        from boldApp.sugerencias.views import SuggestionViewSet
        view = SuggestionViewSet()
        view.request, view.action = request, "retrieve"
        return view.get_queryset().filter(pk=instance.pk).exists() and (field != "internal_note" or view._can("suggestions.feedback.manage", instance.unit, instance.id))
    from boldApp.tareas.views import AssignmentScopedViewSetMixin
    view = AssignmentScopedViewSetMixin()
    view.request = request
    if kind == "project":
        return view.visible_projects().filter(pk=instance.pk).exists()
    task = instance if kind == "task" else instance.task
    return not task.deleted_at and view.visible_tasks(type(task).objects.filter(pk=task.pk)).exists()


def authorized_image(request, image):
    for binding in image.bindings.all():
        instance = resource(binding.resource_kind, binding.resource_id)
        if instance and image_url(image) in json.dumps(getattr(instance, binding.field, None), default=str) and can_read(request, binding.resource_kind, instance, binding.field, image):
            return True
    return False


def rename_instance_folders(instance):
    kind, identity = resource_key(instance)
    if kind == "project":
        keys, name = [f"project:{identity}"], instance.name
    elif kind == "task":
        keys, name = [f"task:{identity}"], instance.title
    elif kind == "role":
        keys, name = [f"role:{identity}"], instance.title
    elif kind == "document":
        keys, name = [f"workspace:{instance.external_id}" if instance.kind == "workspace" else f"document:{identity}"], instance.title
    elif kind == "profile":
        keys, name = [f"user:{identity}", f"user:{instance.employee_id}"], instance.employee.full_name
    else:
        return
    for key in keys:
        for row in ImageStorageFolder.objects.filter(key__endswith=key).exclude(name=name[:240]).select_related("root__user"):
            try:
                google(storage_user(row.root), "PATCH", "/files/" + row.drive_id, body={"name": name[:240]}, params={"supportsAllDrives": "true"})
            except APIException:
                # ponytail: retry folder labels on the next save/migration; disconnected Drive must not block text edits.
                continue
            row.name = name[:240]
            row.save(update_fields=["name"])


def person_name(assignment):
    return assignment.employee.full_name


def task_path(task):
    from boldApp.tareas.models import Task, Project
    if not task.image_origin_set:
        link = task.task_projects.order_by("added_at", "pk").first()
        task.image_origin_project_id = link.project_id if link else None
        task.image_origin_set = True
        Task.objects.filter(pk=task.pk).update(image_origin_project_id=task.image_origin_project_id, image_origin_set=True)
    project = Project.objects.filter(pk=task.image_origin_project_id).first() if task.image_origin_project_id else None
    if project:
        prefix = [("projects", "Proyectos"), (f"project:{project.pk}", project.name), ("tasks", "Tareas")]
    else:
        creator = task.created_by_assignment
        prefix = [("personal", "Mis tareas"), (f"user:{creator.employee_id}", person_name(creator))]
    if task.parent_task_id:
        return task_path(task.parent_task) + [("subtasks", "Subtareas"), (f"task:{task.pk}", task.title)]
    return prefix + [(f"task:{task.pk}", task.title)]


def folders_for(instance, field):
    kind, identity = resource_key(instance)
    if kind in ("task", "comment", "attachment"):
        task = instance if kind == "task" else instance.task
        if kind == "comment" and instance.image_section == "timeline" and instance.image_project_id:
            from boldApp.tareas.models import Project
            project = Project.objects.get(pk=instance.image_project_id)
            return [("projects", "Proyectos"), (f"project:{project.pk}", project.name), ("timeline", "Cronograma")]
        category = "Descripción" if kind == "task" else "Comentarios" if kind == "comment" else "Adjuntos"
        return task_path(task) + [(category.casefold(), category)]
    if kind == "project":
        path = [("projects", "Proyectos"), (f"project:{identity}", instance.name)]
        return path if field == "avatar_data_url" else path + [("description", "Descripción")]
    if kind == "profile":
        return [("profiles", "Perfiles"), (f"user:{identity}", instance.employee.full_name)]
    if kind == "note":
        return [("notes", "Notas privadas"), (f"user:{identity}", instance.user.employee.full_name), ("images", "Imágenes")]
    if kind == "role":
        return [("administration", "Administración"), ("roles", "Cargos"), (f"role:{identity}", instance.title), ("description", "Descripción")]
    if kind == "document":
        if instance.kind == "workspace":
            return [("workspaces", "Workspace"), (f"workspace:{instance.external_id}", instance.title), ("description", "Descripción")]
        return [("calendar", "Calendario"), (f"user:{instance.owner_id}", instance.owner.employee.full_name), (instance.kind, "Tareas" if instance.kind == "calendar_task" else "Eventos"), (f"document:{identity}", instance.title), ("description", "Descripción")]
    if kind == "suggestion":
        return [("suggestions", "Sugerencias"), (f"suggestion:{identity}", f"{instance.title or 'Reporte'} · {str(identity)[:8]}"), (field, "Capturas" if field == "screenshots" else "Seguimiento" if field == "internal_note" else "Descripción")]
    raise ValidationError("Este módulo no admite imágenes almacenadas.")


def drive_folder(root, path):
    user, parent, parts = storage_user(root), root.folder_id, []
    for key, label in path:
        parts.append(key)
        key = "/".join(parts)
        name = label.strip()[:240] or "Sin nombre"
        row = ImageStorageFolder.objects.filter(root=root, key=key).first()
        if not row:
            # Recover completed remote creates after a database rollback, without touching unrelated folders.
            marker = hashlib.sha256(f"{root.pk}:{key}".encode()).hexdigest()
            files = google(user, "GET", "/files", params={"q": f"'{parent}' in parents and trashed=false and appProperties has {{ key='bold_folder' and value='{marker}' }}", "fields": "files(id)", "supportsAllDrives": "true", "includeItemsFromAllDrives": "true"}).get("files", [])
            result = files[0] if files else google(user, "POST", "/files", body={"name": name, "mimeType": MIMES["folder"], "parents": [parent], "appProperties": {"bold_folder": marker}}, params={"fields": "id", "supportsAllDrives": "true"})
            row = ImageStorageFolder.objects.create(root=root, key=key, drive_id=result["id"], name=name)
        if row.name != name:
            google(user, "PATCH", "/files/" + row.drive_id, body={"name": name}, params={"supportsAllDrives": "true"})
            row.name = name
            row.save(update_fields=["name"])
        parent = row.drive_id
    return parent


def decode_image(value):
    try:
        header, encoded = value.split(",", 1)
        mime = header.removeprefix("data:").removesuffix(";base64").lower()
        if header.lower() != f"data:{mime};base64" or mime not in MIME_EXTENSIONS:
            raise ValueError()
        content = base64.b64decode(encoded, validate=True)
        valid = {"image/png": content.startswith(b"\x89PNG\r\n\x1a\n"), "image/jpeg": content.startswith(b"\xff\xd8\xff"), "image/gif": content.startswith((b"GIF87a", b"GIF89a")), "image/webp": content.startswith(b"RIFF") and content[8:12] == b"WEBP"}
        if not valid[mime]:
            raise ValueError()
        return mime, content
    except (ValueError, binascii.Error) as exc:
        raise ValidationError("Imagen inválida. Usa PNG, JPEG, GIF o WebP.") from exc


# ponytail: serialize image uploads within this backend process; use a distributed lock with multiple workers.
_image_upload_lock = RLock()


def persist_image(value, instance, field, request=None):
    with _image_upload_lock:
        return _persist_image(value, instance, field, request)


def _persist_image(value, instance, field, request=None):
    kind, identity = resource_key(instance)
    stored_id = image_id(value)
    if stored_id:
        image = StoredImage.objects.filter(pk=stored_id).first()
        if not image or request is not None and not authorized_image(request, image):
            raise PermissionDenied("No puedes reutilizar esta imagen.")
    else:
        mime, content = decode_image(value)
        root = ImageStorageRoot.objects.filter(active=True).select_related("user").first()
        if not root:
            raise ValidationError("Configura Almacenamiento de imágenes en Administración → Conectores antes de subir imágenes.")
        user = storage_user(root)
        folder = drive_folder(root, folders_for(instance, field))
        digest = hashlib.sha256(content).hexdigest()
        stable_id = uuid.uuid5(uuid.NAMESPACE_URL, f"bold-image:{root.pk}:{kind}:{identity}:{field}:{digest}")
        image = StoredImage.objects.filter(pk=stable_id).first()
        if not image:
            existing = google(user, "GET", "/files", params={"q": f"'{folder}' in parents and trashed=false and appProperties has {{ key='bold_image' and value='{stable_id}' }}", "fields": "files(id)", "supportsAllDrives": "true", "includeItemsFromAllDrives": "true"}).get("files", [])
            name = f"{kind}-{str(identity)[:8]}-{digest[:16]}.{MIME_EXTENSIONS[mime]}"
            result = existing[0] if existing else google(user, "POST", "/files", api="upload", params={"uploadType": "multipart", "fields": "id", "supportsAllDrives": "true"}, files={"metadata": (None, json.dumps({"name": name, "parents": [folder], "appProperties": {"bold_image": str(stable_id)}}), "application/json"), "file": (name, content, mime)})
            image = StoredImage.objects.create(id=stable_id, root=root, drive_id=result["id"], mime_type=mime, size_bytes=len(content))
    ImageBinding.objects.get_or_create(image=image, resource_kind=kind, resource_id=identity, field=field)
    return image_url(image)


class ImageHTML(HTMLParser):
    def __init__(self, instance, field, request):
        super().__init__(convert_charrefs=False)
        self.instance, self.field, self.request, self.output = instance, field, request, []

    def handle_starttag(self, tag, attrs):
        if tag != "img":
            self.output.append(self.get_starttag_text())
            return
        attrs = dict(attrs)
        value = attrs.get("src", "")
        if not value:
            raise ValidationError("La imagen no tiene contenido válido.")
        attrs["src"] = persist_image(value, self.instance, self.field, self.request)
        self.output.append("<img " + " ".join(f'{key}="{escape(value or "", quote=True)}"' for key, value in attrs.items() if key in ("src", "alt", "width", "height")) + ">")

    def handle_startendtag(self, tag, attrs):
        if tag == "img":
            self.handle_starttag(tag, attrs)
        else:
            self.output.append(self.get_starttag_text())

    def handle_endtag(self, tag):
        self.output.append(f"</{tag}>")

    def handle_data(self, data):
        self.output.append(data)

    def handle_entityref(self, name):
        self.output.append(f"&{name};")

    def handle_charref(self, name):
        self.output.append(f"&#{name};")

    def handle_comment(self, data):
        self.output.append(f"<!--{data}-->")


IMAGE_FIELDS = {"profile": ("avatar_url",), "project": ("avatar_data_url", "description"), "task": ("description",), "comment": ("body",), "attachment": ("file_url",), "suggestion": ("message", "screenshots", "internal_note"), "note": ("content",), "role": ("description",), "document": ("content",)}


def store_instance_images(instance, request=None, fields=None, write=True):
    kind, _ = resource_key(instance)
    changed = []
    for field in IMAGE_FIELDS.get(kind, ()):
        if fields is not None and field not in fields:
            continue
        value = getattr(instance, field)
        if field == "screenshots":
            updated = [{**item, "data_url": persist_image(item["data_url"], instance, field, request)} for item in value]
        elif field in ("avatar_url", "avatar_data_url", "file_url"):
            updated = persist_image(value, instance, field, request) if value and (value.startswith("data:image/") or image_id(value)) else value
        elif value and re.search(r"<img\b", value, re.I):
            parser = ImageHTML(instance, field, request)
            parser.feed(value)
            parser.close()
            updated = "".join(parser.output)
        else:
            updated = value
        if updated != value:
            setattr(instance, field, updated)
            changed.append(field)
    if changed and write:
        type(instance).objects.filter(pk=instance.pk).update(**{field: getattr(instance, field) for field in changed})
    return instance


class DriveImagesMixin:
    @transaction.atomic
    def save(self, **kwargs):
        instance = super().save(**kwargs)
        store_instance_images(instance, self.context.get("request"), fields=self.validated_data.keys())
        if "name" in self.validated_data or "title" in self.validated_data:
            rename_instance_folders(instance)
        return instance


def can_read_document(request, document, image=None):
    if document.kind == "workspace":
        from boldApp.core.permissions import HasActiveAssignment
        return document.owner_id == request.user.pk and HasActiveAssignment().has_permission(request, None) and document.assignment_id == request.assignment.pk
    if image is None:
        return False
    from boldApp.calendario.service import google_request, event_path
    from .models import GoogleConnection
    connection = GoogleConnection.objects.filter(user=request.user).first()
    if not connection:
        return False
    try:
        if document.kind == "calendar":
            event = google_request(request.user, "GET", event_path(document.external_id))
            return event.get("status") != "cancelled" and image_url(image) in event.get("description", "")
        if document.kind == "calendar_task" and document.owner_id == request.user.pk and document.google_subject == connection.subject:
            from boldApp.calendario.views import _task_path, TASKS_API
            list_id, task_id = document.external_id.split("/", 1)
            task = google_request(request.user, "GET", _task_path(list_id, task_id), base=TASKS_API)
            return not task.get("deleted") and image_url(image) in task.get("notes", "")
    except (APIException, ValueError):
        return False
    return False


def prepare_document(request, kind, external_id, title, content):
    from .models import ImageDocument
    from boldApp.core.permissions import HasActiveAssignment
    if kind == "workspace" and not HasActiveAssignment().has_permission(request, None):
        raise PermissionDenied("Selecciona una asignación activa.")
    connection = GoogleConnection.objects.filter(user=request.user).first() if kind != "workspace" else None
    if kind != "workspace" and not connection:
        raise Reconnect("Conecta tu cuenta de Google.")
    document, _ = ImageDocument.objects.select_for_update().get_or_create(owner=request.user, google_subject=connection.subject if connection else "", kind=kind, external_id=external_id,
        defaults={"title": title[:255], "assignment_id": request.assignment.pk if kind == "workspace" else None})
    if kind == "workspace" and document.assignment_id != request.assignment.pk:
        raise PermissionDenied("La carpeta pertenece a otra asignación.")
    document.title, document.content = (title or document.title)[:255], content
    document.save(update_fields=["title", "content"])
    store_instance_images(document, request)
    rename_instance_folders(document)
    return document


def provider_images(request, kind, data, external_id="", title=""):
    """Reserve private references before sending Calendar/Tasks content to Google."""
    field = "description" if kind == "calendar" else "notes"
    if field not in data:
        return None
    content = data[field]
    if not re.search(r"<img\b", content, re.I):
        if len(content) > (8000 if kind == "calendar" else 8192):
            raise ValidationError("El texto supera el límite permitido por Google.")
        from .models import ImageDocument
        connection = GoogleConnection.objects.filter(user=request.user).first()
        if connection:
            ImageDocument.objects.filter(owner=request.user, google_subject=connection.subject, kind=kind, external_id=external_id).update(content=content)
        return None
    document = prepare_document(request, kind, external_id or str(uuid.uuid4()), data.get("summary", data.get("title", title)) or "Sin título", content)
    data[field] = document.content
    if len(document.content) > (8000 if kind == "calendar" else 8192):
        raise ValidationError("El contenido supera el límite permitido por Google. Reduce el texto o las imágenes.")
    return document
