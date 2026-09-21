from datetime import timedelta
from functools import partial

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError

from boldApp.autenticacion.services import request_ip
from boldApp.core.authorization import (
    GRANT_CAPABILITY_DELEGATE,
    GRANT_CAPABILITY_GRANT,
    GRANT_CAPABILITY_REVOKE,
    authority_is_effective,
    grant_authority_covers_target,
    sensitivity_rank,
    unit_is_within,
)
from boldApp.core.models import (
    AccessGrant,
    GrantAuthority,
    GrantAuthorityPermission,
    JobRolePermission,
    Permission,
    PositionAssignment,
)

from .models import PermissionPolicyEvent, PermissionPolicyState


ASSIGNMENT_HEADER = "X-Assignment-ID"
PERMISSION_INVALIDATION_GROUP = "permission_watch"
STRONG_MFA_STRENGTHS = {"password_totp", "webauthn"}
DEFAULT_GRANT_SECONDS = {
    Permission.RISK_LOW: 7 * 24 * 60 * 60,
    Permission.RISK_MEDIUM: 7 * 24 * 60 * 60,
    Permission.RISK_HIGH: 24 * 60 * 60,
    Permission.RISK_CRITICAL: 8 * 60 * 60,
}


class PolicyConflict(APIException):
    status_code = 409
    default_code = "policy_revision_conflict"
    default_detail = "La política cambió desde que se abrió esta pantalla. Recarga e inténtalo de nuevo."


class MFAStepUpRequired(APIException):
    status_code = 403
    default_code = "mfa_step_up_required"
    default_detail = {
        "detail": "Confirma nuevamente tu MFA para realizar esta operación sensible.",
        "code": "mfa_step_up_required",
    }


def normalized_reason(value):
    reason = str(value or "").strip()
    if len(reason) < 8:
        raise ValidationError({"reason": "Explica el motivo con al menos 8 caracteres."})
    return reason


def get_request_assignment(request, *, for_update=False):
    assignment_id = request.headers.get(ASSIGNMENT_HEADER)
    if not assignment_id:
        raise PermissionDenied("Selecciona una asignación activa en X-Assignment-ID.")
    queryset = PositionAssignment.objects.select_related(
        "employee__user_account", "position__unit", "position__job_role"
    )
    if for_update:
        queryset = queryset.select_for_update(of=("self",))
    try:
        assignment = queryset.get(
            id=assignment_id,
            employee_id=request.user.employee_id,
            employee__is_active=True,
            is_active=True,
            released_at__isnull=True,
        )
    except (PositionAssignment.DoesNotExist, ValueError) as error:
        raise PermissionDenied("La asignación seleccionada no está activa o no pertenece a tu cuenta.") from error
    if not request.user.is_active:
        raise PermissionDenied("La cuenta no está activa.")
    return assignment


def has_recent_strong_mfa(request):
    session = getattr(request, "auth", None)
    verified_at = getattr(session, "mfa_verified_at", None)
    if not verified_at or getattr(session, "auth_strength", "") not in STRONG_MFA_STRENGTHS:
        return False
    seconds = getattr(
        settings,
        "PERMISSIONS_STEP_UP_MFA_SECONDS",
        getattr(settings, "ADMIN_STEP_UP_MFA_SECONDS", 600),
    )
    return verified_at >= timezone.now() - timedelta(seconds=seconds)


def require_recent_strong_mfa(request):
    if not has_recent_strong_mfa(request):
        raise MFAStepUpRequired()


def _lock_state(expected_revision=None):
    PermissionPolicyState.objects.get_or_create(key=PermissionPolicyState.GLOBAL_KEY)
    state = PermissionPolicyState.objects.select_for_update().get(key=PermissionPolicyState.GLOBAL_KEY)
    if expected_revision is not None and state.revision != expected_revision:
        raise PolicyConflict()
    return state


def _broadcast_revision(revision):
    layer = get_channel_layer()
    if layer is not None:
        async_to_sync(layer.group_send)(
            PERMISSION_INVALIDATION_GROUP,
            {"type": "permission.changed", "revision": revision},
        )


