from django.conf import settings
from django.db import models

from .mixins import UUIDPrimaryKeyModel
from .tasks import Task
from .workspaces import Workspace


# Define la tabla TAGS: etiquetas reutilizables dentro de un workspace.
class Tag(UUIDPrimaryKeyModel):
    workspace = models.ForeignKey(
        Workspace,
        on_delete=models.CASCADE,
        related_name="tags",
    )
    name = models.CharField(max_length=80)
    color = models.CharField(max_length=7, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "tags"
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "name"],
                name="unique_tag_name_per_workspace",
            ),
        ]

    def __str__(self):
        return self.name


# Define la tabla TASK_TAGS: relacion N:M entre tareas y etiquetas.
class TaskTag(models.Model):
    task = models.ForeignKey(
        Task,
        on_delete=models.CASCADE,
        related_name="task_tags",
    )
    tag = models.ForeignKey(
        Tag,
        on_delete=models.CASCADE,
        related_name="task_tags",
    )
    added_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="task_tags_added",
        db_column="added_by",
    )
    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "task_tags"
        constraints = [
            models.UniqueConstraint(
                fields=["task", "tag"],
                name="unique_task_tag",
            ),
        ]

    def __str__(self):
        return f"{self.tag_id} en {self.task_id}"
