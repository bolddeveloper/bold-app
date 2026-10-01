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

    def test_authorized_manager_can_change_status_without_editing_content(self):
        manage_permission = Permission.objects.get(code="suggestions.feedback.manage")
        JobRolePermission.objects.create(
            job_role=self.role, permission=manage_permission,
            effect="allow", scope_type="own_unit",
        )
        suggestion = Suggestion.objects.create(
            author_assignment=self.assignment, unit=self.unit,
            category="bug", message="Detalle valido para revisar",
        )
        response = self.client.patch(
            f"/api/v2/suggestions/{suggestion.id}/", {"status": "reviewing"}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["status"], "reviewing")
        self.assertTrue(SuggestionEvent.objects.filter(suggestion=suggestion, event_type="suggestion.reviewed").exists())

    def test_author_can_edit_and_soft_delete_own_suggestion(self):
        suggestion = Suggestion.objects.create(
            author_assignment=self.assignment, unit=self.unit,
            category="idea", message="Contenido original suficientemente largo",
            source_module="tasks",
        )
        edited = self.client.patch(
            f"/api/v2/suggestions/{suggestion.id}/",
            {"category": "visual", "message": "Contenido corregido de la sugerencia"},
            format="json",
        )
        self.assertEqual(edited.status_code, 200, edited.data)
        self.assertEqual(edited.data["category"], "visual")
        self.assertTrue(SuggestionEvent.objects.filter(suggestion=suggestion, event_type="suggestion.updated").exists())

        deleted = self.client.delete(f"/api/v2/suggestions/{suggestion.id}/")
        self.assertEqual(deleted.status_code, 204)
        suggestion.refresh_from_db()
        self.assertIsNotNone(suggestion.deleted_at)
        self.assertEqual(self.client.get("/api/v2/suggestions/").data["count"], 0)
        self.assertTrue(SuggestionEvent.objects.filter(suggestion=suggestion, event_type="suggestion.deleted").exists())

    def test_another_employee_cannot_edit_or_delete_suggestion(self):
        read_permission = Permission.objects.get(code="suggestions.feedback.read")
        JobRolePermission.objects.create(
            job_role=self.role, permission=read_permission,
            effect="allow", scope_type="own_unit",
        )
        suggestion = Suggestion.objects.create(
            author_assignment=self.assignment, unit=self.unit,
            category="bug", message="Detalle visible para el mismo departamento",
        )
        other_employee = Employee.objects.create(full_name="Otra Persona")
        other_account = UserAccount.objects.create_user(
            email="otra@bold.gt", password="A-secure-pass-2026!", employee=other_employee,
        )
        other_position = Position.objects.create(unit=self.unit, job_role=self.role)
        other_assignment = PositionAssignment.objects.create(position=other_position, employee=other_employee)
        self.client.force_authenticate(other_account)
        self.client.credentials(HTTP_X_ASSIGNMENT_ID=str(other_assignment.id))

        edited = self.client.patch(
            f"/api/v2/suggestions/{suggestion.id}/",
            {"message": "Intento de cambio por otra persona"}, format="json",
        )
        deleted = self.client.delete(f"/api/v2/suggestions/{suggestion.id}/")
        self.assertEqual(edited.status_code, 403)
        self.assertEqual(deleted.status_code, 403)
        suggestion.refresh_from_db()
        self.assertIsNone(suggestion.deleted_at)
