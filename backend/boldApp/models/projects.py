from django.conf import settings
from django.db import models

from .mixins import SoftDeleteModel, UUIDPrimaryKeyModel
from .workspaces import Workspace


# Define la tabla PROJECTS: los proyectos contenidos dentro de un workspace.
class Project(UUIDPrimaryKeyModel, SoftDeleteModel):
    workspace = models.ForeignKey(
        Workspace,
        on_delete=models.CASCADE,
        related_name="projects",
    )
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="owned_projects",
    )
    name = models.CharField(max_length=180)
    description = models.TextField(null=True, blank=True)
    color = models.CharField(max_length=7, null=True, blank=True)
    is_archived = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "projects"

    def __str__(self):
        return self.name


# Define la tabla PROJECT_MEMBERS: permisos de un usuario dentro de un proyecto.
class ProjectMember(models.Model):
    project = models.ForeignKey(
        Project,
        on_delete=models.CASCADE,
        related_name="members",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="project_memberships",
    )
    role = models.CharField(max_length=30)
    added_at = models.DateTimeField(auto_now_add=True)
    added_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="project_members_added",
        db_column="added_by",
    )

    class Meta:
        db_table = "project_members"
        constraints = [
            models.UniqueConstraint(
                fields=["project", "user"],
                name="unique_project_member",
            ),
        ]

    def __str__(self):
        return f"{self.user_id} @ {self.project_id}"


# Define la tabla SECTIONS: columnas o grupos del tablero de un proyecto.
class Section(UUIDPrimaryKeyModel):
    project = models.ForeignKey(
        Project,
        on_delete=models.CASCADE,
        related_name="sections",
    )
    name = models.CharField(max_length=120)
    position = models.DecimalField(max_digits=20, decimal_places=10)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "sections"
        ordering = ["position"]

    def __str__(self):
        return self.name


# Define la tabla TASK_STATUSES: estados configurables por proyecto.
class TaskStatus(UUIDPrimaryKeyModel):
    project = models.ForeignKey(
        Project,
        on_delete=models.CASCADE,
        related_name="task_statuses",
    )
    name = models.CharField(max_length=80)
    color = models.CharField(max_length=7, null=True, blank=True)
    category = models.CharField(max_length=30)
    position = models.SmallIntegerField()
    is_final = models.BooleanField(default=False)

    class Meta:
        db_table = "task_statuses"
        ordering = ["position"]
        constraints = [
            models.UniqueConstraint(
                fields=["project", "name"],
                name="unique_task_status_name_per_project",
            ),
        ]

    def __str__(self):
        return self.name
