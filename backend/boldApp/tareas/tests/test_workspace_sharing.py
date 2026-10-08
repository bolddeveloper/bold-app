from uuid import uuid4

from django.core.management import call_command
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from boldApp.core.models import PositionAssignment
from boldApp.tareas.models import SharedWorkspaceFolder


@override_settings(SECURE_SSL_REDIRECT=False)
class WorkspaceSharingTests(TestCase):
    endpoint = "/api/v2/workspace-sharing/"

    def setUp(self):
        call_command("seed_demo_data", verbosity=0)
        self.owner = PositionAssignment.objects.get(employee__user_account__email="ana@bold.gt", is_active=True)
        self.member = PositionAssignment.objects.get(employee__user_account__email="carla@bold.gt", is_active=True)
        self.outsider = PositionAssignment.objects.get(employee__user_account__email="david@bold.gt", is_active=True)
        self.client = APIClient()
        self.login(self.owner)
        identity = str(uuid4())
        self.payload = {"folder_id": identity, "member_ids": [str(self.member.pk)], "folders": [
            {"id": identity, "name": "Equipo", "parentId": None, "color": "#ef1f2d", "projectIds": [], "taskIds": [],
             "driveFolders": [{"id": "drive_folder", "name": "Recursos"}]},
        ]}

    def login(self, assignment):
        self.client.force_authenticate(assignment.employee.user_account)
        self.client.credentials(HTTP_X_ASSIGNMENT_ID=str(assignment.pk))

    def test_visibility_revocation_and_owner_only_deletion(self):
        response = self.client.post(self.endpoint, self.payload, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.login(self.member)
        rows = self.client.get(self.endpoint).data["items"]
        self.assertEqual(len(rows), 1)
        self.assertFalse(rows[0]["mine"])
        self.client.delete(f'{self.endpoint}?folder_id={self.payload["folder_id"]}')
        self.assertEqual(SharedWorkspaceFolder.objects.count(), 1)
        self.login(self.outsider)
        self.assertEqual(self.client.get(self.endpoint).data["items"], [])
        self.login(self.owner)
        self.payload["member_ids"] = []
        self.assertEqual(self.client.post(self.endpoint, self.payload, format="json").status_code, 200)
        self.login(self.member)
        self.assertEqual(self.client.get(self.endpoint).data["items"], [])
        self.login(self.owner)
        self.assertEqual(self.client.delete(f'{self.endpoint}?folder_id={self.payload["folder_id"]}').status_code, 204)
        self.assertFalse(SharedWorkspaceFolder.objects.exists())

    def test_content_update_preserves_membership(self):
        self.assertEqual(self.client.post(self.endpoint, self.payload, format="json").status_code, 200)
        self.payload.pop("member_ids")
        self.payload["folders"][0]["name"] = "Equipo actualizado"
        response = self.client.post(self.endpoint, self.payload, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["member_ids"], [str(self.member.pk)])
        self.login(self.member)
        self.assertEqual(self.client.get(self.endpoint).data["items"][0]["folders"][0]["name"], "Equipo actualizado")

    def test_rejects_other_department_and_invalid_tree(self):
        self.payload["member_ids"] = [str(self.outsider.pk)]
        self.assertEqual(self.client.post(self.endpoint, self.payload, format="json").status_code, 400)
        self.payload["member_ids"] = []
        self.payload["folders"].append({**self.payload["folders"][0], "id": str(uuid4()), "parentId": None})
        self.assertEqual(self.client.post(self.endpoint, self.payload, format="json").status_code, 400)
        self.payload["folders"].pop()
        self.payload["folders"][0]["parentId"] = self.payload["folder_id"]
        self.assertEqual(self.client.post(self.endpoint, self.payload, format="json").status_code, 400)
        self.assertFalse(SharedWorkspaceFolder.objects.exists())
