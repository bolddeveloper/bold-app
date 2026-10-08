from django.conf import settings
from django.db import models
import uuid


class GoogleConnection(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    email = models.EmailField()
    subject = models.CharField(max_length=255)
    refresh_token_encrypted = models.TextField()
    access_token_encrypted = models.TextField(blank=True)
    expires_at = models.DateTimeField(null=True)
    scopes = models.TextField(blank=True)
    client_id = models.CharField(max_length=255, blank=True)
    time_zone = models.CharField(max_length=80, default="UTC")
    updated_at = models.DateTimeField(auto_now=True)


class GoogleOAuthConfiguration(models.Model):
    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)
    enabled = models.BooleanField(default=True)
    client_id = models.CharField(max_length=255, blank=True)
    project_id = models.CharField(max_length=255, blank=True)
    client_secret_encrypted = models.TextField(blank=True)
    version = models.PositiveIntegerField(default=1)
    updated_at = models.DateTimeField(auto_now=True)


class PublishedView(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    google_subject = models.CharField(max_length=255)
    file_id = models.CharField(max_length=200)
    embed_url = models.URLField(max_length=2048)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "google_subject", "file_id"], name="workspace_published_owner_file")]


class OfficeWorkspace(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    google_subject = models.CharField(max_length=255)
    source_id = models.CharField(max_length=200)
    working_id = models.CharField(max_length=200)
    checksum = models.CharField(max_length=200)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "google_subject", "source_id"], name="workspace_office_original")]


class ImageStorageRoot(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    subject = models.CharField(max_length=255)
    google_email = models.EmailField()
    client_id = models.CharField(max_length=255)
    folder_id = models.CharField(max_length=200)
    folder_name = models.CharField(max_length=255)
    active = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "subject", "client_id", "folder_id"], name="image_storage_destination"), models.UniqueConstraint(fields=["active"], condition=models.Q(active=True), name="one_active_image_destination")]


class ImageStorageFolder(models.Model):
    root = models.ForeignKey(ImageStorageRoot, on_delete=models.PROTECT)
    key = models.CharField(max_length=700)
    drive_id = models.CharField(max_length=200)
    name = models.CharField(max_length=255)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["root", "key"], name="image_storage_folder_key")]


class StoredImage(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    root = models.ForeignKey(ImageStorageRoot, on_delete=models.PROTECT)
    drive_id = models.CharField(max_length=200)
    mime_type = models.CharField(max_length=100)
    size_bytes = models.PositiveBigIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)


class ImageBinding(models.Model):
    image = models.ForeignKey(StoredImage, on_delete=models.CASCADE, related_name="bindings")
    resource_kind = models.CharField(max_length=30)
    resource_id = models.UUIDField()
    field = models.CharField(max_length=40)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["image", "resource_kind", "resource_id", "field"], name="image_resource_binding")]


class ImageDocument(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    google_subject = models.CharField(max_length=255, blank=True)
    assignment_id = models.UUIDField(null=True)
    kind = models.CharField(max_length=30)
    external_id = models.CharField(max_length=600)
    title = models.CharField(max_length=255)
    content = models.TextField(blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["owner", "google_subject", "kind", "external_id"], name="image_document_resource")]