def record_policy_change(
    request,
    assignment,
    state,
    *,
    event_type,
    target_type,
    target_id="",
    permission=None,
    target_unit=None,
    reason,
    before=None,
    after=None,
    metadata=None,
):
    state.revision += 1
    state.save(update_fields=["revision", "updated_at"])
    event = PermissionPolicyEvent.objects.create(
        revision=state.revision,
        actor_account=request.user,
        actor_assignment=assignment,
        session_id=getattr(getattr(request, "auth", None), "id", None),
        event_type=event_type,
        target_type=target_type,
        target_id=str(target_id or ""),
        permission=permission,
        target_unit=target_unit,
        reason=reason,
        before=before or {},
        after=after or {},
        metadata=metadata or {},
        mfa_verified=has_recent_strong_mfa(request),
        ip_address=request_ip(request),
        user_agent=request.META.get("HTTP_USER_AGENT", "")[:1000],
    )
    transaction.on_commit(partial(_broadcast_revision, state.revision))
    return event


def record_denied_event(request, event_type, reason, *, target_type="security", target_id="", metadata=None):
    assignment = None
    try:
        assignment = get_request_assignment(request)
    except PermissionDenied:
        pass
    return PermissionPolicyEvent.objects.create(
        revision=PermissionPolicyState.current_revision(),
        actor_account=request.user if request.user.is_authenticated else None,
        actor_assignment=assignment,
        session_id=getattr(getattr(request, "auth", None), "id", None),
        event_type=event_type,
        outcome=PermissionPolicyEvent.OUTCOME_DENIED,
        target_type=target_type,
        target_id=str(target_id or ""),
        reason=str(reason),
        metadata=metadata or {},
        mfa_verified=has_recent_strong_mfa(request),
        ip_address=request_ip(request),
        user_agent=request.META.get("HTTP_USER_AGENT", "")[:1000],
    )


def _scope_payload(row):
    return {
        "id": str(row.id),
        "effect": row.effect,
        "scope_type": row.scope_type,
        "target_unit": str(row.target_unit_id) if row.target_unit_id else None,
    }


@transaction.atomic
def replace_role_policy(request, *, role, permission, rules, reason, expected_revision=None):
    reason = normalized_reason(reason)
    assignment = get_request_assignment(request, for_update=True)
    if not request.user.is_superuser:
        raise PermissionDenied("Solo el dueño puede modificar políticas base por cargo.")
    require_recent_strong_mfa(request)
    if not permission.is_active:
        raise ValidationError({"permission": "El permiso está desactivado."})
    state = _lock_state(expected_revision)
    existing = list(
            JobRolePermission.objects.select_for_update(of=("self",))
        .filter(job_role=role, permission=permission)
        .select_related("target_unit")
    )
    before = {"rules": [_scope_payload(row) for row in existing]}
    JobRolePermission.objects.filter(job_role=role, permission=permission).delete()
    created = []
    for rule in rules:
        created.append(
            JobRolePermission.objects.create(
                job_role=role,
                permission=permission,
                effect=rule["effect"],
                scope_type=rule["scope_type"],
                target_unit=rule.get("target_unit"),
                reason=reason,
                created_by_account=request.user,
            )
        )
    event = record_policy_change(
        request,
        assignment,
        state,
        event_type="permissions.role_policy.replaced",
        target_type="job_role",
        target_id=role.id,
        permission=permission,
        reason=reason,
        before=before,
        after={"rules": [_scope_payload(row) for row in created]},
    )
    return created, event.revision


def _maximum_grant_seconds(permission):
    return DEFAULT_GRANT_SECONDS.get(permission.risk_level, DEFAULT_GRANT_SECONDS[Permission.RISK_CRITICAL])


def _validate_scope(scope_type, target_unit):
    if scope_type in {AccessGrant.SCOPE_GLOBAL, AccessGrant.SCOPE_OWN_UNIT} and target_unit is not None:
        raise ValidationError({"target_unit": "Este alcance no admite una unidad explícita."})
    if scope_type in {AccessGrant.SCOPE_SPECIFIC_UNIT, AccessGrant.SCOPE_SUB_TREE} and target_unit is None:
        raise ValidationError({"target_unit": "Este alcance requiere una unidad objetivo."})


