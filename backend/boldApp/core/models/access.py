from django.db import models

from .mixins import UUIDPrimaryKeyModel
from .organizational import Employee, OrganizationalUnit, PositionAssignment
from .permissions import Permission


# Define la tabla ACCESS_GRANTS: un acceso especial y temporal otorgado a UNA
# asignacion (plaza) concreta sobre un permiso y una unidad objetivo, fuera
# de lo que ya le da su cargo. A diferencia de JOB_ROLE_PERMISSIONS no tiene
# "effect": un AccessGrant siempre concede, nunca deniega explicitamente.
class AccessGrant(UUIDPrimaryKeyModel):
    STATUS_ACTIVE = "active"
    STATUS_REVOKED = "revoked"
    STATUS_EXPIRED = "expired"

    grantee_assignment = models.ForeignKey(
        PositionAssignment,
        on_delete=models.PROTECT,
        related_name="access_grants_received",
    )
    permission = models.ForeignKey(Permission, on_delete=models.PROTECT, related_name="access_grants")
    target_unit = models.ForeignKey(OrganizationalUnit, on_delete=models.PROTECT, related_name="access_grants")
    granted_by_assignment = models.ForeignKey(
        PositionAssignment,
        on_delete=models.PROTECT,
        related_name="access_grants_issued",
    )
    valid_from = models.DateTimeField()
    valid_until = models.DateTimeField(null=True, blank=True)
    reason = models.CharField(max_length=255)
    status = models.CharField(max_length=20, default=STATUS_ACTIVE)
    created_at = models.DateTimeField(auto_now_add=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    revoked_by_assignment = models.ForeignKey(
        PositionAssignment,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="access_grants_revoked",
    )

    class Meta:
        db_table = "access_grants"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["grantee_assignment", "status"], name="idx_accessgrant_grantee_status"),
        ]

    def __str__(self):
        return f"{self.permission_id} -> {self.grantee_assignment_id}"


# Define la tabla GRANT_AUTHORITIES: la autoridad de UNA asignacion para
# otorgar/revocar accesos o delegar esa misma autoridad, acotada a una unidad
# (y su sub-arbol) y a un nivel maximo de sensibilidad. Es el "quien puede
# crear un AccessGrant" — se valida en AccessGrantSerializer.validate().
class GrantAuthority(UUIDPrimaryKeyModel):
    assignment = models.ForeignKey(PositionAssignment, on_delete=models.PROTECT, related_name="grant_authorities")
    target_unit = models.ForeignKey(
        OrganizationalUnit,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="grant_authorities",
    )
    max_sensitivity_level = models.CharField(max_length=20)
    can_grant_access = models.BooleanField(default=False)
    can_revoke_access = models.BooleanField(default=False)
    can_delegate_authority = models.BooleanField(default=False)
    granted_by_assignment = models.ForeignKey(
        PositionAssignment,
        on_delete=models.PROTECT,
        related_name="grant_authorities_issued",
    )
    valid_until = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "grant_authorities"
        ordering = ["-created_at"]

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
    resource_id = models.UUIDField(null=True, blank=True)
    decision = models.CharField(max_length=10)
    reason = models.CharField(max_length=255, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "permission_audit_logs"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["employee", "created_at"], name="idx_permauditlog_emp_created"),
        ]

    def __str__(self):
        return f"{self.decision} :: {self.employee_id} :: {self.permission_id}"
