import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone

from .mixins import UUIDPrimaryKeyModel
from .organizational import Employee, OrganizationalUnit, PositionAssignment
from .permissions import Permission


# Define la tabla ACCESS_GRANTS: un acceso especial y temporal otorgado a UNA
# asignacion (plaza) concreta sobre un permiso y una unidad objetivo, fuera
# de lo que ya le da su cargo. Puede permitir temporalmente o denegar de
# forma explícita; la denegación siempre tiene precedencia.
class AccessGrant(UUIDPrimaryKeyModel):
    STATUS_ACTIVE = "active"
    STATUS_REVOKED = "revoked"
    STATUS_EXPIRED = "expired"
    STATUS_CHOICES = [
        (STATUS_ACTIVE, "Activo"),
        (STATUS_REVOKED, "Revocado"),
        (STATUS_EXPIRED, "Expirado"),
    ]

    EFFECT_ALLOW = "allow"
    EFFECT_DENY = "deny"
    EFFECT_CHOICES = [(EFFECT_ALLOW, "Permitir"), (EFFECT_DENY, "Denegar")]

    SCOPE_GLOBAL = "global"
    SCOPE_OWN_UNIT = "own_unit"
    SCOPE_SUB_TREE = "sub_tree"
    SCOPE_SPECIFIC_UNIT = "specific_unit"
    SCOPE_CHOICES = [
        (SCOPE_GLOBAL, "Global"),
        (SCOPE_OWN_UNIT, "Unidad propia"),
        (SCOPE_SUB_TREE, "Subárbol"),
        (SCOPE_SPECIFIC_UNIT, "Unidad específica"),
    ]

    SOURCE_TEMPORARY = "temporary"
    SOURCE_OVERRIDE = "override"
    SOURCE_CHOICES = [(SOURCE_TEMPORARY, "Temporal"), (SOURCE_OVERRIDE, "Excepción")]

    grantee_assignment = models.ForeignKey(
        PositionAssignment,
        on_delete=models.PROTECT,
        related_name="access_grants_received",
    )
    permission = models.ForeignKey(Permission, on_delete=models.PROTECT, related_name="access_grants")
    effect = models.CharField(max_length=10, choices=EFFECT_CHOICES, default=EFFECT_ALLOW)
    scope_type = models.CharField(max_length=30, choices=SCOPE_CHOICES, default=SCOPE_SPECIFIC_UNIT)
    target_unit = models.ForeignKey(
        OrganizationalUnit,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="access_grants",
    )
    resource_type = models.CharField(max_length=80, blank=True)
    resource_id = models.CharField(max_length=120, null=True, blank=True)
    granted_by_assignment = models.ForeignKey(
        PositionAssignment,
        on_delete=models.PROTECT,
        related_name="access_grants_issued",
    )
    valid_from = models.DateTimeField()
    valid_until = models.DateTimeField(null=True, blank=True)
    reason = models.TextField()
    source = models.CharField(max_length=20, choices=SOURCE_CHOICES, default=SOURCE_TEMPORARY)
    source_authority = models.ForeignKey(
        "GrantAuthority",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="issued_access_grants",
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_ACTIVE)
    created_by_account = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="access_grants_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    revoked_by_assignment = models.ForeignKey(
        PositionAssignment,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="access_grants_revoked",
    )
    revoked_by_account = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="access_grants_revoked",
    )
    revocation_reason = models.TextField(blank=True)

    class Meta:
        db_table = "access_grants"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["grantee_assignment", "status"], name="idx_accessgrant_grantee_status"),
            models.Index(fields=["permission", "target_unit", "status"], name="idx_accessgrant_perm_unit"),
        ]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(effect__in=["allow", "deny"]),
                name="access_grant_valid_effect",
            ),
            models.CheckConstraint(
                condition=models.Q(scope_type__in=["global", "own_unit", "sub_tree", "specific_unit"]),
                name="access_grant_valid_scope",
            ),
            models.CheckConstraint(
                condition=models.Q(status__in=["active", "revoked", "expired"]),
                name="access_grant_valid_status",
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(scope_type__in=["global", "own_unit"], target_unit__isnull=True)
                    | models.Q(scope_type__in=["specific_unit", "sub_tree"], target_unit__isnull=False)
                ),
                name="access_grant_scope_target_consistent",
            ),
            models.CheckConstraint(
                condition=models.Q(valid_until__isnull=True) | models.Q(valid_until__gt=models.F("valid_from")),
                name="access_grant_valid_interval",
            ),
            models.CheckConstraint(
                condition=models.Q(effect="deny") | models.Q(valid_until__isnull=False),
                name="access_grant_allow_requires_expiry",
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(status="revoked", revoked_at__isnull=False)
                    | ~models.Q(status="revoked")
                ),
                name="access_grant_revocation_timestamp_required",
            ),
        ]

    def is_effective(self, at=None):
        moment = at or timezone.now()
        return (
            self.status == self.STATUS_ACTIVE
            and self.revoked_at is None
            and self.valid_from <= moment
            and (self.valid_until is None or moment < self.valid_until)
        )

    def __str__(self):
        return f"{self.permission_id} -> {self.grantee_assignment_id}"


