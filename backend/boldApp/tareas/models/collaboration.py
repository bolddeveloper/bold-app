from django.db import models

from boldApp.core.models import PositionAssignment

from .mixins import SoftDeleteModel, UUIDPrimaryKeyModel
from .tasks import Task


class Comment(UUIDPrimaryKeyModel, SoftDeleteModel):
    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name="comments")
    author_assignment = models.ForeignKey(
        PositionAssignment,
        on_delete=models.PROTECT,
        related_name="task_comments",
    )
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "comments"
        ordering = ["created_at"]
        indexes = [models.Index(fields=["task", "created_at"], name="idx_comments_task_created")]

    def __str__(self):
        return f"Comentario de {self.author_assignment_id} en {self.task_id}"


class Attachment(UUIDPrimaryKeyModel):
    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name="attachments")
    uploaded_by_assignment = models.ForeignKey(
        PositionAssignment,
        on_delete=models.PROTECT,
        related_name="task_attachments_uploaded",
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


class TaskFollower(models.Model):
    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name="followers")
    assignment = models.ForeignKey(
        PositionAssignment,
        on_delete=models.CASCADE,
        related_name="followed_tasks",
    )
    followed_at = models.DateTimeField(auto_now_add=True)
    notification_level = models.CharField(max_length=20)
    added_by_assignment = models.ForeignKey(
        PositionAssignment,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="task_followers_added",
    )

    class Meta:
        db_table = "task_followers"
        constraints = [
            models.UniqueConstraint(fields=["task", "assignment"], name="unique_task_follower"),
        ]

    def __str__(self):
        return f"{self.assignment_id} sigue {self.task_id}"


class ActivityLog(UUIDPrimaryKeyModel):
    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name="activity_logs")
    actor_assignment = models.ForeignKey(
        PositionAssignment,
        on_delete=models.PROTECT,
        related_name="task_activity_logs",
    )
    action = models.CharField(max_length=60)
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
