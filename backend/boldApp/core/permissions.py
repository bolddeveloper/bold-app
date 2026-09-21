from rest_framework.permissions import SAFE_METHODS, BasePermission


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
