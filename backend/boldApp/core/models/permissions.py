from django.db import models

from .mixins import UUIDPrimaryKeyModel
from .organizational import JobRole, OrganizationalUnit


# Define la tabla PERMISSIONS: el catalogo atomico de acciones posibles
# (resource + action), identificado por un codigo unico legible
# (ej. "tasks.task.delete").
class Permission(UUIDPrimaryKeyModel):
    code = models.CharField(max_length=100, unique=True)
    resource = models.CharField(max_length=50)
    action = models.CharField(max_length=40)
    description = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "permissions"
        ordering = ["code"]

    def __str__(self):
        return self.code


# Define la tabla JOB_ROLE_PERMISSIONS: los permisos base de un cargo, con su
# alcance (scope_type) y efecto (allow/deny). La llave del diagrama es
# (job_role_id, permission_id): un cargo tiene a lo sumo una regla por
# permiso, por eso el UniqueConstraint hace de PK compuesta (ver
# boldApp/core/authorization.py para como se interpreta cada scope_type).
class JobRolePermission(models.Model):
    SCOPE_GLOBAL = "global"
    SCOPE_OWN_UNIT = "own_unit"
    SCOPE_SUB_TREE = "sub_tree"
    SCOPE_SPECIFIC_UNIT = "specific_unit"

    EFFECT_ALLOW = "allow"
    EFFECT_DENY = "deny"

    job_role = models.ForeignKey(JobRole, on_delete=models.CASCADE, related_name="role_permissions")
    permission = models.ForeignKey(Permission, on_delete=models.CASCADE, related_name="role_permissions")
    scope_type = models.CharField(max_length=30)
    effect = models.CharField(max_length=10)
    target_unit = models.ForeignKey(
        OrganizationalUnit,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="role_permission_scopes",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "job_role_permissions"
        constraints = [
            models.UniqueConstraint(
                fields=["job_role", "permission"],
                name="unique_job_role_permission",
            ),
        ]

    def __str__(self):
        return f"{self.job_role_id} :: {self.permission_id} ({self.effect})"
