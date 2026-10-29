"""Motor central de autorización de Bold.

Todas las decisiones se resuelven sobre una única ``PositionAssignment``.
El módulo ``permisos`` administra las políticas; Core conserva este motor
para que cada módulo de contenido aplique las mismas reglas sin duplicarlas.
"""

from dataclasses import dataclass, field
from datetime import timedelta
from typing import Optional

from django.conf import settings
from django.core.exceptions import ObjectDoesNotExist
from django.db import DatabaseError
from django.db.models import Q
from django.utils import timezone

from .models import AccessGrant, GrantAuthority, JobRolePermission, Permission, PermissionAuditLog
from .request_metadata import request_ip


SENSITIVITY_LEVELS = ["low", "medium", "high", "critical"]

GRANT_CAPABILITY_GRANT = "can_grant_access"
GRANT_CAPABILITY_REVOKE = "can_revoke_access"
GRANT_CAPABILITY_DELEGATE = "can_delegate_authority"

CREATOR_SCOPED_PERMISSION_CODES = frozenset({
    "tasks.task.update",
    "tasks.task.delete",
    "tasks.task.assign",
})


def sensitivity_rank(level):
    try:
        return SENSITIVITY_LEVELS.index(level)
    except ValueError:
        return len(SENSITIVITY_LEVELS)


def _unit_ancestor_ids(unit, max_depth=100):
    """Devuelve la cadena completa o ``None`` si hay un ciclo/demasiada profundidad."""
    if unit is None:
        return None
    ids = []
    seen = set()
    current = unit
    for _ in range(max_depth):
        if current is None:
            return ids
        if current.id in seen:
            return None
        seen.add(current.id)
        ids.append(current.id)
        current = current.parent_unit
    return None if current is not None else ids


def unit_is_within(unit, ancestor, max_depth=100):
    if unit is None or ancestor is None:
        return False
    chain = _unit_ancestor_ids(unit, max_depth=max_depth)
    return chain is not None and ancestor.id in chain


def _scope_applies(scope_type, own_unit, target_unit, scoped_unit=None):
    if target_unit is None or own_unit is None:
        return False
    if scope_type == JobRolePermission.SCOPE_GLOBAL:
        return True
    if scope_type == JobRolePermission.SCOPE_OWN_UNIT:
        return target_unit.id == own_unit.id
    if scope_type == JobRolePermission.SCOPE_OWN_SUB_TREE:
        return unit_is_within(target_unit, own_unit)
    if scope_type == JobRolePermission.SCOPE_SPECIFIC_UNIT:
        return scoped_unit is not None and target_unit.id == scoped_unit.id
    if scope_type == JobRolePermission.SCOPE_SUB_TREE:
        return scoped_unit is not None and unit_is_within(target_unit, scoped_unit)
    return False


def _role_scope_applies(rule, assignment, permission, target_unit, resource_created_by_assignment_id):
    if rule.scope_type == JobRolePermission.SCOPE_CREATED_BY_ME:
        return (
            permission.code in CREATOR_SCOPED_PERMISSION_CODES
            and resource_created_by_assignment_id is not None
            and str(resource_created_by_assignment_id) == str(assignment.id)
            and target_unit.id == assignment.position.unit_id
        )
    return _scope_applies(
        rule.scope_type,
        assignment.position.unit,
        target_unit,
        rule.target_unit,
    )


def _principal_is_active(assignment):
    if not assignment or not assignment.is_active or assignment.released_at is not None:
        return False, "assignment_inactive", "La asignación (plaza) no está activa."
    if not assignment.employee.is_active:
        return False, "employee_inactive", "El empleado no está activo."
    try:
        account = assignment.employee.user_account
    except ObjectDoesNotExist:
        return False, "account_missing", "La asignación no tiene una cuenta activa."
    if not account.is_active:
        return False, "account_inactive", "La cuenta no está activa."
    return True, "", ""


def authority_is_effective(authority, at=None, max_depth=20):
    moment = at or timezone.now()
    current = authority
    seen = set()
    for _ in range(max_depth):
        if current is None:
            return True
        if current.id in seen:
            return False
        seen.add(current.id)
        if (
            not current.is_active
            or current.revoked_at is not None
            or current.valid_from > moment
            or (current.valid_until is not None and moment >= current.valid_until)
        ):
            return False
        principal_ok, _, _ = _principal_is_active(current.assignment)
        if not principal_ok:
            return False
        current = current.parent_authority
    return False


