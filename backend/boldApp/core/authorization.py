"""
Logica de autorizacion del nucleo.

Implementa la regla del diagrama de base de datos tal cual:

    Empleado + asignacion activa + plaza + cargo + unidad objetivo.
    Los permisos de dos plazas del mismo empleado nunca se mezclan.

Por eso toda resolucion recibe una PositionAssignment concreta (una sola
plaza), nunca un Employee a secas: jamas se combinan los permisos de dos
asignaciones distintas de un mismo empleado en una sola decision.

Este modulo es el punto de integracion pensado para que el resto de modulos
del ecosistema (incluida la futura version reescrita de tareas) consulten
"puede este empleado hacer X" sin reimplementar la regla — ya sea llamando a
check_and_log() directamente (mismo proceso) o vía POST /api/core/authorize/
(entre servicios).
"""

from dataclasses import dataclass
from typing import Optional

from django.utils import timezone

from .models import AccessGrant, GrantAuthority, JobRolePermission, Permission, PermissionAuditLog


# Orden de niveles de sensibilidad conocidos, de menor a mayor. Un nivel que
# no aparece aqui se trata como el mas alto posible: ante la duda, se le
# exige la maxima autoridad en vez de asumir que es inofensivo.
SENSITIVITY_LEVELS = ["low", "medium", "high", "critical"]

# Nombres de capacidad de GrantAuthority, iguales a los campos del modelo
# para poder usarlos directo como filtro (**{capability: True}).
GRANT_CAPABILITY_GRANT = "can_grant_access"
GRANT_CAPABILITY_REVOKE = "can_revoke_access"
GRANT_CAPABILITY_DELEGATE = "can_delegate_authority"


def sensitivity_rank(level):
    try:
        return SENSITIVITY_LEVELS.index(level)
    except ValueError:
        return len(SENSITIVITY_LEVELS)


# Recorre la cadena de parent_unit de `unit` hacia arriba para saber si
# `ancestor` es la propia unidad o uno de sus ancestros. max_depth es una
# salvaguarda ante ciclos accidentales en los datos (el CheckConstraint del
# modelo solo evita que una unidad sea su propio padre directo).
def unit_is_within(unit, ancestor, max_depth=50):
    if unit is None or ancestor is None:
        return False

    current = unit
    depth = 0
    while current is not None and depth < max_depth:
        if current.id == ancestor.id:
            return True
        current = current.parent_unit
        depth += 1
    return False


# Decide si una regla JOB_ROLE_PERMISSIONS aplica a target_unit segun su
# scope_type:
#   - global: aplica en cualquier unidad.
#   - own_unit: solo en la unidad propia de la plaza (own_unit).
#   - specific_unit: solo en target_unit_id exactamente.
#   - sub_tree: en target_unit_id (o own_unit si no se fijo) y sus
#     descendientes.
def _scope_applies(role_permission, own_unit, target_unit):
    scope = role_permission.scope_type

    if scope == JobRolePermission.SCOPE_GLOBAL:
        return True
    if scope == JobRolePermission.SCOPE_OWN_UNIT:
        return target_unit.id == own_unit.id
    if scope == JobRolePermission.SCOPE_SPECIFIC_UNIT:
        return role_permission.target_unit_id is not None and target_unit.id == role_permission.target_unit_id
    if scope == JobRolePermission.SCOPE_SUB_TREE:
        root = role_permission.target_unit or own_unit
        return unit_is_within(target_unit, root)
    return False


@dataclass
class AuthorizationResult:
    allowed: bool
    reason: str
    audit_log_id: Optional[str] = None


# Resuelve si `assignment` (una plaza concreta) puede ejercer `permission`
# sobre `target_unit`, combinando los permisos base del cargo
# (JobRolePermission) con los accesos especiales vigentes otorgados a esa
# misma asignacion (AccessGrant). Una denegacion explicita del cargo gana
# sobre cualquier permiso base; los AccessGrant siempre conceden (no tienen
# "effect"), asi que solo pueden ampliar el acceso, nunca negarlo.
def resolve_access(assignment, permission, target_unit):
    if not assignment.is_active or assignment.released_at is not None:
        return AuthorizationResult(False, "La asignacion (plaza) no esta activa.")

    own_unit = assignment.position.unit
    job_role = assignment.position.job_role

    role_permissions = JobRolePermission.objects.filter(
        job_role=job_role,
        permission=permission,
    ).select_related("target_unit")

    has_allow = False
    for role_permission in role_permissions:
        if not _scope_applies(role_permission, own_unit, target_unit):
            continue
        if role_permission.effect == JobRolePermission.EFFECT_DENY:
            return AuthorizationResult(False, "Denegado explicitamente por el cargo (JobRolePermission).")
        if role_permission.effect == JobRolePermission.EFFECT_ALLOW:
            has_allow = True

    if has_allow:
        return AuthorizationResult(True, "Permitido por el cargo asignado a la plaza.")

    now = timezone.now()
    has_active_grant = (
        AccessGrant.objects.filter(
            grantee_assignment=assignment,
            permission=permission,
            target_unit=target_unit,
            status=AccessGrant.STATUS_ACTIVE,
            valid_from__lte=now,
        )
        .exclude(valid_until__isnull=False, valid_until__lt=now)
        .exists()
    )
    if has_active_grant:
        return AuthorizationResult(True, "Permitido por un acceso especial (AccessGrant) vigente.")

    return AuthorizationResult(False, "Sin permiso base ni acceso especial vigente para esta plaza y unidad.")


# Envuelve resolve_access() y deja constancia de la decision en
# PermissionAuditLog — para eso existe esa tabla segun el diagrama. Lanza
# Permission.DoesNotExist si el codigo no existe (la vista lo traduce a 400).
def check_and_log(employee, assignment, permission_code, target_unit, resource_id=None):
    permission = Permission.objects.get(code=permission_code)
    result = resolve_access(assignment, permission, target_unit)

    audit_log = PermissionAuditLog.objects.create(
        employee=employee,
        assignment=assignment,
        permission=permission,
        target_unit=target_unit,
        resource_id=resource_id,
        decision=PermissionAuditLog.DECISION_ALLOW if result.allowed else PermissionAuditLog.DECISION_DENY,
        reason=result.reason,
    )
    result.audit_log_id = str(audit_log.id)
    return result


# Verifica si `assignment` tiene una GrantAuthority activa y vigente que le
# permita ejercer `capability` ("can_grant_access", "can_revoke_access" o
# "can_delegate_authority") sobre target_unit, respetando el nivel maximo de
# sensibilidad autorizado. Es el "quien puede otorgar este AccessGrant".
def has_grant_authority(assignment, target_unit, capability):
    now = timezone.now()

    authorities = (
        GrantAuthority.objects.filter(assignment=assignment, is_active=True, **{capability: True})
        .exclude(valid_until__isnull=False, valid_until__lt=now)
        .select_related("target_unit")
    )

    target_rank = sensitivity_rank(target_unit.sensitivity_level)

    for authority in authorities:
        if authority.target_unit_id is not None and not unit_is_within(target_unit, authority.target_unit):
            continue
        if target_rank > sensitivity_rank(authority.max_sensitivity_level):
            continue
        return True

    return False
