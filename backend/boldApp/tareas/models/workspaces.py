from django.conf import settings
from django.db import models

from .mixins import SoftDeleteModel, UUIDPrimaryKeyModel


# Define la tabla WORKSPACES: el espacio de trabajo raiz de cada equipo.
class Workspace(UUIDPrimaryKeyModel, SoftDeleteModel):
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="owned_workspaces",
    )
    name = models.CharField(max_length=150)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "workspaces"

    def __str__(self):
        return self.name


# Define la tabla WORKSPACE_MEMBERS: usuarios y roles dentro de un workspace.
class WorkspaceMember(models.Model):
    workspace = models.ForeignKey(
        Workspace,
        on_delete=models.CASCADE,
        related_name="members",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="workspace_memberships",
    )
    role = models.CharField(max_length=30)
    status = models.CharField(max_length=20)
    joined_at = models.DateTimeField(auto_now_add=True)
    invited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="workspace_invitations_sent",
        db_column="invited_by",
    )

    class Meta:
        db_table = "workspace_members"
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "user"],
                name="unique_workspace_member",
            ),
        ]

    def __str__(self):
        return f"{self.user_id} @ {self.workspace_id}"
