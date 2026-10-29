"""Bounded private upload outbox; only consumed files become messages."""
import uuid
from django.conf import settings
from django.db import models


class MediaUploadQuota(models.Model):
    # A short global DB mutex for reservations, never held across provider I/O.
    id = models.PositiveSmallIntegerField(primary_key=True, default=1)


class MediaUpload(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    account = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    assignment = models.ForeignKey('boldApp_core.PositionAssignment', on_delete=models.PROTECT)
    session = models.ForeignKey('boldApp_autenticacion.AuthSession', null=True, on_delete=models.SET_NULL)
    conversation = models.ForeignKey('boldApp_mensajeria.DirectConversation', null=True, on_delete=models.PROTECT)
    channel = models.ForeignKey('boldApp_mensajeria.DepartmentChannel', null=True, on_delete=models.PROTECT)
    root = models.ForeignKey('boldApp_workspace.ImageStorageRoot', null=True, on_delete=models.PROTECT)
    client_id = models.UUIDField()
    state = models.CharField(max_length=12, default='queued', choices=[(s, s) for s in
        ('queued','uploading','retry','failed','ready','attached','cancelled','expired')])
    digest = models.CharField(max_length=64)
    filename = models.CharField(max_length=180, blank=True)
    kind = models.CharField(max_length=10)
    mime_type = models.CharField(max_length=100)
    size_bytes = models.PositiveIntegerField()
    width = models.PositiveIntegerField(null=True)
    height = models.PositiveIntegerField(null=True)
    content = models.BinaryField(default=bytes)
    cipher_bytes = models.PositiveIntegerField(default=0)
    drive_id = models.CharField(max_length=200, blank=True)
    folder_id = models.CharField(max_length=200, blank=True)
    message_id = models.UUIDField(null=True)
    attempts = models.PositiveSmallIntegerField(default=0)
    cycle_attempts = models.PositiveSmallIntegerField(default=0)
    error_code = models.CharField(max_length=32, blank=True)
    next_at = models.DateTimeField(db_index=True)
    lease_token = models.UUIDField(null=True)
    lease_until = models.DateTimeField(null=True)
    expires_at = models.DateTimeField(db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    cleanup_attempts = models.PositiveSmallIntegerField(default=0)
    cleaned_at = models.DateTimeField(null=True)

    class Meta:
        db_table = 'messaging_media_uploads'
        constraints = [models.CheckConstraint(condition=(models.Q(conversation__isnull=False,channel__isnull=True) |
            models.Q(conversation__isnull=True,channel__isnull=False)), name='media_upload_one_scope'),
            models.CheckConstraint(condition=(models.Q(root__isnull=False) | models.Q(state='cancelled',size_bytes=0,
                cipher_bytes=0,content=b'',message_id__isnull=True,drive_id='',folder_id='',digest='',filename='',
                kind='',mime_type='',attempts=0,width__isnull=True,height__isnull=True)),name='media_upload_root_or_stop')]
        indexes = [models.Index(fields=['state','next_at'], name='media_upload_pending')]


class MediaUploadFolder(models.Model):
    root = models.ForeignKey('boldApp_workspace.ImageStorageRoot', on_delete=models.PROTECT)
    key = models.CharField(max_length=700)
    drive_id = models.CharField(max_length=200)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['root','key'],name='media_upload_folder_key')]
