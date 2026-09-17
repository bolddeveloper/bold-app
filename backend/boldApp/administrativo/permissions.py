from datetime import timedelta

from django.conf import settings
from django.utils import timezone
from rest_framework.permissions import BasePermission


class IsCompanyOwner(BasePermission):
    message = "Esta operación está reservada al dueño de la empresa."

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.is_active and request.user.is_superuser)


class HasRecentOwnerMFA(IsCompanyOwner):
    message = "Esta operación requiere una verificación MFA reciente del dueño."

    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False
        verified_at = getattr(getattr(request, "auth", None), "mfa_verified_at", None)
        max_age = timedelta(seconds=getattr(settings, "ADMIN_STEP_UP_MFA_SECONDS", 600))
        return bool(verified_at and verified_at >= timezone.now() - max_age)

