from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from boldApp.core.models import Employee, UserAccount, OrganizationalUnit, JobRole, Position, PositionAssignment


@override_settings(AUTH_ENCRYPTION_KEY="isolated-task-draft-grants", MESSAGING_PILOT_ENABLED=True, MESSAGING_PILOT_UNIT_IDS=())
class TaskDraftGrantTests(TestCase):
    def setUp(self):
        cache.clear()
        self.unit = OrganizationalUnit.objects.create(name="Marketing de prueba", unit_type="department", sensitivity_level="low")
        role = JobRole.objects.create(title="Redacción")
        self.people = []
        for suffix in ("a", "b"):
            employee = Employee.objects.create(full_name="Borradores " + suffix)
            user = UserAccount.objects.create_user(email=f"draft-{suffix}@bold.gt", employee=employee)
            assignment = PositionAssignment.objects.create(employee=employee, position=Position.objects.create(unit=self.unit, job_role=role))
            self.people.append((user, assignment))
        self.user, self.assignment = self.people[0]
        self.client = APIClient(); self.client.force_authenticate(self.user)
        self.client.credentials(HTTP_X_ASSIGNMENT_ID=str(self.assignment.pk))

    def grant(self, **changes):
        return self.client.post("/api/v2/task-drafts/grant/", {"kind": "task-create", "resource_id": str(self.assignment.pk), **changes}, format="json")

    def test_non_it_account_recovers_only_its_private_authored_draft_and_no_creation_permission_is_conferred(self):
        response = self.grant()
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIn("no-store", response["Cache-Control"])
        self.assertEqual(response.data["scope"]["account_id"], str(self.user.pk))
        self.assertEqual(self.grant().data["key_id"], response.data["key_id"])
        self.assertEqual(self.grant(resource_id=str(self.people[1][1].pk)).status_code, 400)
        self.assertEqual(self.grant(kind="task-edit").status_code, 400)
        self.assertEqual(self.grant(account_id=str(self.people[1][0].pk)).status_code, 400)
        self.client.credentials(HTTP_X_ASSIGNMENT_ID=str(self.people[1][1].pk))
        self.assertEqual(self.grant().status_code, 403)

    def test_account_credentials_and_assignment_isolate_and_rotate_keys(self):
        before = self.grant().data["key_id"]
        self.user.credentials_version += 1; self.user.save(update_fields=["credentials_version"])
        self.assertNotEqual(self.grant().data["key_id"], before)
        other, other_assignment = self.people[1]
        self.client.force_authenticate(other); self.client.credentials(HTTP_X_ASSIGNMENT_ID=str(other_assignment.pk))
        response = self.grant(resource_id=str(other_assignment.pk))
        self.assertEqual(response.status_code, 200)
        self.assertNotEqual(response.data["key_id"], before)
        other_assignment.is_active = False; other_assignment.save(update_fields=["is_active"])
        self.assertEqual(self.grant(resource_id=str(other_assignment.pk)).status_code, 403)
