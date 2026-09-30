from rest_framework.test import APITestCase

from boldApp.core.models import Employee, JobRole, JobRolePermission, OrganizationalUnit, Permission, Position, PositionAssignment, UserAccount
from boldApp.sugerencias.models import Suggestion, SuggestionEvent


class SuggestionApiTests(APITestCase):
    def setUp(self):
        self.unit = OrganizationalUnit.objects.create(name="Operaciones", unit_type="department", sensitivity_level="medium")
        self.role = JobRole.objects.create(title="Colaborador", level="member")
        self.position = Position.objects.create(unit=self.unit, job_role=self.role)
        self.employee = Employee.objects.create(full_name="Persona Demo")
        self.account = UserAccount.objects.create_user(email="persona@bold.gt", password="A-secure-pass-2026!", employee=self.employee)
        self.assignment = PositionAssignment.objects.create(position=self.position, employee=self.employee)
        self.permission = Permission.objects.get(code="suggestions.feedback.create")
        JobRolePermission.objects.get_or_create(job_role=self.role, permission=self.permission, effect="allow", scope_type="own_unit")
        self.client.force_authenticate(self.account)
        self.client.credentials(HTTP_X_ASSIGNMENT_ID=str(self.assignment.id))

    def test_employee_can_create_and_list_own_suggestion(self):
        response = self.client.post("/api/v2/suggestions/", {"category": "idea", "message": "Una mejora suficientemente detallada", "source_module": "tasks"}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(self.client.get("/api/v2/suggestions/").data["count"], 1)
        self.assertTrue(SuggestionEvent.objects.filter(event_type="suggestion.created").exists())

    def test_employee_cannot_manage_without_permission(self):
        suggestion = Suggestion.objects.create(author_assignment=self.assignment, unit=self.unit, category="bug", message="Detalle valido del problema")
        response = self.client.patch(f"/api/v2/suggestions/{suggestion.id}/", {"status": "resolved"}, format="json")
        self.assertEqual(response.status_code, 403)
