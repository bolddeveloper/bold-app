from datetime import timedelta

from django.db import models
from django.conf import settings

from boldApp.core.models.mixins import UUIDPrimaryKeyModel


class DirectConversation(UUIDPrimaryKeyModel):
    activity_version = models.PositiveBigIntegerField(default=0)
    # Canonical employee pair, not assignments: changing roles is not a new person.
    first_employee = models.ForeignKey("boldApp_core.Employee", on_delete=models.PROTECT, related_name="direct_chats_first")
    second_employee = models.ForeignKey("boldApp_core.Employee", on_delete=models.PROTECT, related_name="direct_chats_second")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "messaging_direct_conversations"
        ordering = ["-updated_at", "-id"]
        constraints = [
            models.UniqueConstraint(fields=["first_employee", "second_employee"], name="unique_direct_chat_pair"),
            models.CheckConstraint(condition=models.Q(first_employee__lt=models.F("second_employee")), name="direct_chat_canonical_pair"),
        ]
        indexes = [
            models.Index(fields=["first_employee", "-updated_at"], name="chat_first_activity"),
            models.Index(fields=["second_employee", "-updated_at"], name="chat_second_activity"),
        ]


class DirectMessage(UUIDPrimaryKeyModel):
    EDIT_WINDOW = timedelta(minutes=10)
    conversation = models.ForeignKey(DirectConversation, on_delete=models.CASCADE, related_name="messages")
    author = models.ForeignKey("boldApp_core.Employee", on_delete=models.PROTECT, related_name="direct_messages")
    client_id = models.UUIDField()
    body = models.TextField(max_length=5000)
    created_at = models.DateTimeField(auto_now_add=True)
    edited_at = models.DateTimeField(null=True, blank=True)
    version = models.PositiveIntegerField(default=1)
    delivered_at = models.DateTimeField(null=True, blank=True)
    read_at = models.DateTimeField(null=True, blank=True)

    @property
    def editable_until(self):
        return self.created_at + self.EDIT_WINDOW

    class Meta:
        db_table = "messaging_direct_messages"
        ordering = ["-created_at", "-id"]
        constraints = [
            models.UniqueConstraint(fields=["conversation", "author", "client_id"], name="unique_direct_message_retry"),
            models.CheckConstraint(condition=models.Q(read_at__isnull=True) | models.Q(delivered_at__isnull=False, read_at__gte=models.F("delivered_at")), name="chat_read_requires_delivery"),
        ]
        indexes = [models.Index(fields=["conversation", "-created_at", "-id"], name="chat_message_history"),
                   models.Index(fields=["conversation", "author"], condition=models.Q(read_at__isnull=True), name="chat_unread_recipient")]


class MessagingPreferences(models.Model):
    account = models.OneToOneField(settings.AUTH_USER_MODEL, primary_key=True, on_delete=models.CASCADE, related_name="messaging_preferences")
    enter_behavior = models.CharField(max_length=10, choices=[("send", "Enviar"), ("newline", "Salto de línea")], default="send")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "messaging_preferences"
        constraints = [models.CheckConstraint(condition=models.Q(enter_behavior__in=["send", "newline"]), name="chat_valid_enter_preference")]


class MessageMedia(UUIDPrimaryKeyModel):
    message = models.OneToOneField(DirectMessage, on_delete=models.CASCADE, related_name="media")
    root = models.ForeignKey("boldApp_workspace.ImageStorageRoot", on_delete=models.PROTECT)
    drive_id = models.CharField(max_length=200)
    kind = models.CharField(max_length=10, choices=[("image", "Imagen"), ("audio", "Nota de voz")])
    mime_type = models.CharField(max_length=100)
    size_bytes = models.PositiveIntegerField()
    digest = models.CharField(max_length=64)
    width = models.PositiveIntegerField(null=True)
    height = models.PositiveIntegerField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "messaging_message_media"