def _rule_representative_unit(grantee_assignment, scope_type, target_unit):
    if scope_type == AccessGrant.SCOPE_OWN_UNIT:
        return grantee_assignment.position.unit
    if scope_type in {AccessGrant.SCOPE_SPECIFIC_UNIT, AccessGrant.SCOPE_SUB_TREE}:
        return target_unit
    return None


def _find_access_rule_authority(
    actor_assignment,
    grantee_assignment,
    permission,
    *,
    scope_type,
    target_unit,
    capability,
    at=None,
):
    """Busca una autoridad cuyo conjunto completo contenga la regla solicitada."""

    # Una autoridad delegada ordinaria nunca modifica reglas globales. Esto
    # evita que una sensibilidad limitada afecte unidades presentes o futuras.
    if scope_type == AccessGrant.SCOPE_GLOBAL:
        return None
    moment = at or timezone.now()
    representative = _rule_representative_unit(grantee_assignment, scope_type, target_unit)
    if representative is None:
        return None
    candidates = (
        GrantAuthority.objects.select_for_update(of=("self",))
        .filter(
            assignment=actor_assignment,
            is_active=True,
            revoked_at__isnull=True,
            valid_from__lte=moment,
            scoped_permissions__permission=permission,
            **{capability: True},
        )
        .filter(Q(valid_until__isnull=True) | Q(valid_until__gt=moment))
        .select_related(
            "target_unit",
            "parent_authority",
            "assignment__employee__user_account",
            "assignment__position__unit",
        )
        .prefetch_related("scoped_permissions")
    )
    for authority in candidates:
        if scope_type == AccessGrant.SCOPE_SUB_TREE and authority.scope_type not in {
            GrantAuthority.SCOPE_GLOBAL,
            GrantAuthority.SCOPE_SUB_TREE,
        }:
            continue
        if grant_authority_covers_target(
            authority,
            representative,
            permission,
            capability,
            moment,
        ):
            return authority
    return None


def _authority_chain_contains_employee(authority, employee_id, max_depth=20):
    """Evita que una cadena delegada devuelva poder a cualquiera de sus emisores."""

    current = authority
    seen = set()
    for _ in range(max_depth):
        if current is None:
            return False
        if current.id in seen:
            return True
        seen.add(current.id)
        if current.assignment.employee_id == employee_id:
            return True
        if (
            current.granted_by_assignment_id
            and current.granted_by_assignment.employee_id == employee_id
        ):
            return True
        current = current.parent_authority
    # Una cadena anormalmente profunda se trata como insegura.
    return current is not None