def grant_authority_covers_target(authority, target_unit, permission, capability, at=None):
    """Valida una autoridad concreta contra la unidad usada en la decisión.

    Un grant conserva la autoridad que lo originó. Revalidar esa misma fila
    evita que una autoridad estrecha emita una regla amplia que sobreviva para
    unidades o sensibilidades que nunca estuvieron dentro de su mandato.
    """

    if (
        authority is None
        or target_unit is None
        or permission is None
        or capability not in {
            GRANT_CAPABILITY_GRANT,
            GRANT_CAPABILITY_REVOKE,
            GRANT_CAPABILITY_DELEGATE,
        }
        or not getattr(authority, capability, False)
        or not permission.is_active
        or not permission.is_delegable
        or not authority_is_effective(authority, at)
    ):
        return False
    prefetched = getattr(authority, "_prefetched_objects_cache", {}).get("scoped_permissions")
    has_permission = (
        any(row.permission_id == permission.id for row in prefetched)
        if prefetched is not None
        else authority.scoped_permissions.filter(permission_id=permission.id).exists()
    )
    if not has_permission:
        return False
    if not _scope_applies(
        authority.scope_type,
        authority.assignment.position.unit,
        target_unit,
        authority.target_unit,
    ):
        return False
    maximum = sensitivity_rank(authority.max_sensitivity_level)
    return (
        sensitivity_rank(target_unit.sensitivity_level) <= maximum
        and sensitivity_rank(permission.risk_level) <= maximum
    )


def _grant_is_applicable(grant, assignment, target_unit, resource_id, at):
    if not grant.is_effective(at):
        return False
    if grant.source_authority_id:
        capability = (
            GRANT_CAPABILITY_REVOKE
            if grant.effect == AccessGrant.EFFECT_DENY
            else GRANT_CAPABILITY_GRANT
        )
        if not grant_authority_covers_target(
            grant.source_authority,
            target_unit,
            grant.permission,
            capability,
            at,
        ):
            return False
    if grant.resource_id:
        if resource_id is None or str(resource_id) != str(grant.resource_id):
            return False
    return _scope_applies(grant.scope_type, assignment.position.unit, target_unit, grant.target_unit)


def access_grant_is_potentially_effective(grant, at=None):
    """Estado operativo de una regla para listados del plano de control.

    Una regla puede conservar ``status=active`` por trazabilidad y aun así
    dejar de ser utilizable porque se desactivó el permiso, el destinatario o
    la cadena de autoridad que la originó. La decisión sobre una unidad real
    sigue correspondiendo a :func:`resolve_access`.
    """

    moment = at or timezone.now()
    if not grant.is_effective(moment) or not grant.permission.is_active:
        return False
    principal_ok, _, _ = _principal_is_active(grant.grantee_assignment)
    if not principal_ok:
        return False
    if not grant.source_authority_id:
        return True
    representative_unit = (
        grant.grantee_assignment.position.unit
        if grant.scope_type in {AccessGrant.SCOPE_GLOBAL, AccessGrant.SCOPE_OWN_UNIT}
        else grant.target_unit
    )
    capability = (
        GRANT_CAPABILITY_REVOKE
        if grant.effect == AccessGrant.EFFECT_DENY
        else GRANT_CAPABILITY_GRANT
    )
    return grant_authority_covers_target(
        grant.source_authority,
        representative_unit,
        grant.permission,
        capability,
        moment,
    )


@dataclass
class AuthorizationResult:
    allowed: bool
    reason: str
    reason_code: str = ""
    matched_rule_type: str = ""
    matched_rule_id: Optional[str] = None
    policy_version: int = 0
    audit_log_id: Optional[str] = None


@dataclass
class AuthorizationContext:
    assignment: object
    permission: Permission
    at: object
    principal_ok: bool
    principal_reason_code: str
    principal_reason: str
    role_rules: list
    direct_rules: list
    policy_version: int
    resource_contexts: dict = field(default_factory=dict)


def current_policy_version():
    try:
        from boldApp.permisos.models import PermissionPolicyState

        return PermissionPolicyState.current_revision()
    except (ImportError, RuntimeError, DatabaseError):
        return 0


