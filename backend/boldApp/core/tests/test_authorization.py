from django.test import TestCase

from boldApp.core.authorization import resolve_access
from boldApp.core.models import (
    Employee,
    JobRole,
    JobRolePermission,
    OrganizationalUnit,
    Permission,
    Position,
    PositionAssignment,
    UserAccount,
)


class AssignmentIsolationTests(TestCase):
    def test_permissions_from_two_assignments_are_not_mixed(self):
        unit = OrganizationalUnit.objects.create(
            name="Unidad",
            unit_type="team",
            sensitivity_level="medium",
        )
        employee = Employee.objects.create(full_name="Persona con dos plazas")
        UserAccount.objects.create_user("dos.plazas@bold.gt", employee, "UnaClaveSegura2026!")
        denied_role = JobRole.objects.create(title="Sin permiso")
        allowed_role = JobRole.objects.create(title="Con permiso")
        denied_assignment = PositionAssignment.objects.create(
            employee=employee,
            position=Position.objects.create(unit=unit, job_role=denied_role, display_order=1),
        )
        allowed_assignment = PositionAssignment.objects.create(
            employee=employee,
            position=Position.objects.create(unit=unit, job_role=allowed_role, display_order=2),
        )
        permission = Permission.objects.get(code="tasks.task.read")
        JobRolePermission.objects.create(
            job_role=allowed_role,
            permission=permission,
            scope_type=JobRolePermission.SCOPE_OWN_UNIT,
            effect=JobRolePermission.EFFECT_ALLOW,
        )

        self.assertFalse(resolve_access(denied_assignment, permission, unit).allowed)
        self.assertTrue(resolve_access(allowed_assignment, permission, unit).allowed)
