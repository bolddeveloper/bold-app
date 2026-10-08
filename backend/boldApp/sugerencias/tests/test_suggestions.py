import base64
import uuid
from datetime import timedelta

from django.utils import timezone
from rest_framework.test import APITestCase

from boldApp.core.models import Employee, JobRole, JobRolePermission, OrganizationalUnit, Permission, Position, PositionAssignment, UserAccount
from boldApp.sugerencias.models import Suggestion, SuggestionEvent


class SuggestionApiTests(APITestCase):
    def test_rich_description_preserves_format_and_rejects_short_visible_text(self):
        valid = "<!--bold-rich-text--><p>Descripción <b>completa del problema</b></p>"
        response = self.client.post("/api/v2/suggestions/", {"category": "bug", "message": valid}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["message"], valid)
        response = self.client.post("/api/v2/suggestions/", {"category": "bug", "message": "<!--bold-rich-text--><p><b>Hola</b></p>"}, format="json")
        self.assertEqual(response.status_code, 400, response.data)

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

    def test_report_fields_private_capture_and_author_attachment_edits(self):
        webp = base64.b64decode("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA")
        image = {"name": "Calendario.webp", "data_url": "data:image/webp;base64," + base64.b64encode(webp).decode()}
        payload = {"title": "No guarda el calendario", "message": "Paso 1: editar.\nPaso 2: guardar.", "category": "bug", "priority": "high", "environment": "Chrome / Windows", "screenshots": [image]}
        created = self.client.post("/api/v2/suggestions/", payload, format="json")
        self.assertEqual(created.status_code, 201, created.data)
        self.assertEqual(created.data["message"], payload["message"])
        self.assertEqual(created.data["title"], payload["title"])
        self.assertEqual(created.data["priority"], "high")
        self.assertFalse(created.data["can_manage"])
        self.assertNotIn("internal_note", created.data)
        self.assertNotIn("data_url", created.data["screenshots"][0])
        report_id = created.data["id"]
        image_id = created.data["screenshots"][0]["id"]
        endpoint = f"/api/v2/suggestions/{report_id}/screenshots/?image={image_id}"
        fetched = self.client.get(endpoint)
        self.assertEqual(fetched.status_code, 200)
        self.assertEqual(fetched.content, webp)
        self.assertEqual(fetched["Cache-Control"], "private, no-store")
        retained = self.client.patch(f"/api/v2/suggestions/{report_id}/", {"screenshots": [{"id": image_id}]}, format="json")
        self.assertEqual(retained.status_code, 200, retained.data)
        audit = SuggestionEvent.objects.get(suggestion_id=report_id, event_type="suggestion.updated")
        self.assertNotIn("data_url", str(audit.changes))
        forged = self.client.patch(f"/api/v2/suggestions/{report_id}/", {"screenshots": [{"id": str(uuid.uuid4())}]}, format="json")
        self.assertEqual(forged.status_code, 400)
        removed = self.client.patch(f"/api/v2/suggestions/{report_id}/", {"screenshots": []}, format="json")
        self.assertEqual(removed.status_code, 200)
        self.assertEqual(self.client.get(endpoint).status_code, 404)

    def test_capture_validation_and_visibility_follow_report_permissions(self):
        payload = {"category": "bug", "message": "Descripción válida del error"}
        for captures in ([{"name": "Invalid", "data_url": "data:image/png;base64,AAAA"}], [{"id": str(uuid.uuid4())}], [{"id": "x"}] * 4, {"id": "x"}, [{"name": "\u0000", "data_url": "data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA"}]):
            self.assertEqual(self.client.post("/api/v2/suggestions/", {**payload, "screenshots": captures}, format="json").status_code, 400)
        hidden = Suggestion.objects.create(author_assignment=self.assignment, unit=self.unit, category="bug", message="Reporte de otra persona", internal_note="Diagnóstico privado")
        other_employee = Employee.objects.create(full_name="Otra persona sin permisos")
        other_account = UserAccount.objects.create_user(email="sinpermiso@bold.gt", password="Test-pass-2026!", employee=other_employee)
        other_assignment = PositionAssignment.objects.create(position=Position.objects.create(unit=self.unit, job_role=self.role), employee=other_employee)
        self.client.force_authenticate(other_account)
        self.client.credentials(HTTP_X_ASSIGNMENT_ID=str(other_assignment.id))
        self.assertEqual(self.client.get(f"/api/v2/suggestions/{hidden.id}/screenshots/?image=unknown").status_code, 404)
        self.assertEqual(self.client.get("/api/v2/suggestions/", {"unit": str(self.unit.id)}).data["count"], 0)

    def test_combined_filters_search_priority_order_and_pagination(self):
        reports = [Suggestion(author_assignment=self.assignment, unit=self.unit, title=f"Reporte {index}", message="Detalle de un problema suficientemente largo", category="bug", source_module="tasks", priority="low") for index in range(28)]
        Suggestion.objects.bulk_create(reports)
        target = reports[0]
        target.title = "Calendario deja de guardar"
        target.source_module = "calendar"
        target.status = "reviewing"
        target.priority = "high"
        target.save()
        today = timezone.localdate().isoformat()
        response = self.client.get("/api/v2/suggestions/", {"status": "reviewing", "category": "bug", "priority": "high", "source_module": "calendar", "unit": str(self.unit.id), "author_assignment": str(self.assignment.id), "search": "calendario guardar", "from": today, "to": today})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(str(response.data["results"][0]["id"]), str(target.id))
        reference = self.client.get("/api/v2/suggestions/", {"search": f"#{str(target.id)[:8].upper()}"})
        self.assertEqual(reference.data["count"], 1)
        first = self.client.get("/api/v2/suggestions/", {"order": "priority"})
        self.assertEqual(first.data["count"], 28)
        self.assertEqual(len(first.data["results"]), 25)
        self.assertEqual(str(first.data["results"][0]["id"]), str(target.id))
        second = self.client.get(first.data["next"])
        self.assertEqual(len(second.data["results"]), 3)
        self.assertFalse({row["id"] for row in first.data["results"]} & {row["id"] for row in second.data["results"]})
        Suggestion.objects.filter(pk=target.pk).update(created_at=timezone.now() - timedelta(days=5))
        self.assertEqual(self.client.get("/api/v2/suggestions/", {"order": "oldest"}).data["results"][0]["id"], str(target.id))
        self.assertEqual(self.client.get("/api/v2/suggestions/", {"from": today, "source_module": "calendar"}).data["count"], 0)

    def test_bad_filters_are_rejected_and_review_priority_is_audited(self):
        for filters in ({"priority": "urgent"}, {"status": "unknown"}, {"category": "invalid"}, {"unit": "no-uuid"}, {"from": "2026-02-31"}, {"from": "2026-10-08", "to": "2026-10-01"}, {"order": "random"}):
            self.assertEqual(self.client.get("/api/v2/suggestions/", filters).status_code, 400, filters)
        JobRolePermission.objects.create(job_role=self.role, permission=Permission.objects.get(code="suggestions.feedback.manage"), effect="allow", scope_type="own_unit")
        report = Suggestion.objects.create(author_assignment=self.assignment, unit=self.unit, category="bug", message="Un problema que requiere revisión")
        reviewed = self.client.patch(f"/api/v2/suggestions/{report.id}/", {"status": "reviewing", "priority": "high", "internal_note": "Pasos reproducidos"}, format="json")
        self.assertEqual(reviewed.status_code, 200, reviewed.data)
        self.assertTrue(reviewed.data["can_manage"])
        self.assertEqual(reviewed.data["internal_note"], "Pasos reproducidos")
        self.assertEqual(SuggestionEvent.objects.get(suggestion=report, event_type="suggestion.reviewed").changes["after"]["priority"], "high")

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