def _decision(allowed, reason, code, rule_type="", rule_id=None, policy_version=None):
    return AuthorizationResult(
        allowed=allowed,
        reason=reason,
        reason_code=code,
        matched_rule_type=rule_type,
        matched_rule_id=str(rule_id) if rule_id else None,
        policy_version=current_policy_version() if policy_version is None else policy_version,
    )


def build_authorization_context(assignment, permission, at=None):
    principal_ok, reason_code, reason = _principal_is_active(assignment)
    moment = at or timezone.now()
    role_rules = []
    direct_rules = []
    if principal_ok and permission.is_active:
        role_rules = list(
            JobRolePermission.objects.filter(
                job_role=assignment.position.job_role,
                permission=permission,
            ).select_related("target_unit")
        )
        direct_rules = list(
            AccessGrant.objects.filter(
                grantee_assignment=assignment,
                permission=permission,
                status=AccessGrant.STATUS_ACTIVE,
                revoked_at__isnull=True,
                valid_from__lte=moment,
            )
            .filter(Q(valid_until__isnull=True) | Q(valid_until__gt=moment))
            .select_related(
                "permission",
                "target_unit",
                "source_authority",
                "source_authority__parent_authority",
                "source_authority__assignment__employee__user_account",
                "source_authority__assignment__position__unit",
            )
            .prefetch_related("source_authority__scoped_permissions")
        )
    return AuthorizationContext(
        assignment=assignment,
        permission=permission,
        at=moment,
        principal_ok=principal_ok,
        principal_reason_code=reason_code,
        principal_reason=reason,
        role_rules=role_rules,
        direct_rules=direct_rules,
        policy_version=current_policy_version(),
    )


