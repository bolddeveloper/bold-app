from uuid import uuid4
from django.core.management import call_command
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from boldApp.core.models import PositionAssignment


@override_settings(SECURE_SSL_REDIRECT=False)
class PersonalBoardTests(TestCase):
    endpoint = "/api/v2/personal-board/"

    def setUp(self):
        call_command("seed_demo_data", verbosity=0)
        self.owner = PositionAssignment.objects.get(employee__user_account__email="ana@bold.gt", is_active=True)
        self.other = PositionAssignment.objects.get(employee__user_account__email="carla@bold.gt", is_active=True)
        self.client = APIClient()
        self.login(self.owner)

    def login(self, assignment):
        self.client.force_authenticate(assignment.employee.user_account)
        self.client.credentials(HTTP_X_ASSIGNMENT_ID=str(assignment.pk))

    def test_sections_and_task_placement_survive_reload_and_are_private(self):
        section, task = str(uuid4()), str(uuid4())
        board = {"sections": [{"id": section, "label": "Hoy"}], "task_sections": {task: section}}
        response = self.client.put(self.endpoint, board, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(self.client.get(self.endpoint).data, board)
        self.login(self.other)
        self.assertEqual(self.client.get(self.endpoint).data, {"sections": [], "task_sections": {}})
        self.login(self.owner)
        self.client.put(self.endpoint, {"sections": [], "task_sections": {}}, format="json")
        self.assertEqual(self.client.get(self.endpoint).data["task_sections"], {})

    def test_rejects_duplicate_sections_and_missing_destinations(self):
        section = {"id": str(uuid4()), "label": "Hoy"}
        invalid = [
            {"sections": [section, section], "task_sections": {}},
            {"sections": [section], "task_sections": {str(uuid4()): str(uuid4())}},
            {"sections": [section], "task_sections": {"invalid": section["id"]}},
        ]
        for board in invalid:
            self.assertEqual(self.client.put(self.endpoint, board, format="json").status_code, 400)
        self.assertEqual(self.client.get(self.endpoint).data["sections"], [])
