from django.db import models

from boldApp.core.models import OrganizationalUnit, PositionAssignment

from .mixins import SoftDeleteModel, UUIDPrimaryKeyModel
from .projects import Project, Section, TaskStatus


class Task(UUIDPrimaryKeyModel, SoftDeleteModel):
    unit = models.ForeignKey(OrganizationalUnit, on_delete=models.PROTECT, related_name="tasks")
    parent_task = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="subtasks",
    )
    created_by_assignment = models.ForeignKey(
        PositionAssignment,
        on_delete=models.PROTECT,
        related_name="tasks_created",
    )
    assignee_assignment = models.ForeignKey(
        PositionAssignment,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="tasks_assigned",
    )
    status = models.ForeignKey(TaskStatus, on_delete=models.PROTECT, related_name="tasks")
    title = models.CharField(max_length=220)
    description = models.TextField(null=True, blank=True)
    priority = models.CharField(max_length=20)
    start_date = models.DateField(null=True, blank=True)
    due_date = models.DateField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "tasks"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["assignee_assignment", "due_date"], name="idx_tasks_assignment_due"),
            models.Index(fields=["unit", "status"], name="idx_tasks_unit_status"),
        ]

    def __str__(self):
        return self.title


class TaskProject(models.Model):
    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name="task_projects")
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="task_projects")
    section = models.ForeignKey(
        Section,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="task_projects",
    )
    position = models.DecimalField(max_digits=20, decimal_places=10)
    added_by_assignment = models.ForeignKey(
        PositionAssignment,
        on_delete=models.PROTECT,
        related_name="task_projects_added",
    )
    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "task_projects"
        ordering = ["position"]
        indexes = [
            models.Index(fields=["project", "section", "position"], name="idx_taskprojects_proj_sec_pos"),
        ]
        constraints = [
            models.UniqueConstraint(fields=["task", "project"], name="unique_task_project"),
        ]

    def __str__(self):
        return f"{self.task_id} -> {self.project_id}"


class TaskDependency(models.Model):
    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name="blocking_dependencies")
    depends_on_task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name="dependent_tasks")
    dependency_type = models.CharField(max_length=20)
    created_by_assignment = models.ForeignKey(
        PositionAssignment,
        on_delete=models.PROTECT,
        related_name="task_dependencies_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "task_dependencies"
        constraints = [
            models.UniqueConstraint(fields=["task", "depends_on_task"], name="unique_task_dependency"),
            models.CheckConstraint(
                condition=~models.Q(task=models.F("depends_on_task")),
                name="task_cannot_depend_on_itself",
            ),
        ]

    def __str__(self):
        return f"{self.task_id} depende de {self.depends_on_task_id}"
