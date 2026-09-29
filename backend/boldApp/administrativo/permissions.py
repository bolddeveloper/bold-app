from datetime import timedelta

from django.conf import settings
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import BasePermission

from boldApp.core.access_context import require_control_plane_assignment


class IsCompanyOwner(BasePermission):
    message = "Esta operación está reservada al dueño de la empresa."

    def has_permission(self, request, view):
        if not bool(request.user and request.user.is_authenticated and request.user.is_active and request.user.is_superuser):
            return False
        try:
            require_control_plane_assignment(request)
        except PermissionDenied:
            return False
        return True


class HasRecentOwnerMFA(IsCompanyOwner):
    message = "Esta operación requiere una verificación MFA reciente del dueño."

    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False
        session = getattr(request, "auth", None)
        verified_at = getattr(session, "mfa_verified_at", None)
        max_age = timedelta(seconds=getattr(settings, "ADMIN_STEP_UP_MFA_SECONDS", 600))
        return bool(
            verified_at
            and getattr(session, "auth_strength", "") in {"password_totp", "webauthn"}
            and verified_at >= timezone.now() - max_age
        )