# Define la tabla GRANT_AUTHORITIES: la autoridad de UNA asignacion para
# otorgar/revocar accesos o delegar esa misma autoridad, acotada a una unidad
# (y su sub-arbol) y a un nivel maximo de sensibilidad. Es el "quien puede
# crear un AccessGrant" — se valida en AccessGrantSerializer.validate().
class GrantAuthority(UUIDPrimaryKeyModel):
    SCOPE_GLOBAL = "global"
    SCOPE_OWN_UNIT = "own_unit"
    SCOPE_SUB_TREE = "sub_tree"
    SCOPE_SPECIFIC_UNIT = "specific_unit"
    SCOPE_CHOICES = [
        (SCOPE_GLOBAL, "Global"),
        (SCOPE_OWN_UNIT, "Unidad propia"),
        (SCOPE_SUB_TREE, "Subárbol"),
        (SCOPE_SPECIFIC_UNIT, "Unidad específica"),
    ]

    assignment = models.ForeignKey(PositionAssignment, on_delete=models.PROTECT, related_name="grant_authorities")
    scope_type = models.CharField(max_length=30, choices=SCOPE_CHOICES, default=SCOPE_SUB_TREE)
    target_unit = models.ForeignKey(
        OrganizationalUnit,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="grant_authorities",
    )
    max_sensitivity_level = models.CharField(
        max_length=20,
        choices=Permission.RISK_CHOICES,
        default=Permission.RISK_LOW,
    )
    can_grant_access = models.BooleanField(default=False)
    can_revoke_access = models.BooleanField(default=False)
    can_delegate_authority = models.BooleanField(default=False)
    granted_by_assignment = models.ForeignKey(
        PositionAssignment,
        on_delete=models.PROTECT,
        related_name="grant_authorities_issued",
    )
    parent_authority = models.ForeignKey(
        "self",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="delegated_authorities",
    )
    valid_from = models.DateTimeField(default=timezone.now)
    valid_until = models.DateTimeField()
    max_grant_duration_seconds = models.PositiveIntegerField(default=604800)
    delegation_depth_remaining = models.PositiveSmallIntegerField(default=0)
    reason = models.TextField(default="Autoridad migrada")
    created_by_account = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="grant_authorities_created",
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    revoked_by_account = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="grant_authorities_revoked",
    )
    revocation_reason = models.TextField(blank=True)

    class Meta:
        db_table = "grant_authorities"
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(scope_type__in=["global", "own_unit", "sub_tree", "specific_unit"]),
                name="grant_authority_valid_scope",
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(scope_type__in=["global", "own_unit"], target_unit__isnull=True)
                    | models.Q(scope_type__in=["specific_unit", "sub_tree"], target_unit__isnull=False)
                ),
                name="grant_authority_scope_target_consistent",
            ),
            models.CheckConstraint(
                condition=models.Q(valid_until__isnull=True) | models.Q(valid_until__gt=models.F("valid_from")),
                name="grant_authority_valid_interval",
            ),
            models.CheckConstraint(
                condition=models.Q(is_active=True, revoked_at__isnull=True) | models.Q(is_active=False),
                name="active_grant_authority_not_revoked",
            ),
            models.CheckConstraint(
                condition=models.Q(max_sensitivity_level__in=["low", "medium", "high", "critical"]),
                name="grant_authority_valid_sensitivity",
            ),
            models.CheckConstraint(
                condition=models.Q(max_grant_duration_seconds__gte=300)
                & models.Q(max_grant_duration_seconds__lte=7776000),
                name="grant_authority_valid_duration_limit",
            ),
            models.CheckConstraint(
                condition=models.Q(delegation_depth_remaining__lte=5),
                name="grant_authority_valid_depth",
            ),
        ]

    def __str__(self):
        return f"Autoridad de {self.assignment_id}"