@transaction.atomic
def create_access_rule(
    request,
    *,
    grantee_assignment,
    permission,
    effect,
    scope_type,
    target_unit,
    valid_from,
    valid_until,
    reason,
    resource_type="",
    resource_id=None,
    expected_revision=None,
):
    reason = normalized_reason(reason)
    actor_assignment = get_request_assignment(request, for_update=True)
    require_recent_strong_mfa(request)
    state = _lock_state(expected_revision)
    grantee_assignment = (
        PositionAssignment.objects.select_for_update(of=("self",))
        .select_related("employee__user_account", "position__unit")
        .get(pk=grantee_assignment.pk)
    )
    if actor_assignment.employee_id == grantee_assignment.employee_id:
        raise PermissionDenied("No puedes modificar permisos de ninguna de tus propias asignaciones.")
    grantee_account = getattr(grantee_assignment.employee, "user_account", None)
    if grantee_account and grantee_account.is_superuser and not request.user.is_superuser:
        raise PermissionDenied("Una autoridad delegada no puede modificar los accesos del dueño.")
    if (
        not grantee_assignment.is_active
        or grantee_assignment.released_at is not None
        or not grantee_assignment.employee.is_active
        or grantee_account is None
        or not grantee_account.is_active
    ):
        raise ValidationError({"grantee_assignment": "La asignación destinataria no está activa."})
    if not permission.is_active or not permission.is_delegable:
        raise PermissionDenied("Este permiso no admite concesiones individuales.")
    _validate_scope(scope_type, target_unit)
    now = timezone.now()
    valid_from = valid_from or now
    if valid_from < now - timedelta(minutes=5):
        raise ValidationError({"valid_from": "La vigencia no puede comenzar en el pasado."})
    if effect == AccessGrant.EFFECT_ALLOW and valid_until is None:
        raise ValidationError({"valid_until": "Los accesos individuales deben tener vencimiento."})
    if valid_until is not None and valid_until <= valid_from:
        raise ValidationError({"valid_until": "El vencimiento debe ser posterior al inicio."})
    maximum_seconds = _maximum_grant_seconds(permission)
    if valid_until and (valid_until - valid_from).total_seconds() > maximum_seconds:
        raise ValidationError({"valid_until": f"La duración máxima para este riesgo es {maximum_seconds} segundos."})
    if resource_id:
        supplied_resource_type = resource_type.strip().lower()
        if supplied_resource_type and supplied_resource_type != permission.resource:
            raise ValidationError({"resource_type": "El tipo de recurso no corresponde al permiso."})
        resource_type = permission.resource
    elif resource_type:
        raise ValidationError({"resource_id": "Indica el recurso específico o elimina resource_type."})

    authority = None
    if not request.user.is_superuser:
        capability = (
            GRANT_CAPABILITY_REVOKE
            if effect == AccessGrant.EFFECT_DENY
            else GRANT_CAPABILITY_GRANT
        )
        authority = _find_access_rule_authority(
            actor_assignment,
            grantee_assignment,
            permission,
            scope_type=scope_type,
            target_unit=target_unit,
            capability=capability,
            at=now,
        )
        if authority is None:
            raise PermissionDenied("Tu autoridad no cubre el permiso, alcance completo, unidad o sensibilidad.")
        if _authority_chain_contains_employee(authority, grantee_assignment.employee_id):
            raise PermissionDenied("No puedes devolver acceso a un integrante de tu cadena de delegación.")
        if valid_until is None:
            raise ValidationError({"valid_until": "Una autoridad delegada siempre debe indicar vencimiento."})
        authority_limit = valid_from + timedelta(seconds=authority.max_grant_duration_seconds)
        if valid_until > authority_limit or (authority.valid_until and valid_until > authority.valid_until):
            raise PermissionDenied("La vigencia solicitada supera el límite de tu autoridad.")

    overlapping = AccessGrant.objects.select_for_update(of=("self",)).filter(
        grantee_assignment=grantee_assignment,
        permission=permission,
        effect=effect,
        scope_type=scope_type,
        target_unit=target_unit,
        resource_type=resource_type.strip().lower(),
        resource_id=str(resource_id) if resource_id else None,
        status=AccessGrant.STATUS_ACTIVE,
        revoked_at__isnull=True,
    ).filter(Q(valid_until__isnull=True) | Q(valid_until__gt=valid_from))
    if valid_until is not None:
        overlapping = overlapping.filter(valid_from__lt=valid_until)
    overlapping = overlapping.select_related("source_authority", "source_authority__parent_authority")
    if any(
        grant.source_authority_id is None
        or authority_is_effective(grant.source_authority, now)
        for grant in overlapping
    ):
        raise ValidationError({"detail": "Ya existe una regla activa equivalente con vigencia superpuesta."})

    grant = AccessGrant.objects.create(
        grantee_assignment=grantee_assignment,
        permission=permission,
        effect=effect,
        scope_type=scope_type,
        target_unit=target_unit,
        resource_type=resource_type.strip().lower(),
        resource_id=str(resource_id) if resource_id else None,
        granted_by_assignment=actor_assignment,
        valid_from=valid_from,
        valid_until=valid_until,
        reason=reason,
        source=AccessGrant.SOURCE_TEMPORARY if effect == AccessGrant.EFFECT_ALLOW else AccessGrant.SOURCE_OVERRIDE,
        source_authority=authority,
        created_by_account=request.user,
    )
    event = record_policy_change(
        request,
        actor_assignment,
        state,
        event_type="permissions.access_rule.created",
        target_type="access_grant",
        target_id=grant.id,
        permission=permission,
        target_unit=target_unit,
        reason=reason,
        after={
            "grantee_assignment": str(grantee_assignment.id),
            "effect": effect,
            "scope_type": scope_type,
            "valid_from": valid_from.isoformat(),
            "valid_until": valid_until.isoformat() if valid_until else None,
            "resource_type": grant.resource_type,
            "resource_id": grant.resource_id,
        },
    )
    return grant, event.revision


