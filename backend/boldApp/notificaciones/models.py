from django.db import models

from boldApp.core.models import PositionAssignment
from boldApp.core.models.mixins import UUIDPrimaryKeyModel
from boldApp.tareas.models import Project, Task


class Notification(UUIDPrimaryKeyModel):
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
