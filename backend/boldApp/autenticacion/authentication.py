from django.conf import settings
from django.middleware.csrf import CsrfViewMiddleware
from django.utils import timezone
from rest_framework import exceptions
from rest_framework.authentication import BaseAuthentication

from .models import AuthSession
from .services import token_hash


class _CSRFCheck(CsrfViewMiddleware):
    def _reject(self, request, reason):
        return reason


class CookieSessionAuthentication(BaseAuthentication):
    def authenticate(self, request):
        raw = request.COOKIES.get(settings.AUTH_SESSION_COOKIE_NAME)
        if not raw:
            return None
        now = timezone.now()
        session = AuthSession.objects.select_related("user_account").filter(token_hash=token_hash(raw), revoked_at__isnull=True).first()
        if not session:
            raise exceptions.AuthenticationFailed("Sesión inválida.")
        user = session.user_account
        if not user.is_active or session.credentials_version != user.credentials_version or session.expires_at <= now or (session.idle_expires_at and session.idle_expires_at <= now):
            if session.revoked_at is None:
                session.revoked_at = now
                session.revocation_reason = "expired_or_credentials_changed"
                session.save(update_fields=["revoked_at", "revocation_reason"])
            raise exceptions.AuthenticationFailed("La sesión expiró.")
        path = request.path.rstrip("/") + "/"
        if user.must_change_password and path not in {"/api/v2/auth/session/", "/api/v2/auth/logout/", "/api/v2/auth/password/change/"}:
            raise exceptions.PermissionDenied("Debes cambiar la contraseña antes de continuar.")
        enrollment_paths = {
            "/api/v2/auth/session/",
            "/api/v2/auth/logout/",
            "/api/v2/auth/password/change/",
            "/api/v2/auth/mfa/totp/setup/",
            "/api/v2/auth/mfa/totp/confirm/",
        }
        if settings.AUTH_MFA_REQUIRED and not user.mfa_methods.filter(is_active=True).exists() and path not in enrollment_paths:
            raise exceptions.PermissionDenied("Debes configurar MFA antes de continuar.")
        check = _CSRFCheck(lambda req: None)
        check.process_request(request)
        reason = check.process_view(request, None, (), {})
        if reason:
            raise exceptions.PermissionDenied(f"CSRF: {reason}")
        session.last_used_at = now
        session.last_ip = request.META.get("REMOTE_ADDR") or None
        if settings.AUTH_SESSION_IDLE_SECONDS:
            session.idle_expires_at = min(session.expires_at, now + __import__("datetime").timedelta(seconds=settings.AUTH_SESSION_IDLE_SECONDS))
        session.save(update_fields=["last_used_at", "last_ip", "idle_expires_at"])
        return user, session

    def authenticate_header(self, request):
        return "Session"
