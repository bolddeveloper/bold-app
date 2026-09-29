from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import SAFE_METHODS, BasePermission

from .access_context import require_control_plane_assignment


class IsControlPlaneMember(BasePermission):
    """Limit a control-plane endpoint to the active Dirección assignment."""

    message = "Este módulo está reservado a miembros de la unidad de Dirección."

    def has_permission(self, request, view):
        if not bool(request.user and request.user.is_authenticated and request.user.is_active):
            return False
        try:
            require_control_plane_assignment(request)
        except PermissionDenied:
            return False
        return True


class IsOwnerOrReadOnly(BasePermission):
    """``is_staff`` solo habilita Django Admin, no autoridad empresarial."""

    def has_permission(self, request, view):
        return request.method in SAFE_METHODS or bool(
            request.user
            and request.user.is_authenticated
            and request.user.is_active
            and request.user.is_superuser
        )


# Alias de compatibilidad para imports antiguos.
IsAdminOrReadOnly = IsOwnerOrReadOnly
