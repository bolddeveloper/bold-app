from rest_framework.exceptions import PermissionDenied

from .models import PositionAssignment


ASSIGNMENT_HEADER = "X-Assignment-ID"


def get_request_assignment(request, *, for_update=False):
    """Resolve one active assignment owned by the authenticated account."""
    assignment_id = request.headers.get(ASSIGNMENT_HEADER)
    if not assignment_id:
        raise PermissionDenied("Selecciona una asignación activa en X-Assignment-ID.")
    queryset = PositionAssignment.objects.select_related(
        "employee__user_account", "position__unit", "position__job_role"
    )
    if for_update:
        queryset = queryset.select_for_update(of=("self",))
    try:
        assignment = queryset.get(
            id=assignment_id,
            employee_id=request.user.employee_id,
            employee__is_active=True,
            is_active=True,
            released_at__isnull=True,
        )
    except (PositionAssignment.DoesNotExist, ValueError) as error:
        raise PermissionDenied(
            "La asignación seleccionada no está activa o no pertenece a tu cuenta."
        ) from error
    if not request.user.is_active:
        raise PermissionDenied("La cuenta no está activa.")
    return assignment


def require_control_plane_assignment(request, *, for_update=False):
    assignment = get_request_assignment(request, for_update=for_update)
    if not assignment.position.unit.is_control_plane:
        raise PermissionDenied(
            "Este módulo está reservado a miembros de la unidad de Dirección."
        )
    return assignment
