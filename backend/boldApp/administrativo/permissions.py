from datetime import timedelta

from django.conf import settings
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import BasePermission, SAFE_METHODS

from boldApp.core.access_context import require_control_plane_assignment
from boldApp.core.control_plane_roles import can_operate_module, assert_employee_manageable, assert_role_manageable, assert_position_manageable


class IsCompanyOwner(BasePermission):
    message = "Esta operación está reservada al dueño de la empresa."

    def has_permission(self, request, view):
        if not bool(request.user and request.user.is_authenticated and request.user.is_active and request.user.is_superuser):
            return False
        try:
            request.assignment = require_control_plane_assignment(request)
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


class IsAdministrationOperator(BasePermission):
    message = "Tu cargo no está autorizado para administrar la aplicación."

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated or not request.user.is_active:
            return False
        try:
            request.assignment = require_control_plane_assignment(request)
        except PermissionDenied:
            return False
        if not can_operate_module(request.assignment, "administration"):
            return False
        if request.method not in SAFE_METHODS and not request.user.is_superuser:
            if not HasRecentOperatorMFA.recent(request):
                self.message = "Confirma nuevamente tu MFA para realizar esta operación administrativa."
                return False
        return True

    def has_object_permission(self, request, view, obj):
        if request.method in SAFE_METHODS or request.user.is_superuser:
            return True
        from boldApp.core.models import Employee, JobRole, Position, OrganizationalUnit
        from boldApp.autenticacion.models import AuthSession
        if isinstance(obj, Employee):
            assert_employee_manageable(request, obj)
        elif isinstance(obj, AuthSession):
            assert_employee_manageable(request, obj.user_account.employee)
        elif isinstance(obj, JobRole):
            assert_role_manageable(request, obj)
        elif isinstance(obj, Position):
            assert_position_manageable(request, obj)
        elif isinstance(obj, OrganizationalUnit) and obj.is_control_plane:
            raise PermissionDenied("Solo el propietario puede modificar la unidad de Dirección.")
        return True


class HasRecentOperatorMFA(IsAdministrationOperator):
    message = "Esta operación requiere una verificación MFA reciente."

    @staticmethod
    def recent(request):
        session = getattr(request, "auth", None)
        verified = getattr(session, "mfa_verified_at", None)
        return bool(verified and getattr(session, "auth_strength", "") in {"password_totp", "webauthn"}
                    and verified >= timezone.now() - timedelta(seconds=settings.ADMIN_STEP_UP_MFA_SECONDS))

    def has_permission(self, request, view):
        return super().has_permission(request, view) and self.recent(request)

