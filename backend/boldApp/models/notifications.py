from django.conf import settings
from django.db import models

from .mixins import UUIDPrimaryKeyModel
from .tasks import Task


# Define la tabla NOTIFICATIONS: avisos individuales para cada usuario.
class Notification(UUIDPrimaryKeyModel):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="notifications",
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
            models.Index(fields=["user", "is_read"], name="idx_notifications_user_read"),
        ]

    def __str__(self):
        return self.title
