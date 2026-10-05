"""Minimal, assignment-scoped security state. Never exposes audit/grant payloads."""
import hashlib
import json
from datetime import timedelta

from django.conf import settings
from django.db.models import F, Q
from django.utils import timezone

from boldApp.autenticacion.models import AuthSession
from boldApp.core.models import (AccessGrant, GrantAuthority, GrantAuthorityPermission,
                                 JobRolePermission, OrganizationalUnit, Permission, PositionAssignment)
from boldApp.permisos.models import PermissionPolicyState


def security_snapshot(session_id, assignment_id):
    now = timezone.now()
    session = AuthSession.objects.filter(
        id=session_id, user_account__is_active=True, user_account__employee__is_active=True,
        revoked_at__isnull=True, expires_at__gt=now,
        credentials_version=F("user_account__credentials_version"),
    ).filter(Q(idle_expires_at__isnull=True) | Q(idle_expires_at__gt=now)).select_related("user_account__employee").first()
    if not session:
        return {"close_code": 4401}
    assignment = PositionAssignment.objects.filter(
        id=assignment_id, employee_id=session.user_account.employee_id,
        employee__is_active=True, is_active=True, released_at__isnull=True,
    ).values("position_id", "position__unit_id", "position__job_role_id", "position__job_role__title",
             "position__job_role__administration_enabled", "position__job_role__permissions_enabled").first()
    if not assignment:
        return {"close_code": 4403}

    boundaries = [session.expires_at]
    if session.idle_expires_at:
        boundaries.append(session.idle_expires_at)
    state = [assignment, session.auth_strength, session.user_account.is_superuser]
    # Signals can invalidate without incrementing the policy revision (e.g. Django
    # Admin). A dropped signal must still be detected by heartbeat/HTTP recovery.
    state.append(list(JobRolePermission.objects.filter(job_role_id=assignment["position__job_role_id"])
                      .values("id", "permission_id", "effect", "scope_type", "target_unit_id").order_by("id")))
    units = list(OrganizationalUnit.objects.values("id", "parent_unit_id", "sensitivity_level", "is_control_plane", "name", "color_hex", "unit_type").order_by("id"))
    state.append(units)
    state.append(list(Permission.objects.values("id", "code", "module_code", "is_active", "risk_level", "requires_step_up_mfa",
                                               "is_delegable").order_by("id")))
    context = hashlib.sha256(json.dumps([assignment, session.user_account.is_superuser,
        session.user_account.employee.full_name, units], sort_keys=True, default=str).encode()).hexdigest()
    state.append(context)
    # Both modules may have different MFA freshness windows. Include each boundary.
    for window in sorted({settings.PERMISSIONS_STEP_UP_MFA_SECONDS, settings.ADMIN_STEP_UP_MFA_SECONDS}):
        expiry = session.mfa_verified_at + timedelta(seconds=window) if session.mfa_verified_at else None
        state.append((window, bool(expiry and now < expiry)))
        if expiry and expiry > now:
            boundaries.append(expiry)

    def temporal_state(row, enabled):
        start, end = row["valid_from"], row["valid_until"]
        if enabled:
            boundaries.extend(value for value in (start, end) if value and value > now)
        return bool(enabled and start <= now and (end is None or now < end))

    grants = list(AccessGrant.objects.filter(
        grantee_assignment_id=assignment_id, status=AccessGrant.STATUS_ACTIVE, revoked_at__isnull=True,
    ).values("id", "valid_from", "valid_until", "source_authority_id", "permission_id", "effect",
             "scope_type", "target_unit_id", "resource_type", "resource_id").order_by("id"))
    state.extend((row, temporal_state(row, True)) for row in grants)
    authority_fields = ("id", "parent_authority_id", "valid_from", "valid_until", "is_active", "revoked_at",
                        "scope_type", "target_unit_id", "can_grant_access", "can_revoke_access", "can_delegate_authority",
                        "max_sensitivity_level", "max_grant_duration_seconds", "delegation_depth_remaining",
                        "assignment__is_active", "assignment__released_at", "assignment__employee__is_active",
                        "assignment__employee__user_account__is_active", "assignment__position__unit_id")
    authorities = list(GrantAuthority.objects.filter(assignment_id=assignment_id).values(
        *authority_fields,
    ).order_by("id"))
    # Traverse only authorities used by this assignment, including their ancestors.
    # The schema limits delegation depth to 5; a cap also guards corrupt cycles.
    seen = {row["id"] for row in authorities}
    pending = {row["source_authority_id"] for row in grants if row["source_authority_id"]}
    pending.update(row["parent_authority_id"] for row in authorities if row["parent_authority_id"])
    for _ in range(100):
        pending -= seen
        if not pending:
            break
        rows = list(GrantAuthority.objects.filter(id__in=pending).values(
            *authority_fields,
        ))
        seen.update(pending)
        authorities.extend(rows)
        pending = {row["parent_authority_id"] for row in rows if row["parent_authority_id"]}
    state.extend((row, temporal_state(row, row["is_active"] and row["revoked_at"] is None))
                 for row in sorted(authorities, key=lambda row: str(row["id"])))
    if authorities:
        state.append(list(GrantAuthorityPermission.objects.filter(grant_authority_id__in=seen)
                          .values("grant_authority_id", "permission_id").order_by("grant_authority_id", "permission_id")))
    revision = str(PermissionPolicyState.current_revision())
    # Opaque fingerprint: no authority, employee, or permission metadata on the wire.
    fingerprint = hashlib.sha256(json.dumps(state, sort_keys=True, default=str).encode()).hexdigest()
    finished_at = timezone.now()
    if session.expires_at <= finished_at or (session.idle_expires_at and session.idle_expires_at <= finished_at):
        return {"close_code": 4401}
    boundary_ms = max(0, (min(boundaries) - finished_at).total_seconds() * 1000)
    return {"revision": revision, "state": fingerprint, "context": context, "boundary_ms": boundary_ms}
