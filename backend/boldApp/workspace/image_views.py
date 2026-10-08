from django.db import transaction
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import APIException, NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from boldApp.administrativo.services import record_system_event
from .google_config import IsConnectorAdministrator, configuration
from .image_storage import authorized_image, storage_user
from .models import GoogleConnection, ImageStorageRoot, StoredImage
from .service import google, metadata, file_id, MIMES


class ImageStorageConfigurationView(APIView):
    permission_classes = [IsConnectorAdministrator]

    def get(self, request):
        config = configuration()
        connection = GoogleConnection.objects.filter(user=request.user, client_id=config["client_id"]).first()
        eligible = bool(config["configured"] and connection and "https://www.googleapis.com/auth/drive" in connection.scopes.split())
        root = ImageStorageRoot.objects.filter(active=True).select_related("user").first()
        ready = False
        if root:
            try:
                storage_user(root)
                ready = True
            except APIException:
                pass
        return Response({"eligible": eligible, "connected_email": connection.email if connection else "", "folder": {"id": root.folder_id, "name": root.folder_name, "account": root.google_email} if root else None,
            "storage_ready": ready, "stored_images": StoredImage.objects.count()})

    @transaction.atomic
    def put(self, request):
        config = configuration()
        connection = GoogleConnection.objects.filter(user=request.user, client_id=config["client_id"]).first()
        if not config["configured"] or not connection or "https://www.googleapis.com/auth/drive" not in connection.scopes.split():
            raise ValidationError("Sube el JSON OAuth y conecta tu cuenta con permisos de Drive antes de elegir una carpeta.")
        identity = file_id(request.data.get("folder_id"))
        folder = metadata(request.user, identity)
        if folder["mimeType"] != MIMES["folder"] or folder.get("trashed") or not folder.get("capabilities", {}).get("canAddChildren"):
            raise ValidationError("Selecciona una carpeta donde tu cuenta pueda crear archivos y subcarpetas.")
        # Serialize concurrent changes even before the first destination exists.
        from boldApp.core.models import UserAccount
        list(UserAccount.objects.select_for_update().filter(pk__in=UserAccount.objects.order_by("pk").values("pk")[:1]))
        list(ImageStorageRoot.objects.select_for_update().values_list("pk", flat=True))
        ImageStorageRoot.objects.filter(active=True).update(active=False)
        root, _ = ImageStorageRoot.objects.get_or_create(user=request.user, subject=connection.subject, client_id=connection.client_id, folder_id=identity,
            defaults={"folder_name": folder["name"], "google_email": connection.email})
        root.active, root.folder_name, root.google_email = True, folder["name"], connection.email
        root.save(update_fields=["active", "folder_name", "google_email"])
        record_system_event("google.image_storage_configured", request, module_code="administration", metadata={"folder_id": identity, "storage_owner": str(request.user.pk)})
        return self.get(request)


class ImageStorageFoldersView(APIView):
    permission_classes = [IsConnectorAdministrator]

    def get(self, request):
        parent = request.query_params.get("parent", "root")
        parent = "root" if parent == "root" else file_id(parent)
        drive = request.query_params.get("drive")
        params = {"q": f"'{parent}' in parents and trashed=false and mimeType='{MIMES['folder']}'", "fields": "nextPageToken,files(id,name,capabilities)", "pageSize": 100,
            "pageToken": request.query_params.get("page", ""), "supportsAllDrives": "true", "includeItemsFromAllDrives": "true", "orderBy": "name"}
        if drive:
            params.update(corpora="drive", driveId=file_id(drive))
        return Response(google(request.user, "GET", "/files", params=params))


class StoredImageView(APIView):
    def get(self, request, identity):
        # Image elements cannot send X-Assignment-ID; validate the same owned assignment supplied in their URL.
        if not request.headers.get("X-Assignment-ID") and request.query_params.get("assignment"):
            request._request.META["HTTP_X_ASSIGNMENT_ID"] = request.query_params["assignment"]
            request._request.__dict__.pop("headers", None)
        image = get_object_or_404(StoredImage.objects.select_related("root__user"), pk=identity)
        if not authorized_image(request, image):
            raise NotFound("La imagen no existe o no tienes acceso.")
        user = storage_user(image.root)
        result = google(user, "GET", "/files/" + file_id(image.drive_id), params={"alt": "media", "supportsAllDrives": "true"}, raw=True)
        response = HttpResponse(result.content, content_type=image.mime_type)
        response["Cache-Control"] = "private, no-store"
        response["X-Content-Type-Options"] = "nosniff"
        return response


class WorkspaceImageDocumentView(APIView):
    @transaction.atomic
    def post(self, request):
        import uuid
        from .image_storage import prepare_document
        try:
            identity = str(uuid.UUID(str(request.data.get("id", ""))))
        except ValueError:
            raise ValidationError("Carpeta inválida.")
        title, content = request.data.get("title", ""), request.data.get("content", "")
        if not isinstance(title, str) or not title.strip() or len(title) > 120 or not isinstance(content, str) or len(content) > 2_000_000:
            raise ValidationError("Nombre o descripción inválidos.")
        document = prepare_document(request, "workspace", identity, title.strip(), content)
        return Response({"content": document.content})