@transaction.atomic
def revoke_access_rule(request, *, grant, reason, expected_revision=None):
    reason = normalized_reason(reason)
    actor_assignment = get_request_assignment(request, for_update=True)
    require_recent_strong_mfa(request)
    state = _lock_state(expected_revision)
    grant = (
        AccessGrant.objects.select_for_update(of=("self",))
        .select_related(
            "permission",
            "target_unit",
            "grantee_assignment__employee__user_account",
            "grantee_assignment__position__unit",
        )
        .get(pk=grant.pk)
    )
    if actor_assignment.employee_id == grant.grantee_assignment.employee_id:
        raise PermissionDenied("No puedes revocar reglas de ninguna de tus propias asignaciones.")
    grantee_account = getattr(grant.grantee_assignment.employee, "user_account", None)
    if grantee_account and grantee_account.is_superuser and not request.user.is_superuser:
        raise PermissionDenied("Una autoridad delegada no puede modificar los accesos del dueño.")
    if not request.user.is_superuser:
        capability = (
            GRANT_CAPABILITY_GRANT
            if grant.effect == AccessGrant.EFFECT_DENY
            else GRANT_CAPABILITY_REVOKE
        )
        authority = _find_access_rule_authority(
            actor_assignment,
            grant.grantee_assignment,
            grant.permission,
            scope_type=grant.scope_type,
            target_unit=grant.target_unit,
            capability=capability,
        )
        if authority is None:
            raise PermissionDenied("Tu autoridad no cubre el alcance completo de esta revocación.")
    if grant.status == AccessGrant.STATUS_REVOKED or grant.revoked_at is not None:
        return grant, state.revision
    before = {"status": grant.status, "revoked_at": None}
    grant.status = AccessGrant.STATUS_REVOKED
    grant.revoked_at = timezone.now()
    grant.revoked_by_assignment = actor_assignment
    grant.revoked_by_account = request.user
    grant.revocation_reason = reason
    grant.save(
        update_fields=[
            "status", "revoked_at", "revoked_by_assignment", "revoked_by_account", "revocation_reason"
        ]
    )
    event = record_policy_change(
        request,
        actor_assignment,
        state,
        event_type="permissions.access_rule.revoked",
        target_type="access_grant",
        target_id=grant.id,
        permission=grant.permission,
        target_unit=grant.target_unit,
        reason=reason,
        before=before,
        after={"status": grant.status, "revoked_at": grant.revoked_at.isoformat()},
    )
    return grant, event.revision


def _authority_scope_contains(parent, actor_assignment, child_scope, child_unit):
    if child_scope == GrantAuthority.SCOPE_GLOBAL:
        return parent.scope_type == GrantAuthority.SCOPE_GLOBAL
    representative = child_unit
    if child_scope == GrantAuthority.SCOPE_OWN_UNIT:
        return False
    if representative is None:
        return False
    if parent.scope_type == GrantAuthority.SCOPE_GLOBAL:
        return True
    if parent.scope_type == GrantAuthority.SCOPE_OWN_UNIT:
        return representative.id == actor_assignment.position.unit_id and child_scope == GrantAuthority.SCOPE_SPECIFIC_UNIT
    if parent.scope_type == GrantAuthority.SCOPE_SPECIFIC_UNIT:
        return child_scope == GrantAuthority.SCOPE_SPECIFIC_UNIT and representative.id == parent.target_unit_id
    if parent.scope_type == GrantAuthority.SCOPE_SUB_TREE:
        return unit_is_within(representative, parent.target_unit)
    return False


