import uuid
from django.db import models

from boldApp.core.models import PositionAssignment
from boldApp.core.models.mixins import UUIDPrimaryKeyModel
from boldApp.tareas.models import Project, Task


class Notification(UUIDPrimaryKeyModel):
    dismissed_at = models.DateTimeField(null=True, blank=True)
    recipient_assignment = models.ForeignKey(
        PositionAssignment,
        on_delete=models.CASCADE,
        related_name="notifications",
    )
    actor_assignment = models.ForeignKey(
        PositionAssignment,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="notifications_authored",
    )
    task = models.ForeignKey(
        Task,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="app_notifications",
    )
    project = models.ForeignKey(
        Project,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="app_notifications",
    )
    type = models.CharField(max_length=64)
    module = models.CharField(max_length=40, default="tasks")
    resource_type = models.CharField(max_length=40, blank=True, default="")
    resource_id = models.UUIDField(null=True, blank=True)
    title = models.CharField(max_length=180)
    body = models.TextField(null=True, blank=True)
    route = models.JSONField(default=dict, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    dedupe_key = models.CharField(max_length=255, null=True, blank=True)
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "application_notifications"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["recipient_assignment", "is_read", "created_at"], name="idx_notif_recipient_read"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["recipient_assignment", "dedupe_key"],
                condition=models.Q(dedupe_key__isnull=False),
                name="unique_notification_recipient_event",
            ),
        ]

    def __str__(self):
        return self.title


class PushDevice(UUIDPrimaryKeyModel):
    session = models.ForeignKey("boldApp_autenticacion.AuthSession", on_delete=models.CASCADE, related_name="push_devices")
    assignment = models.ForeignKey(PositionAssignment, on_delete=models.CASCADE, related_name="push_devices")
    endpoint_digest = models.CharField(max_length=64, unique=True)
    subscription_encrypted = models.TextField()
    binding = models.UUIDField(default=uuid.uuid4)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    revoked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "notification_push_devices"


class PushDelivery(UUIDPrimaryKeyModel):
    notification = models.ForeignKey(Notification, on_delete=models.CASCADE, related_name="push_deliveries")
    device = models.ForeignKey(PushDevice, on_delete=models.CASCADE, related_name="deliveries")
    binding = models.UUIDField()
    state = models.CharField(max_length=12, default="pending")
    attempts = models.PositiveSmallIntegerField(default=0)
    next_attempt_at = models.DateTimeField()
    lease_until = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "notification_push_deliveries"
        indexes = [models.Index(fields=["state", "next_attempt_at"], name="idx_push_delivery_due")]
        constraints = [models.UniqueConstraint(fields=["notification", "device", "binding"], name="unique_push_notice_device")]
