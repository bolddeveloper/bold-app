from django.conf import settings
from django.db import models

from .mixins import SoftDeleteModel, UUIDPrimaryKeyModel
from .tasks import Task


# Define la tabla COMMENTS: conversacion dentro de una tarea.
class Comment(UUIDPrimaryKeyModel, SoftDeleteModel):
    task = models.ForeignKey(
        Task,
        on_delete=models.CASCADE,
        related_name="comments",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="comments",
    )
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "comments"
        ordering = ["created_at"]
        indexes = [
            models.Index(fields=["task", "created_at"], name="idx_comments_task_created"),
        ]

    def __str__(self):
        return f"Comentario de {self.user_id} en {self.task_id}"


# Define la tabla ATTACHMENTS: archivos adjuntos de una tarea.
class Attachment(UUIDPrimaryKeyModel):
    task = models.ForeignKey(
        Task,
        on_delete=models.CASCADE,
        related_name="attachments",
    )
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="attachments_uploaded",
        db_column="uploaded_by",
    )
    file_name = models.CharField(max_length=255)
    file_url = models.TextField()
    mime_type = models.CharField(max_length=120)
    size_bytes = models.BigIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "attachments"
        ordering = ["-created_at"]

    def __str__(self):
        return self.file_name


# Define la tabla TASK_FOLLOWERS: colaboradores que siguen una tarea y su nivel de aviso.
class TaskFollower(models.Model):
    task = models.ForeignKey(
        Task,
        on_delete=models.CASCADE,
        related_name="followers",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="followed_tasks",
    )
    followed_at = models.DateTimeField(auto_now_add=True)
    notification_level = models.CharField(max_length=20)
    added_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="task_followers_added",
        db_column="added_by",
    )

    class Meta:
        db_table = "task_followers"
        constraints = [
            models.UniqueConstraint(
                fields=["task", "user"],
                name="unique_task_follower",
            ),
        ]

    def __str__(self):
        return f"{self.user_id} sigue {self.task_id}"


# Define la tabla ACTIVITY_LOGS: historial auditable de cambios sobre una tarea.
class ActivityLog(UUIDPrimaryKeyModel):
    task = models.ForeignKey(
        Task,
        on_delete=models.CASCADE,
        related_name="activity_logs",
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="activity_logs",
    )
    action = models.CharField(max_length=80)
    field_name = models.CharField(max_length=80, null=True, blank=True)
    old_value = models.TextField(null=True, blank=True)
    new_value = models.TextField(null=True, blank=True)
    metadata_json = models.JSONField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "activity_logs"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.action} en {self.task_id}"
