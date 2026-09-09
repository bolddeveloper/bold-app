from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import BasePermission

from boldApp.core.models import PositionAssignment


ASSIGNMENT_HEADER = "X-Assignment-ID"


class HasActiveAssignment(BasePermission):
    message = "Se requiere una asignacion activa propia en X-Assignment-ID."

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False

        assignment_id = request.headers.get(ASSIGNMENT_HEADER)
        if not assignment_id:
            return False

        try:
            request.assignment = PositionAssignment.objects.select_related(
                "employee",
                "position__unit",
                "position__job_role",
            ).get(
                id=assignment_id,
                employee_id=request.user.employee_id,
                is_active=True,
                released_at__isnull=True,
            )
        except (PositionAssignment.DoesNotExist, ValueError):
            raise PermissionDenied(self.message)
        return True
