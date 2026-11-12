from dataclasses import dataclass
from django.conf import settings
from django.utils import timezone
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed, PermissionDenied
from boldApp.autenticacion.models import AuthSession
from boldApp.core.authorization import check_and_log


def pilot_enabled(assignment):
    return bool(settings.BOLD_ASSISTANT_ENABLED and assignment and assignment.is_active
                and not assignment.released_at and assignment.employee.is_active
                and str(assignment.position.unit_id).lower() in settings.BOLD_ASSISTANT_PILOT_UNIT_IDS)


def validate_session(session, assignment):
    now = timezone.now()
    if not isinstance(session, AuthSession):
        raise AuthenticationFailed('Se requiere una sesión interactiva vigente de BOLD.')
    session.refresh_from_db()
    account = session.user_account
    assignment.refresh_from_db()
    if (session.revoked_at or session.expires_at <= now or session.credentials_version != account.credentials_version
            or session.idle_expires_at and session.idle_expires_at <= now
            or not account.is_active or account.must_change_password or account.employee_id != assignment.employee_id
            or not pilot_enabled(assignment)):
        raise AuthenticationFailed('La sesión o el acceso al asistente ya no están disponibles.')
    if settings.AUTH_MFA_REQUIRED and (not session.mfa_verified_at or not account.mfa_methods.filter(is_active=True).exists()):
        raise PermissionDenied('Se requiere MFA vigente.')
    return account


def require(request, code='assistant.request.use'):
    validate_session(request.auth, request.assignment)
    result = check_and_log(assignment=request.assignment, permission_code=code,
                          target_unit=request.assignment.position.unit, request=request)
    if not result.allowed:
        raise PermissionDenied(result.reason)


@dataclass(frozen=True)
class ExecutionIdentity:
    session: object
    assignment: object


class AssistantInternalAuthentication(BaseAuthentication):
    def authenticate(self, request):
        identity = getattr(request._request, '_bold_assistant_identity', None)
        if not isinstance(identity, ExecutionIdentity):
            return None
        return validate_session(identity.session, identity.assignment), identity.session
