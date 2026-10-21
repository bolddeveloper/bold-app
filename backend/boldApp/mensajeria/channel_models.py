"""Department channels are company resources, never extensions of private DMs."""
from datetime import timedelta

from django.db import models
from django.db.models.functions import Lower

from boldApp.core.models.mixins import UUIDPrimaryKeyModel


class DepartmentChannel(UUIDPrimaryKeyModel):
    unit = models.ForeignKey("boldApp_core.OrganizationalUnit", on_delete=models.PROTECT, related_name="communication_channels")
    name = models.CharField(max_length=80)
    description = models.CharField(max_length=500, blank=True)
    creator = models.ForeignKey("boldApp_core.PositionAssignment", on_delete=models.PROTECT)
    archived_at = models.DateTimeField(null=True, blank=True)
    version = models.PositiveIntegerField(default=1)
    activity_version = models.PositiveBigIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "messaging_department_channels"
        ordering = ["name", "id"]
        constraints = [models.UniqueConstraint(Lower("name"), "unit", name="unique_department_channel_name")]
        indexes = [models.Index(fields=["unit", "archived_at"], name="slack_department_channels")]


class ChannelMessage(UUIDPrimaryKeyModel):
    EDIT_WINDOW = timedelta(minutes=10)
    channel = models.ForeignKey(DepartmentChannel, on_delete=models.CASCADE, related_name="messages")
    author = models.ForeignKey("boldApp_core.Employee", on_delete=models.PROTECT, related_name="channel_messages")
    author_assignment = models.ForeignKey("boldApp_core.PositionAssignment", on_delete=models.PROTECT)
    # Snapshot the active department, not all the employee's other assignments.
    department_name = models.CharField(max_length=120)
    department_color = models.CharField(max_length=7)
    client_id = models.UUIDField()
    payload_digest = models.CharField(max_length=64)
    sequence = models.PositiveBigIntegerField()
    body = models.TextField(max_length=5000)
    # An immutable reference, not a grant or a copy of confidential task data.
    # Retain the UUID after task deletion so history can show an unavailable card.
    task_id = models.UUIDField(null=True, blank=True)
    parent = models.ForeignKey("self", on_delete=models.PROTECT, related_name="replies", null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    edited_at = models.DateTimeField(null=True, blank=True)
    version = models.PositiveIntegerField(default=1)

    @property
    def editable_until(self):
        return self.created_at + self.EDIT_WINDOW

    class Meta:
        db_table = "messaging_channel_messages"
        ordering = ["-sequence"]
        constraints = [
            models.UniqueConstraint(fields=["channel", "author", "client_id"], name="unique_channel_send_retry"),
            models.UniqueConstraint(fields=["channel", "sequence"], name="unique_channel_sequence"),
            models.CheckConstraint(condition=models.Q(sequence__gt=0), name="positive_channel_sequence"),
        ]
        indexes = [models.Index(fields=["channel", "parent", "-sequence"], name="slack_message_history")]


class ChannelReadState(models.Model):
    channel = models.ForeignKey(DepartmentChannel, on_delete=models.CASCADE, related_name="read_states")
    employee = models.ForeignKey("boldApp_core.Employee", on_delete=models.CASCADE)
    sequence = models.PositiveBigIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "messaging_channel_read_states"
        constraints = [models.UniqueConstraint(fields=["channel", "employee"], name="unique_channel_reader")]


class ChannelMedia(UUIDPrimaryKeyModel):
    message = models.OneToOneField(ChannelMessage, on_delete=models.CASCADE, related_name="media")
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
        db_table = "messaging_channel_media"


class ChannelSubscription(models.Model):
    channel = models.ForeignKey(DepartmentChannel, on_delete=models.CASCADE, related_name="subscriptions")
    employee = models.ForeignKey("boldApp_core.Employee", on_delete=models.CASCADE)
    following = models.BooleanField(default=False)
    revision = models.PositiveBigIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "messaging_channel_subscriptions"
        constraints = [models.UniqueConstraint(fields=["channel", "employee"], name="unique_channel_subscription")]


class ChannelThreadReadState(models.Model):
    # Separate cursors prevent reading the main channel from acknowledging
    # replies that were never opened. Only root messages are accepted by the API.
    parent = models.ForeignKey(ChannelMessage, on_delete=models.CASCADE, related_name="reader_states")
    employee = models.ForeignKey("boldApp_core.Employee", on_delete=models.CASCADE)
    sequence = models.PositiveBigIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "messaging_channel_thread_reads"
        constraints = [models.UniqueConstraint(fields=["parent", "employee"], name="unique_channel_thread_reader")]
