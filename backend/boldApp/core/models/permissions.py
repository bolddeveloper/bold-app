from django.conf import settings
from django.db import models
from django.db.models.functions import Lower

from .mixins import UUIDPrimaryKeyModel
from .organizational import JobRole, OrganizationalUnit


# Define la tabla PERMISSIONS: el catalogo atomico de acciones posibles
# (resource + action), identificado por un codigo unico legible
# (ej. "tasks.task.delete").
class Permission(UUIDPrimaryKeyModel):
    RISK_LOW = "low"
    RISK_MEDIUM = "medium"
    RISK_HIGH = "high"
    RISK_CRITICAL = "critical"
    RISK_CHOICES = [
        (RISK_LOW, "Bajo"),
        (RISK_MEDIUM, "Medio"),
        (RISK_HIGH, "Alto"),
        (RISK_CRITICAL, "Crítico"),
    ]

    code = models.CharField(max_length=100, unique=True)
    module_code = models.CharField(max_length=50, default="core")
    resource = models.CharField(max_length=50)
    action = models.CharField(max_length=40)
    description = models.TextField(null=True, blank=True)
    risk_level = models.CharField(max_length=20, choices=RISK_CHOICES, default=RISK_MEDIUM)
    # Un permiso nuevo nace cerrado a delegación. Cada módulo debe habilitar
    # explícitamente esta capacidad al registrar su catálogo.
    is_delegable = models.BooleanField(default=False)
    requires_step_up_mfa = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    system_managed = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "permissions"
        ordering = ["code"]
        constraints = [
            models.UniqueConstraint(Lower("code"), name="unique_permission_code_case_insensitive"),
            models.CheckConstraint(
                condition=models.Q(risk_level__in=["low", "medium", "high", "critical"]),
                name="permission_valid_risk_level",
            ),
        ]

    def save(self, *args, **kwargs):
        self.code = self.code.strip().lower()
        self.module_code = self.module_code.strip().lower()
        self.resource = self.resource.strip().lower()
        self.action = self.action.strip().lower()
        super().save(*args, **kwargs)

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
    SCOPE_CHOICES = [
        (SCOPE_GLOBAL, "Global"),
        (SCOPE_OWN_UNIT, "Unidad propia"),
        (SCOPE_SUB_TREE, "Subárbol"),
        (SCOPE_SPECIFIC_UNIT, "Unidad específica"),
    ]
    EFFECT_CHOICES = [(EFFECT_ALLOW, "Permitir"), (EFFECT_DENY, "Denegar")]

    scope_type = models.CharField(max_length=30, choices=SCOPE_CHOICES)
    effect = models.CharField(max_length=10, choices=EFFECT_CHOICES)
    target_unit = models.ForeignKey(
        OrganizationalUnit,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="role_permission_scopes",
    )
    reason = models.TextField(blank=True)
    created_by_account = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="job_role_permission_rules_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "job_role_permissions"
        constraints = [
            models.UniqueConstraint(
                fields=["job_role", "permission", "scope_type"],
                condition=models.Q(target_unit__isnull=True),
                name="unique_role_permission_scope_without_unit",
            ),
            models.UniqueConstraint(
                fields=["job_role", "permission", "scope_type", "target_unit"],
                condition=models.Q(target_unit__isnull=False),
                name="unique_role_permission_scope_with_unit",
            ),
            models.CheckConstraint(
                condition=models.Q(scope_type__in=["global", "own_unit", "sub_tree", "specific_unit"]),
                name="job_role_permission_valid_scope",
            ),
            models.CheckConstraint(
                condition=models.Q(effect__in=["allow", "deny"]),
                name="job_role_permission_valid_effect",
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(scope_type__in=["global", "own_unit"], target_unit__isnull=True)
                    | models.Q(scope_type__in=["specific_unit", "sub_tree"], target_unit__isnull=False)
                ),
                name="job_role_permission_scope_target_consistent",
            ),
        ]

    def __str__(self):
        return f"{self.job_role_id} :: {self.permission_id} ({self.effect})"
