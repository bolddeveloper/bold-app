from django.db import models
from django.db.models import Q
from .mixins import UUIDPrimaryKeyModel


class Pipeline(UUIDPrimaryKeyModel):
    project = models.ForeignKey("Project", null=True, blank=True, on_delete=models.CASCADE, related_name="pipelines")
    employee = models.ForeignKey("boldApp_core.Employee", null=True, blank=True, on_delete=models.CASCADE, related_name="personal_pipelines")
    name = models.CharField(max_length=80)
    stages = models.JSONField(default=list)
    is_default = models.BooleanField(default=False)
    version = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]
        constraints = [
            models.CheckConstraint(condition=(Q(project__isnull=False, employee__isnull=True) | Q(project__isnull=True, employee__isnull=False)), name="pipeline_exactly_one_owner"),
            models.UniqueConstraint(fields=["employee"], condition=Q(employee__isnull=False), name="one_personal_pipeline"),
            models.UniqueConstraint(fields=["project"], condition=Q(project__isnull=False, is_default=True), name="one_default_project_pipeline"),
        ]


class PersonalPipelineTask(models.Model):
    pipeline = models.ForeignKey(Pipeline, on_delete=models.CASCADE, related_name="personal_tasks")
    task = models.ForeignKey("Task", on_delete=models.CASCADE, related_name="personal_pipeline_tasks")
    stage_id = models.UUIDField()

    class Meta:
        constraints = [models.UniqueConstraint(fields=["pipeline", "task"], name="unique_personal_pipeline_task")]
