from django.db import models

from boldApp.core.models import OrganizationalUnit, PositionAssignment

from .mixins import UUIDPrimaryKeyModel
from .tasks import Task


class Tag(UUIDPrimaryKeyModel):
    unit = models.ForeignKey(OrganizationalUnit, on_delete=models.PROTECT, related_name="task_tags")
    name = models.CharField(max_length=80)
    color_hex = models.CharField(max_length=7, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "tags"
        constraints = [models.UniqueConstraint(fields=["unit", "name"], name="unique_tag_name_per_unit")]

    def __str__(self):
        return self.name


class TaskTag(models.Model):
    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name="task_tags")
    tag = models.ForeignKey(Tag, on_delete=models.CASCADE, related_name="task_tags")
    added_by_assignment = models.ForeignKey(
        PositionAssignment,
        on_delete=models.PROTECT,
        related_name="task_tags_added",
    )
    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "task_tags"
        constraints = [models.UniqueConstraint(fields=["task", "tag"], name="unique_task_tag")]

    def __str__(self):
        return f"{self.tag_id} en {self.task_id}"
