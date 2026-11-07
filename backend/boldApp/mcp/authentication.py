from django.conf import settings
from django.utils import timezone
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed

from .models import McpAuthorization


def validate_authorization(authorization):
    session = authorization.session
    now = timezone.now()
    if not session or authorization.revoked_at:
        raise AuthenticationFailed("La conexión MCP está revocada.")
    user = session.user_account
    source = authorization.source_session
    if source:
        natural_expiry = source.revocation_reason == "expired" and (
            source.expires_at <= now or (source.idle_expires_at and source.idle_expires_at <= now)
        )
        if ((source.revoked_at and not natural_expiry) or source.user_account_id != user.pk
                or source.credentials_version != user.credentials_version):
            raise AuthenticationFailed("La sesión que autorizó esta conexión fue revocada.")
    if (
        session.revoked_at or session.expires_at <= now
        or (session.idle_expires_at and session.idle_expires_at <= now)
        or session.credentials_version != user.credentials_version
        or not user.is_active or user.must_change_password
    ):
        raise AuthenticationFailed("Vuelve a autorizar BOLD con una sesión vigente.")
    if settings.AUTH_MFA_REQUIRED and (
        not session.mfa_verified_at or not user.mfa_methods.filter(is_active=True).exists()
    ):
        raise AuthenticationFailed("La conexión requiere una sesión verificada con MFA.")
    assignment = authorization.assignment
    if (
        not assignment or assignment.employee_id != user.employee_id
        or not assignment.employee.is_active or not assignment.is_active or assignment.released_at
    ):
        raise AuthenticationFailed("La asignación de esta conexión ya no está activa.")
    return user, session


class McpInternalAuthentication(BaseAuthentication):
    def authenticate(self, request):
        # Only the in-process MCP dispatcher can set this attribute.
        authorization = getattr(request._request, "_bold_mcp_authorization", None)
        if not isinstance(authorization, McpAuthorization):
            return None
        return validate_authorization(authorization)

    def authenticate_header(self, request):
        return "Bearer"