# Define la tabla GRANT_AUTHORITY_PERMISSIONS: a que permisos puntuales
# aplica una GrantAuthority. Llave del diagrama: (grant_authority_id,
# permission_id).
class GrantAuthorityPermission(models.Model):
    grant_authority = models.ForeignKey(
        GrantAuthority,
        on_delete=models.CASCADE,
        related_name="scoped_permissions",
    )
    permission = models.ForeignKey(Permission, on_delete=models.CASCADE, related_name="grant_authority_links")

    class Meta:
        db_table = "grant_authority_permissions"
        constraints = [
            models.UniqueConstraint(
                fields=["grant_authority", "permission"],
                name="unique_grant_authority_permission",
            ),
        ]

    def __str__(self):
        return f"{self.grant_authority_id} :: {self.permission_id}"


# Define la tabla PERMISSION_AUDIT_LOGS: constancia de cada decision de
# autorizacion (allow/deny) tomada por boldApp/core/authorization.py. Es el
# rastro auditable que sustenta la regla de autorizacion del diagrama.
class PermissionAuditLog(UUIDPrimaryKeyModel):
    DECISION_ALLOW = "allow"
    DECISION_DENY = "deny"

    employee = models.ForeignKey(Employee, on_delete=models.PROTECT, related_name="permission_audit_logs")
    actor_account = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="permission_decisions",
    )
    assignment = models.ForeignKey(
        PositionAssignment,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="permission_audit_logs",
    )
    permission = models.ForeignKey(Permission, on_delete=models.PROTECT, related_name="audit_logs")
    target_unit = models.ForeignKey(
        OrganizationalUnit,
        on_delete=models.PROTECT,
        related_name="permission_audit_logs",
    )
    module_code = models.CharField(max_length=50, default="core")
    resource_type = models.CharField(max_length=80, blank=True)
    resource_id = models.CharField(max_length=120, null=True, blank=True)
    decision = models.CharField(
        max_length=10,
        choices=[(DECISION_ALLOW, "Permitir"), (DECISION_DENY, "Denegar")],
    )
    reason = models.CharField(max_length=255, null=True, blank=True)
    reason_code = models.CharField(max_length=80, blank=True)
    matched_rule_type = models.CharField(max_length=50, blank=True)
    matched_rule_id = models.CharField(max_length=64, blank=True)
    policy_version = models.PositiveBigIntegerField(default=0)
    session_id = models.UUIDField(null=True, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True)
    correlation_id = models.UUIDField(default=uuid.uuid4)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "permission_audit_logs"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["employee", "created_at"], name="idx_permauditlog_emp_created"),
        ]

    def __str__(self):
        return f"{self.decision} :: {self.employee_id} :: {self.permission_id}"
