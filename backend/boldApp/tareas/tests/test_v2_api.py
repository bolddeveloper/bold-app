from asgiref.sync import async_to_sync
from channels.testing import WebsocketCommunicator
from channels.layers import get_channel_layer
from django.core.management import call_command
from django.test import TransactionTestCase
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from boldApp.core.models import OrganizationalUnit, PositionAssignment, UserAccount
from boldApp.tareas.models import Project, Section, Task, TaskProject, TaskStatus
from config.asgi import application


class TasksV2ApiTests(TransactionTestCase):
    reset_sequences = True

    def setUp(self):
        call_command("seed_demo_data", verbosity=0)
        self.client = APIClient()
        self.ana = UserAccount.objects.get(email="ana@bold.gt")
        self.david = UserAccount.objects.get(email="david@bold.gt")
        self.ana_assignment = PositionAssignment.objects.get(employee=self.ana.employee, is_active=True)
        self.david_assignment = PositionAssignment.objects.get(employee=self.david.employee, is_active=True)
        self.token, _ = Token.objects.get_or_create(user=self.ana)
        self.client.credentials(
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
            HTTP_X_ASSIGNMENT_ID=str(self.ana_assignment.id),
        )
        self.marketing = OrganizationalUnit.objects.get(name="Marketing")
        self.operations = OrganizationalUnit.objects.get(name="Operaciones")
        self.ops_project = Project.objects.get(name="Rediseno web")
        self.ops_section = Section.objects.get(project=self.ops_project, name="todo")
        self.marketing_status = TaskStatus.objects.get(unit=self.marketing, category="todo")
        self.ops_status = TaskStatus.objects.get(unit=self.operations, category="in_progress")

    def task_payload(self):
        return {
            "unit": str(self.marketing.id),
            "assignee_assignment": str(self.ana_assignment.id),
            "status": str(self.marketing_status.id),
            "title": "Entrega conjunta",
            "priority": "high",
            "project": str(self.ops_project.id),
            "section": str(self.ops_section.id),
            "project_position": "1.0000000000",
        }

    def test_requires_an_active_assignment_owned_by_the_account(self):
        foreign_client = APIClient()
        foreign_client.credentials(
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
            HTTP_X_ASSIGNMENT_ID=str(self.david_assignment.id),
        )
        response = foreign_client.get("/api/v2/projects/")
        self.assertEqual(response.status_code, 403)

    def test_assignment_directory_is_paginated_and_exposes_only_safe_fields(self):
        response = self.client.get("/api/v2/core/position-assignments/directory/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["count"], 3)
        self.assertEqual(
            set(response.data["results"][0]),
            {"id", "employee", "employee_name", "unit", "unit_name", "job_role", "job_role_title"},
        )

    def test_webhook_secret_is_only_returned_when_endpoint_is_created(self):
        created = self.client.post(
            "/api/v2/webhook-endpoints/",
            {
                "unit": str(self.marketing.id),
                "target_url": "http://127.0.0.1:9000/webhook",
                "event_types": ["task.created"],
                "is_active": True,
            },
            format="json",
        )
        self.assertEqual(created.status_code, 201, created.data)
        self.assertIn("secret", created.data)

        retrieved = self.client.get(f"/api/v2/webhook-endpoints/{created.data['id']}/")
        self.assertEqual(retrieved.status_code, 200, retrieved.data)
        self.assertNotIn("secret", retrieved.data)

    def test_creates_task_and_cross_unit_project_link_atomically(self):
        response = self.client.post("/api/v2/tasks/", self.task_payload(), format="json")
        self.assertEqual(response.status_code, 201, response.data)
        task = Task.objects.get(id=response.data["id"])
        link = TaskProject.objects.get(task=task)
        self.assertEqual(task.unit, self.marketing)
        self.assertEqual(link.project, self.ops_project)
        self.assertEqual(link.section, self.ops_section)
        self.assertEqual(task.created_by_assignment, self.ana_assignment)

    def test_rejects_a_status_from_another_unit(self):
        payload = self.task_payload()
        payload["status"] = str(self.ops_status.id)
        response = self.client.post("/api/v2/tasks/", payload, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("status", response.data)

    def test_moves_responsibility_to_another_unit(self):
        created = self.client.post("/api/v2/tasks/", self.task_payload(), format="json")
        task_id = created.data["id"]
        response = self.client.post(
            f"/api/v2/tasks/{task_id}/move/",
            {
                "unit": str(self.operations.id),
                "assignee_assignment": str(self.david_assignment.id),
                "status": str(self.ops_status.id),
                "project": str(self.ops_project.id),
                "section": str(self.ops_section.id),
                "position": "2.0000000000",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        task = Task.objects.get(id=task_id)
        self.assertEqual(task.unit, self.operations)
        self.assertEqual(task.assignee_assignment, self.david_assignment)

    def test_websocket_requires_token_and_matching_assignment(self):
        async def checks():
            valid = WebsocketCommunicator(
                application,
                f"/ws/unit/{self.operations.id}/?token={self.token.key}&assignment={self.ana_assignment.id}",
                headers=[(b"origin", b"http://localhost:5173")],
            )
            connected, _ = await valid.connect()
            self.assertTrue(connected)
            await valid.disconnect()

            invalid = WebsocketCommunicator(
                application,
                f"/ws/unit/{self.operations.id}/?token={self.token.key}&assignment={self.david_assignment.id}",
                headers=[(b"origin", b"http://localhost:5173")],
            )
            connected, _ = await invalid.connect()
            self.assertFalse(connected)

        async_to_sync(checks)()

    def test_handoff_notifies_both_responsible_units(self):
        created = self.client.post("/api/v2/tasks/", self.task_payload(), format="json")
        task_id = created.data["id"]
        layer = get_channel_layer()
        old_channel = async_to_sync(layer.new_channel)()
        new_channel = async_to_sync(layer.new_channel)()
        async_to_sync(layer.group_add)(f"unit_{self.marketing.id}", old_channel)
        async_to_sync(layer.group_add)(f"unit_{self.operations.id}", new_channel)

        response = self.client.post(
            f"/api/v2/tasks/{task_id}/move/",
            {
                "unit": str(self.operations.id),
                "assignee_assignment": str(self.david_assignment.id),
                "status": str(self.ops_status.id),
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        old_event = async_to_sync(layer.receive)(old_channel)
        new_event = async_to_sync(layer.receive)(new_channel)
        self.assertEqual(old_event["envelope"]["event_type"], "task.status_changed")
        self.assertEqual(new_event["envelope"]["event_type"], "task.status_changed")
        self.assertEqual(old_event["envelope"]["event_version"], 2)
