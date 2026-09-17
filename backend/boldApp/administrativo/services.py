import uuid

from django.db import transaction
from django.utils import timezone

from boldApp.autenticacion.services import request_ip

from .models import AdministrativeAction, SystemAuditEvent


SENSITIVE_KEYS = {"password", "password_hash", "secret", "secret_encrypted", "token", "token_hash", "code", "recovery_codes"}


def sanitize_audit_data(value):
    if isinstance(value, dict):
        return {key: "[REDACTED]" if key.lower() in SENSITIVE_KEYS else sanitize_audit_data(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [sanitize_audit_data(item) for item in value]
    return value


def create_administrative_action(request, action_type, reason, target_employee=None, target_account=None, metadata=None):
    return AdministrativeAction.objects.create(
        actor_account=request.user,
        target_employee=target_employee,
        target_account=target_account,
        action_type=action_type,
        reason=reason.strip(),
        metadata=sanitize_audit_data(metadata or {}),
    )


def record_system_event(event_type, request=None, *, module_code="administration", actor=None, action=None, unit=None, target_type="", target_id=None, outcome=SystemAuditEvent.OUTCOME_SUCCESS, changes=None, metadata=None, correlation_id=None):
    return SystemAuditEvent.objects.create(
        actor_account=actor or (request.user if request and request.user.is_authenticated else None),
        administrative_action=action,
        organizational_unit=unit,
        module_code=module_code,
        event_type=event_type,
        target_type=target_type,
        target_id=target_id,
        outcome=outcome,
        changes=sanitize_audit_data(changes or {}),
        metadata=sanitize_audit_data(metadata or {}),
        ip_address=request_ip(request) if request else None,
        user_agent=(request.META.get("HTTP_USER_AGENT", "")[:1000] if request else ""),
        correlation_id=correlation_id or (action.correlation_id if action else uuid.uuid4()),
    )


def complete_administrative_action(action, request, *, event_type=None, changes=None, metadata=None):
    action.status = AdministrativeAction.STATUS_COMPLETED
    action.completed_at = timezone.now()
    action.save(update_fields=["status", "completed_at"])
    return record_system_event(
        event_type or f"administration.{action.action_type}", request, action=action,
        target_type="employee" if action.target_employee_id else "user_account",
        target_id=action.target_employee_id or action.target_account_id,
        changes=changes, metadata=metadata,
    )


@transaction.atomic
def fail_administrative_action(action, request, error_code, metadata=None):
    action.status = AdministrativeAction.STATUS_FAILED
    action.completed_at = timezone.now()
    action.error_code = error_code
    action.save(update_fields=["status", "completed_at", "error_code"])
    return record_system_event(
        f"administration.{action.action_type}.failed", request, action=action,
        target_type="employee" if action.target_employee_id else "user_account",
        target_id=action.target_employee_id or action.target_account_id,
        outcome=SystemAuditEvent.OUTCOME_FAILURE, metadata=metadata,
    )
