"""Short-lived phone uploads are drafts, never messages or public Drive files."""
import uuid

from django.conf import settings
from django.db import models


class PhoneTransfer(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    account = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    session = models.ForeignKey("boldApp_autenticacion.AuthSession", on_delete=models.CASCADE)
    assignment = models.ForeignKey("boldApp_core.PositionAssignment", on_delete=models.CASCADE)
    conversation = models.ForeignKey("boldApp_mensajeria.DirectConversation", null=True, on_delete=models.CASCADE)
    channel = models.ForeignKey("boldApp_mensajeria.DepartmentChannel", null=True, on_delete=models.CASCADE)
    parent = models.ForeignKey("boldApp_mensajeria.ChannelMessage", null=True, on_delete=models.CASCADE)
    claim_hash = models.CharField(max_length=64)
    device_hash = models.CharField(max_length=64, blank=True)
    pairing_code = models.CharField(max_length=6, blank=True)
    approved = models.BooleanField(default=False)
    sealed = models.BooleanField(default=False)
    max_images = models.PositiveSmallIntegerField(default=10)
    expires_at = models.DateTimeField(db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)


class PhoneImage(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    transfer = models.ForeignKey(PhoneTransfer, related_name="images", on_delete=models.CASCADE)
    client_id = models.UUIDField()
    content = models.BinaryField()
    size_bytes = models.PositiveIntegerField()
    digest = models.CharField(max_length=64)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["transfer", "client_id"], name="phone_image_retry")]