def resolve_access(
    assignment,
    permission,
    target_unit,
    resource_id=None,
    at=None,
    context=None,
    resource_created_by_assignment_id=None,
    task_status_only=False,
):
    """Resuelve acceso con deny-first y herencia implícita para el dueño.

    Toda cuenta activa marcada ``is_superuser`` hereda cualquier permiso
    activo, incluido uno registrado después de crear la cuenta. La concesión
    es una invariante del motor, no una colección de reglas persistidas que
    pueda quedar desactualizada. Las guardas estructurales y el MFA se siguen
    aplicando también al dueño.
    """
    context = context or build_authorization_context(assignment, permission, at=at)
    if context.assignment.id != assignment.id or context.permission.id != permission.id:
        raise ValueError("El contexto de autorización no corresponde a la asignación y permiso indicados.")
    if not context.principal_ok:
        return _decision(
            False,
            context.principal_reason,
            context.principal_reason_code,
            "system",
            policy_version=context.policy_version,
        )
    if not permission.is_active:
        return _decision(
            False,
            "El permiso está desactivado.",
            "permission_inactive",
            "system",
            policy_version=context.policy_version,
        )
    if target_unit is None:
        return _decision(
            False,
            "No se indicó una unidad objetivo válida.",
            "target_unit_missing",
            "system",
            policy_version=context.policy_version,
        )
    if _unit_ancestor_ids(target_unit) is None:
        return _decision(
            False,
            "La jerarquía organizacional no es válida.",
            "unit_hierarchy_invalid",
            "system",
            policy_version=context.policy_version,
        )
    if permission.code.startswith("sheets.") and settings.SHEETS_PILOT_ENABLED and str(assignment.position.unit_id) not in settings.SHEETS_PILOT_UNIT_IDS:
        return _decision(
            False,
            "Sheets está disponible únicamente para las unidades autorizadas del piloto de IT.",
            "sheets_pilot_restricted",
            "system",
            policy_version=context.policy_version,
        )
    if permission.code.startswith("slack."):
        from boldApp.mensajeria.access import assignment_can_chat
        if not assignment_can_chat(assignment):
            return _decision(False, "Slack permanece en el piloto de IT.", "slack_pilot_restricted",
                             "system", policy_version=context.policy_version)
        if resource_id is not None:
            from boldApp.mensajeria.channel_acl import boundary_allows
            if not boundary_allows(assignment, permission, target_unit, resource_id, context):
                return _decision(False, "El acceso al canal requiere una invitación vigente y suficiente.",
                                 "slack_channel_boundary", "system", policy_version=context.policy_version)
    if assignment.employee.user_account.is_superuser:
        return _decision(
            True,
            "El propietario hereda todos los permisos activos por definición.",
            "owner_full_access",
            "system",
            policy_version=context.policy_version,
        )

    from .resource_context import resource_participation_allows

    if not resource_participation_allows(assignment, permission, resource_id):
        return _decision(
            False,
            "No participas en este proyecto.",
            "resource_participation_required",
            "system",
            policy_version=context.policy_version,
        )

    moment = context.at
    own_unit = assignment.position.unit
    role_rules = context.role_rules
    direct_rules = context.direct_rules
    task_context = {}
    if permission.code in {"tasks.task.update", "tasks.task.delete"} and resource_id is not None:
        from .resource_context import resolve_resource_context

        # Membership is trusted domain data, never an employee/role name or a
        # claim from the client. It authorizes only this existing task/unit.
        task_context = resolve_resource_context(permission, resource_id)
        if permission.code == "tasks.task.delete" and (
            task_context.get("task_unit_id") != target_unit.id
            or assignment.id not in task_context.get("task_delete_assignment_ids", ())
        ):
            return _decision(False, "Solo el creador o el responsable directo puede eliminar esta tarea.",
                "task_delete_principal_required", "system", policy_version=context.policy_version)

    if (
        resource_created_by_assignment_id is None
        and resource_id is not None
        and any(rule.scope_type == JobRolePermission.SCOPE_CREATED_BY_ME for rule in role_rules)
    ):
        from .resource_context import resolve_resource_context

        resource_context = task_context or resolve_resource_context(permission, resource_id)
        resource_created_by_assignment_id = resource_context.get("resource_created_by_assignment_id")

    applicable_direct = [
        rule for rule in direct_rules
        if _grant_is_applicable(rule, assignment, target_unit, resource_id, moment)
    ]
    for rule in applicable_direct:
        if rule.effect == AccessGrant.EFFECT_DENY:
            return _decision(
                False,
                "Denegado por una excepción individual explícita.",
                "direct_deny",
                "access_grant",
                rule.id,
                context.policy_version,
            )

    applicable_role = [
        rule for rule in role_rules
        if _role_scope_applies(
            rule,
            assignment,
            permission,
            target_unit,
            resource_created_by_assignment_id,
        )
    ]
    for rule in applicable_role:
        if rule.effect == JobRolePermission.EFFECT_DENY:
            return _decision(
                False,
                "Denegado explícitamente por la política del cargo.",
                "role_deny",
                "job_role_permission",
                rule.id,
                context.policy_version,
            )

    # Only a server-validated status-only mutation may use the assignee's narrow grant.
    if task_status_only and permission.code == "tasks.task.update" and resource_id is not None:
        from .resource_context import resolve_resource_context

        if task_context.get("task_unit_id") == target_unit.id and task_context.get("task_assignee_assignment_id") == assignment.id:
            return _decision(
                True,
                "El responsable puede cambiar el estado de su tarea asignada.",
                "assigned_task_status",
                "task_assignment",
                policy_version=context.policy_version,
            )

    # An independent channel has no department to delegate. Do not turn an
    # own-unit manager into the manager of every independent private channel.
    if permission.code == "slack.channel.access" and resource_id is not None:
        from boldApp.mensajeria.channel_acl import channel_context
        channel = channel_context(assignment, resource_id, context)
        if channel and channel["unit_id"] is None:
            applicable_direct = [rule for rule in applicable_direct if rule.scope_type == AccessGrant.SCOPE_GLOBAL
                or (rule.resource_id and str(rule.resource_id) == str(resource_id))]
            applicable_role = [rule for rule in applicable_role if rule.scope_type == JobRolePermission.SCOPE_GLOBAL]

    for rule in applicable_direct:
        if rule.effect == AccessGrant.EFFECT_ALLOW:
            return _decision(
                True,
                "Permitido por un acceso individual vigente.",
                "direct_allow",
                "access_grant",
                rule.id,
                context.policy_version,
            )

    for rule in applicable_role:
        if rule.effect == JobRolePermission.EFFECT_ALLOW:
            return _decision(
                True,
                "Permitido por la política del cargo.",
                "role_allow",
                "job_role_permission",
                rule.id,
                context.policy_version,
            )

    # Explicit task collaboration is independent of the employee's job title.
    # All applicable denials above still win; MFA is applied by check_and_log.
    # No resource-less, reassignment or project-management rights are granted.
    if task_context.get("task_unit_id") == target_unit.id:
        participant_ids = task_context.get(
            "task_editor_assignment_ids" if permission.code == "tasks.task.update" else "task_delete_assignment_ids", ())
        if assignment.id in participant_ids:
            return _decision(True,
                "Permitido por la participación explícita en esta tarea." if permission.code == "tasks.task.update"
                else "Permitido al creador o responsable directo de esta tarea.",
                "task_participant_update" if permission.code == "tasks.task.update" else "task_principal_delete",
                "task_assignment", policy_version=context.policy_version)

    if (
        permission.code in CREATOR_SCOPED_PERMISSION_CODES
        and resource_created_by_assignment_id is not None
        and any(
            rule.effect == JobRolePermission.EFFECT_ALLOW
            and rule.scope_type == JobRolePermission.SCOPE_CREATED_BY_ME
            for rule in role_rules
        )
    ):
        return _decision(
            False,
            "Tu cargo solo permite modificar tareas creadas por tu asignación activa dentro de tu unidad.",
            "resource_not_created_by_assignment",
            "job_role_permission",
            policy_version=context.policy_version,
        )

    # A project invitation grants only this project's read access. Administration
    # and unit-wide policies are never inherited from the inviting department.
    if permission.code == "tasks.project.read" and resource_id is not None and own_unit.id != target_unit.id:
        from .resource_context import resolve_resource_context
        project_context = resolve_resource_context(permission, resource_id)
        if project_context.get("project_unit_id") == target_unit.id and assignment.id in project_context.get("project_member_assignment_ids", ()):
            if resolve_access(assignment, permission, own_unit, context=context).allowed:
                return _decision(True, "Lectura del proyecto al que se añadió esta asignación.",
                    "project_member_read", "project_membership", policy_version=context.policy_version)

    # Commenting on an explicitly shared task also requires the person's own
    # comment policy and effective read permission for that exact task.
    if permission.code == "tasks.comment.create" and resource_id is not None and own_unit.id != target_unit.id:
        from .resource_context import resolve_resource_context
        comment_context = resolve_resource_context(permission, resource_id)
        if comment_context.get("task_unit_id") == target_unit.id and assignment.id in comment_context.get("task_reader_assignment_ids", ()):
            read_permission = Permission.objects.filter(code="tasks.task.read", is_active=True).first()
            if read_permission and resolve_access(assignment, permission, own_unit, context=context).allowed and resolve_access(
                assignment, read_permission, target_unit, resource_id=resource_id).allowed:
                return _decision(True, "Comentarios en una tarea compartida con acceso de lectura vigente.",
                    "shared_task_comment", "task_assignment", policy_version=context.policy_version)

    # An assignment shares only this task's read access, not the source unit.
    # Explicit target-unit denials above and the reader's own policies still apply.
    if permission.code == "tasks.task.read" and resource_id is not None and own_unit.id != target_unit.id:
        from .resource_context import resolve_resource_context

        resource_context = context.resource_contexts.get(str(resource_id))
        if resource_context is None:
            resource_context = resolve_resource_context(permission, resource_id)
        readers = resource_context.get("task_reader_assignment_ids", ())
        if assignment.id in readers:
            own_access = resolve_access(assignment, permission, own_unit, context=context)
            if own_access.allowed:
                return _decision(
                    True,
                    "Lectura de una tarea asignada como responsable o colaborador.",
                    "assigned_task_read",
                    "task_assignment",
                    policy_version=context.policy_version,
                )

    if permission.code == "slack.channel.access" and resource_id is not None:
        from boldApp.mensajeria.channel_acl import channel_context
        channel = channel_context(assignment, resource_id, context)
        if channel and channel["creator__employee_id"] == assignment.employee_id:
            return _decision(True, "El creador administra las invitaciones, sin lectura implícita.",
                             "slack_channel_creator_access", "system", policy_version=context.policy_version)

    # Deliberate product default: employees may collaborate unless an explicit
    # role/direct denial above applies. Unknown/inactive permissions stay closed.
    # This lives in Core so the Permissions UI and runtime use the same decision.
    if permission.code in {"slack.channel.read", "slack.channel.create", "slack.channel.manage",
                            "slack.message.create", "slack.message.update", "slack.reaction.create", "slack.page.read", "slack.page.create",
                            "slack.page.update", "slack.page.manage", "slack.template.read", "slack.template.create",
                            "slack.template.update", "slack.template.manage", "slack.page_comment.read",
                            "slack.page_comment.create", "slack.page_comment.update", "slack.page_comment.delete", "slack.page_comment.manage",
                            "slack.automation.read", "slack.automation.manage"}:
        return _decision(True, "Colaboración de empleados habilitada salvo restricción explícita.",
                         "slack_employee_default", "system", policy_version=context.policy_version)

    return _decision(
        False,
        "No existe una regla aplicable.",
        "default_deny",
        "system",
        policy_version=context.policy_version,
    )


