from django.conf import settings
from django.db import models


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