def _find_parent_authority(
    actor_assignment,
    permissions,
    *,
    scope_type,
    target_unit,
    sensitivity,
    valid_until,
    can_grant_access,
    can_revoke_access,
    can_delegate_authority,
):
    now = timezone.now()
    authorities = (
        GrantAuthority.objects.select_for_update(of=("self",))
        .filter(
            assignment=actor_assignment,
            is_active=True,
            revoked_at__isnull=True,
            valid_from__lte=now,
            can_delegate_authority=True,
        )
        .filter(Q(valid_until__isnull=True) | Q(valid_until__gt=now))
        .prefetch_related("scoped_permissions")
        .select_related("target_unit", "parent_authority")
    )
    requested_ids = {permission.id for permission in permissions}
    for parent in authorities:
        if not authority_is_effective(parent, now):
            continue
        if parent.delegation_depth_remaining < 1:
            continue
        allowed_ids = set(parent.scoped_permissions.values_list("permission_id", flat=True))
        if not requested_ids.issubset(allowed_ids):
            continue
        if not _authority_scope_contains(parent, actor_assignment, scope_type, target_unit):
            continue
        if sensitivity_rank(sensitivity) > sensitivity_rank(parent.max_sensitivity_level):
            continue
        if can_grant_access and not parent.can_grant_access:
            continue
        if can_revoke_access and not parent.can_revoke_access:
            continue
        if can_delegate_authority and not parent.can_delegate_authority:
            continue
        if parent.valid_until and valid_until > parent.valid_until:
            continue
        if valid_until > now + timedelta(seconds=parent.max_grant_duration_seconds):
            continue
        return parent
    return None


