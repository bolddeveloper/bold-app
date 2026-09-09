from django.db import models

from boldApp.core.models import PositionAssignment

from .mixins import UUIDPrimaryKeyModel
from .tasks import Task


class Notification(UUIDPrimaryKeyModel):
    recipient_assignment = models.ForeignKey(
        PositionAssignment,
        on_delete=models.CASCADE,
        related_name="task_notifications",
    )
    task = models.ForeignKey(
        Task,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="notifications",
    )
    type = models.CharField(max_length=40)
    title = models.CharField(max_length=180)
    body = models.TextField(null=True, blank=True)
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "notifications"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["recipient_assignment", "is_read"], name="idx_notifications_asg_read"),
        ]

    def __str__(self):
        return self.title
