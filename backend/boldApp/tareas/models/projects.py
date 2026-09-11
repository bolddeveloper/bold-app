from django.db import models

from boldApp.core.models import OrganizationalUnit, PositionAssignment

from .mixins import SoftDeleteModel, UUIDPrimaryKeyModel


class Project(UUIDPrimaryKeyModel, SoftDeleteModel):
    unit = models.ForeignKey(OrganizationalUnit, on_delete=models.PROTECT, related_name="task_projects")
    owner_assignment = models.ForeignKey(
        PositionAssignment,
        on_delete=models.PROTECT,
        related_name="owned_task_projects",
    )
    created_by_assignment = models.ForeignKey(
        PositionAssignment,
        on_delete=models.PROTECT,
        related_name="created_task_projects",
    )
    name = models.CharField(max_length=180)
    description = models.TextField(null=True, blank=True)
    color_hex = models.CharField(max_length=7, null=True, blank=True)
    status = models.CharField(max_length=30)
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    sensitivity_level = models.CharField(max_length=20, null=True, blank=True)
    is_archived = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "projects"
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(fields=["unit", "name"], name="unique_project_name_per_unit"),
        ]

    def __str__(self):
        return self.name


class ProjectMember(models.Model):
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="members")
    assignment = models.ForeignKey(
        PositionAssignment,
        on_delete=models.PROTECT,
        related_name="task_project_memberships",
    )
    member_role = models.CharField(max_length=30)
    status = models.CharField(max_length=20)
    added_by_assignment = models.ForeignKey(
        PositionAssignment,
        on_delete=models.PROTECT,
        related_name="task_project_members_added",
    )
    joined_at = models.DateTimeField(auto_now_add=True)
    removed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "project_members"
        constraints = [
            models.UniqueConstraint(fields=["project", "assignment"], name="unique_project_assignment"),
        ]

    def __str__(self):
        return f"{self.assignment_id} @ {self.project_id}"


class Section(UUIDPrimaryKeyModel):
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="sections")
    name = models.CharField(max_length=120)
    position = models.DecimalField(max_digits=20, decimal_places=10)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "sections"
        ordering = ["position"]
        constraints = [
            models.UniqueConstraint(fields=["project", "name"], name="unique_section_name_per_project"),
        ]

    def __str__(self):
        return self.name


class TaskStatus(UUIDPrimaryKeyModel):
    unit = models.ForeignKey(
        OrganizationalUnit,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="task_statuses",
    )
    name = models.CharField(max_length=80)
    category = models.CharField(max_length=30)
    color_hex = models.CharField(max_length=7, null=True, blank=True)
    position = models.SmallIntegerField()
    is_final = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "task_statuses"
        ordering = ["position"]
        constraints = [
            models.UniqueConstraint(fields=["unit", "name"], name="unique_task_status_name_per_unit"),
        ]

    def __str__(self):
        return self.name