@transaction.atomic
def create_grant_authority(
    request,
    *,
    grantee_assignment,
    permissions,
    scope_type,
    target_unit,
    max_sensitivity_level,
    valid_until,
    max_grant_duration_seconds,
    delegation_depth_remaining,
    can_grant_access,
    can_revoke_access,
    can_delegate_authority,
    reason,
    expected_revision=None,
):
    reason = normalized_reason(reason)
    actor_assignment = get_request_assignment(request, for_update=True)
    require_recent_strong_mfa(request)
    state = _lock_state(expected_revision)
    grantee_assignment = (
        PositionAssignment.objects.select_for_update(of=("self",))
        .select_related("employee__user_account", "position__unit")
        .get(pk=grantee_assignment.pk)
    )
    if actor_assignment.employee_id == grantee_assignment.employee_id:
        raise PermissionDenied("No puedes delegar autoridad a ninguna de tus propias asignaciones.")
    grantee_account = getattr(grantee_assignment.employee, "user_account", None)
    if (
        not grantee_assignment.is_active
        or grantee_assignment.released_at is not None
        or not grantee_assignment.employee.is_active
        or grantee_account is None
        or not grantee_account.is_active
    ):
        raise ValidationError({"assignment": "La asignación destinataria no está activa."})
    if grantee_account.is_superuser:
        raise PermissionDenied("La autoridad del dueño no se modifica mediante delegaciones ordinarias.")
    if not permissions:
        raise ValidationError({"permissions": "Selecciona al menos un permiso delegable."})
    if any(not item.is_active or not item.is_delegable for item in permissions):
        raise PermissionDenied("La selección contiene permisos inactivos o no delegables.")
    if not (can_grant_access or can_revoke_access or can_delegate_authority):
        raise ValidationError({"capabilities": "Selecciona al menos una capacidad para la autoridad."})
    if any(
        sensitivity_rank(item.risk_level) > sensitivity_rank(max_sensitivity_level)
        for item in permissions
    ):
        raise ValidationError({
            "max_sensitivity_level": "La sensibilidad máxima debe cubrir todos los permisos seleccionados."
        })
    _validate_scope(scope_type, target_unit)
    now = timezone.now()
    if valid_until <= now:
        raise ValidationError({"valid_until": "La autoridad debe vencer en el futuro."})
    maximum_authority_seconds = getattr(settings, "PERMISSIONS_AUTHORITY_MAX_SECONDS", 90 * 24 * 60 * 60)
    if (valid_until - now).total_seconds() > maximum_authority_seconds:
        raise ValidationError({"valid_until": "La autoridad excede la vigencia máxima permitida."})
    if max_grant_duration_seconds < 300:
        raise ValidationError({"max_grant_duration_seconds": "El límite mínimo es de cinco minutos."})

    parent = None
    if not request.user.is_superuser:
        if scope_type in {GrantAuthority.SCOPE_GLOBAL, GrantAuthority.SCOPE_OWN_UNIT}:
            raise PermissionDenied("Una autoridad delegada solo puede subdelegar unidades explícitas.")
        parent = _find_parent_authority(
            actor_assignment,
            permissions,
            scope_type=scope_type,
            target_unit=target_unit,
            sensitivity=max_sensitivity_level,
            valid_until=valid_until,
            can_grant_access=can_grant_access,
            can_revoke_access=can_revoke_access,
            can_delegate_authority=can_delegate_authority,
        )
        if parent is None:
            raise PermissionDenied("La autoridad hija no es un subconjunto válido de tu autoridad.")
        if _authority_chain_contains_employee(parent, grantee_assignment.employee_id):
            raise PermissionDenied("No puedes devolver autoridad a un integrante de tu cadena de delegación.")
        if delegation_depth_remaining >= parent.delegation_depth_remaining:
            raise PermissionDenied("La profundidad de delegación solicitada excede la disponible.")
        max_grant_duration_seconds = min(max_grant_duration_seconds, parent.max_grant_duration_seconds)

    authority = GrantAuthority.objects.create(
        assignment=grantee_assignment,
        scope_type=scope_type,
        target_unit=target_unit,
        max_sensitivity_level=max_sensitivity_level,
        can_grant_access=can_grant_access,
        can_revoke_access=can_revoke_access,
        can_delegate_authority=can_delegate_authority,
        granted_by_assignment=actor_assignment,
        parent_authority=parent,
        valid_from=now,
        valid_until=valid_until,
        max_grant_duration_seconds=max_grant_duration_seconds,
        delegation_depth_remaining=delegation_depth_remaining,
        reason=reason,
        created_by_account=request.user,
    )
    GrantAuthorityPermission.objects.bulk_create(
        [GrantAuthorityPermission(grant_authority=authority, permission=permission) for permission in permissions]
    )
    event = record_policy_change(
        request,
        actor_assignment,
        state,
        event_type="permissions.authority.created",
        target_type="grant_authority",
        target_id=authority.id,
        target_unit=target_unit,
        reason=reason,
        after={
            "assignment": str(grantee_assignment.id),
            "scope_type": scope_type,
            "permissions": [str(item.id) for item in permissions],
            "max_sensitivity_level": max_sensitivity_level,
            "valid_until": valid_until.isoformat(),
            "capabilities": {
                "grant": can_grant_access,
                "revoke": can_revoke_access,
                "delegate": can_delegate_authority,
            },
        },
    )
    return authority, event.revision


