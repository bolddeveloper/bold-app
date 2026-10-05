"""Owner-controlled module delegation, distinct from company ownership."""
from django.db.models import Q
from rest_framework.exceptions import PermissionDenied

from .models import JobRole, PositionAssignment


def can_operate_module(assignment, module):
    account = assignment.employee.user_account
    return bool(account.is_active and assignment.employee.is_active and assignment.is_active
                and assignment.released_at is None and assignment.position.unit.is_control_plane
                and (account.is_superuser or getattr(assignment.position.job_role, f"{module}_enabled", False)))


def protected_roles():
    return JobRole.objects.filter(
        Q(administration_enabled=True) | Q(permissions_enabled=True)
        | Q(positions__assignments__employee__user_account__is_superuser=True)
    ).distinct()


def assert_role_manageable(request, role):
    if request.user.is_superuser:
        return
    own = PositionAssignment.objects.filter(employee_id=request.user.employee_id, position__job_role=role).exists()
    if own or protected_roles().filter(pk=role.pk).exists():
        raise PermissionDenied("Solo el propietario puede modificar su cargo, cargos administrativos o tus propios cargos.")


def assert_employee_manageable(request, employee):
    if request.user.is_superuser:
        return
    account = getattr(employee, "user_account", None)
    privileged = employee.position_assignments.filter(
        is_active=True, released_at__isnull=True, position__job_role__in=protected_roles(),
    ).exists()
    if employee.pk == request.user.employee_id or (account and account.is_superuser) or privileged:
        raise PermissionDenied("Solo el propietario puede gestionar esta cuenta protegida o tus propias asignaciones.")


def assert_position_manageable(request, position):
    assert_role_manageable(request, position.job_role)
    if not request.user.is_superuser:
        for assignment in position.assignments.filter(is_active=True, released_at__isnull=True).select_related("employee__user_account"):
            assert_employee_manageable(request, assignment.employee)