def request_has_recent_strong_mfa(request):
    """Comprueba assurance fuerte sin acoplar Core al módulo de Permisos."""
    if request is None:
        return False
    session = getattr(request, "auth", None)
    verified_at = getattr(session, "mfa_verified_at", None)
    if not verified_at or getattr(session, "auth_strength", "") not in {"password_totp", "webauthn"}:
        return False
    seconds = getattr(settings, "PERMISSIONS_STEP_UP_MFA_SECONDS", 600)
    return verified_at >= timezone.now() - timedelta(seconds=seconds)


def apply_session_assurance(result, permission, request):
    """Aplica requisitos de la sesión a una decisión ya resuelta."""

    if result.allowed and permission.requires_step_up_mfa and not request_has_recent_strong_mfa(request):
        return _decision(
            False,
            "Este permiso requiere una confirmación MFA reciente.",
            "mfa_step_up_required",
            "session_assurance",
            policy_version=result.policy_version,
        )
    return result


def check_and_log(
    *, assignment, permission_code, target_unit, resource_id=None, resource_type="", request=None,
    resource_created_by_assignment_id=None,
    task_status_only=False,
):
    permission = Permission.objects.get(code=permission_code.strip().lower())
    result = resolve_access(
        assignment,
        permission,
        target_unit,
        resource_id=resource_id,
        resource_created_by_assignment_id=resource_created_by_assignment_id,
        task_status_only=task_status_only,
    )
    result = apply_session_assurance(result, permission, request)
    account = None
    try:
        account = assignment.employee.user_account
    except ObjectDoesNotExist:
        pass
    request_user = getattr(request, "user", None) if request else None
    if request_user is not None and getattr(request_user, "is_authenticated", False):
        account = request_user
    request_session = getattr(request, "auth", None) if request else None
    audit_log = PermissionAuditLog.objects.create(
        employee=assignment.employee,
        actor_account=account,
        assignment=assignment,
        permission=permission,
        target_unit=target_unit,
        module_code=permission.module_code,
        resource_type=resource_type or permission.resource,
        resource_id=str(resource_id) if resource_id is not None else None,
        decision=PermissionAuditLog.DECISION_ALLOW if result.allowed else PermissionAuditLog.DECISION_DENY,
        reason=result.reason[:255],
        reason_code=result.reason_code,
        matched_rule_type=result.matched_rule_type,
        matched_rule_id=result.matched_rule_id or "",
        policy_version=result.policy_version,
        session_id=getattr(request_session, "id", None),
        ip_address=request_ip(request),
        user_agent=(request.META.get("HTTP_USER_AGENT", "")[:1000] if request else ""),
    )
    result.audit_log_id = str(audit_log.id)
    return result


def matching_grant_authority(assignment, target_unit, capability, permission, at=None):
    """Retorna la autoridad concreta; una allowlist vacía nunca significa acceso total."""
    principal_ok, _, _ = _principal_is_active(assignment)
    if not principal_ok or not permission or not permission.is_active or not permission.is_delegable:
        return None
    moment = at or timezone.now()
    authorities = (
        GrantAuthority.objects.filter(
            assignment=assignment,
            is_active=True,
            revoked_at__isnull=True,
            valid_from__lte=moment,
            scoped_permissions__permission=permission,
            **{capability: True},
        )
        .filter(Q(valid_until__isnull=True) | Q(valid_until__gt=moment))
        .select_related("target_unit", "parent_authority", "assignment__position__unit")
        .prefetch_related("scoped_permissions")
        .distinct()
    )
    for authority in authorities:
        if grant_authority_covers_target(authority, target_unit, permission, capability, moment):
            return authority
    return None


def has_grant_authority(assignment, target_unit, capability, permission):
    return matching_grant_authority(assignment, target_unit, capability, permission) is not None