@transaction.atomic
def revoke_grant_authority(request, *, authority, reason, expected_revision=None):
    reason = normalized_reason(reason)
    actor_assignment = get_request_assignment(request, for_update=True)
    require_recent_strong_mfa(request)
    state = _lock_state(expected_revision)
    authority = (
        GrantAuthority.objects.select_for_update(of=("self",))
        .select_related(
            "assignment__employee__user_account",
            "assignment__position__unit",
            "target_unit",
        )
        .prefetch_related("scoped_permissions__permission")
        .get(pk=authority.pk)
    )
    if actor_assignment.employee_id == authority.assignment.employee_id:
        raise PermissionDenied("No puedes revocar autoridades de ninguna de tus propias asignaciones.")
    authority_account = getattr(authority.assignment.employee, "user_account", None)
    if authority_account and authority_account.is_superuser and not request.user.is_superuser:
        raise PermissionDenied("Una autoridad delegada no puede modificar la autoridad del dueño.")
    if not request.user.is_superuser:
        now = timezone.now()
        actor_authorities = GrantAuthority.objects.filter(
            assignment=actor_assignment,
            is_active=True,
            revoked_at__isnull=True,
            can_delegate_authority=True,
            valid_from__lte=now,
        ).filter(Q(valid_until__isnull=True) | Q(valid_until__gt=now))
        permitted = False
        for candidate in actor_authorities:
            if not authority_is_effective(candidate, now):
                continue
            current = authority.parent_authority
            seen = set()
            while current is not None and current.id not in seen:
                if current.id == candidate.id:
                    permitted = True
                    break
                seen.add(current.id)
                current = current.parent_authority
            if permitted:
                break
        if not permitted:
            raise PermissionDenied("Solo puedes revocar autoridades descendientes de una delegación propia vigente.")
    if not authority.is_active or authority.revoked_at is not None:
        return authority, state.revision
    authority.is_active = False
    authority.revoked_at = timezone.now()
    authority.revoked_by_account = request.user
    authority.revocation_reason = reason
    authority.save(update_fields=["is_active", "revoked_at", "revoked_by_account", "revocation_reason"])
    event = record_policy_change(
        request,
        actor_assignment,
        state,
        event_type="permissions.authority.revoked",
        target_type="grant_authority",
        target_id=authority.id,
        target_unit=authority.target_unit,
        reason=reason,
        before={"is_active": True, "revoked_at": None},
        after={"is_active": False, "revoked_at": authority.revoked_at.isoformat()},
    )
    return authority, event.revision


def control_plane_access(request, assignment=None):
    assignment = assignment or get_request_assignment(request)
    now = timezone.now()
    authority_candidates = GrantAuthority.objects.filter(
        assignment=assignment,
        is_active=True,
        revoked_at__isnull=True,
        valid_from__lte=now,
    ).filter(Q(valid_until__isnull=True) | Q(valid_until__gt=now)).prefetch_related(
        "scoped_permissions__permission"
    ).select_related(
        "assignment__employee__user_account",
        "assignment__position__unit",
        "parent_authority",
    )
    active_authorities = [
        authority
        for authority in authority_candidates
        if authority_is_effective(authority, now)
        and any(
            link.permission.is_active and link.permission.is_delegable
            for link in authority.scoped_permissions.all()
        )
    ]
    maximum_delegation_depth = max(
        (authority.delegation_depth_remaining for authority in active_authorities if authority.can_delegate_authority),
        default=0,
    )
    owner = bool(request.user.is_superuser)
    if owner:
        delegation_valid_until = now + timedelta(
            seconds=getattr(settings, "PERMISSIONS_AUTHORITY_MAX_SECONDS", 90 * 24 * 60 * 60)
        )
    else:
        delegation_horizons = [
            min(
                authority.valid_until,
                now + timedelta(seconds=authority.max_grant_duration_seconds),
            )
            for authority in active_authorities
            if authority.can_delegate_authority and authority.valid_until is not None
        ]
        delegation_valid_until = max(delegation_horizons, default=None)
    session = getattr(request, "auth", None)
    verified_at = getattr(session, "mfa_verified_at", None)
    mfa_recent = has_recent_strong_mfa(request)
    mfa_valid_until = None
    if mfa_recent:
        seconds = getattr(
            settings,
            "PERMISSIONS_STEP_UP_MFA_SECONDS",
            getattr(settings, "ADMIN_STEP_UP_MFA_SECONDS", 600),
        )
        mfa_valid_until = verified_at + timedelta(seconds=seconds)
    return {
        "is_owner": owner,
        "can_manage_role_policies": owner,
        "can_grant_access": owner or any(item.can_grant_access for item in active_authorities),
        "can_revoke_access": owner or any(item.can_revoke_access for item in active_authorities),
        "can_delegate_authority": owner or any(item.can_delegate_authority for item in active_authorities),
        "max_delegation_depth_remaining": 5 if owner else maximum_delegation_depth,
        "delegation_valid_until_ceiling": (
            delegation_valid_until.isoformat() if delegation_valid_until else None
        ),
        "can_read_audit": owner,
        "mfa_recent": mfa_recent,
        "mfa_valid_until": mfa_valid_until,
        "policy_revision": PermissionPolicyState.current_revision(),
    }
