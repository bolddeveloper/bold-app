from asgiref.sync import async_to_sync
from channels.testing import WebsocketCommunicator
from channels.layers import get_channel_layer
from django.core.management import call_command
from django.test import TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from django.test import RequestFactory

from boldApp.autenticacion.services import create_session, issue_ws_ticket
from boldApp.core.models import OrganizationalUnit, PositionAssignment, UserAccount
from boldApp.tareas.models import Project, Section, Task, TaskProject, TaskStatus
from boldApp.tareas.management.commands.seed_demo_data import DEMO_PEOPLE
from config.asgi import application


@override_settings(SECURE_SSL_REDIRECT=False, DEBUG=True)
class TasksV2ApiTests(TransactionTestCase):
    reset_sequences = True

    def setUp(self):
        call_command("seed_demo_data", verbosity=0)
        self.client = APIClient()
        self.ana = UserAccount.objects.get(email="ana@bold.gt")
        self.david = UserAccount.objects.get(email="david@bold.gt")
        self.actor = UserAccount.objects.get(email="developer@bold.gt")
        self.ana_assignment = PositionAssignment.objects.get(employee=self.ana.employee, is_active=True)
        self.david_assignment = PositionAssignment.objects.get(employee=self.david.employee, is_active=True)
        self.actor_assignment = PositionAssignment.objects.get(employee=self.actor.employee, is_active=True)
        _, self.auth_session = create_session(self.actor, RequestFactory().get("/", REMOTE_ADDR="127.0.0.1"))
        self.client.force_authenticate(user=self.actor, token=self.auth_session)
        self.client.credentials(
            HTTP_X_ASSIGNMENT_ID=str(self.actor_assignment.id),
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

    def test_seed_includes_idempotent_samuel_authentication_account(self):
        samuel = UserAccount.objects.get(email="samuel@bold.gt")
        assignment = PositionAssignment.objects.get(employee=samuel.employee, is_active=True, released_at__isnull=True)
        self.assertEqual(assignment.position.unit.name, "Marketing")
        self.assertTrue(samuel.check_password("bolddemo123"))

        samuel.set_password("Contraseña local preservada 2026!")
        samuel.save(update_fields=["password"])
        call_command("seed_demo_data", verbosity=0)
        samuel.refresh_from_db()
        self.assertTrue(samuel.check_password("Contraseña local preservada 2026!"))
        self.assertEqual(UserAccount.objects.filter(email="samuel@bold.gt").count(), 1)
        self.assertEqual(PositionAssignment.objects.filter(employee=samuel.employee, is_active=True, released_at__isnull=True).count(), 1)

    def test_seed_includes_owner_and_high_management_demo_accounts(self):
        luis = UserAccount.objects.get(email="luis@bold.gt")
        paulus = UserAccount.objects.get(email="paulus@bold.gt")
        self.assertTrue(luis.is_staff)
        self.assertTrue(luis.is_superuser)
        self.assertTrue(luis.check_password("LuisBold2026!"))
        self.assertEqual(luis.employee.position_assignments.get(is_active=True).position.job_role.title, "Propietario")
        self.assertFalse(paulus.is_staff)
        self.assertFalse(paulus.is_superuser)
        self.assertTrue(paulus.check_password("PaulusBold2026!"))
        self.assertEqual(paulus.employee.position_assignments.get(is_active=True).position.job_role.title, "Alta Gerencia")

        luis.set_password("Contraseña de dueño modificada 2026!")
        luis.save(update_fields=["password"])
        call_command("seed_demo_data", verbosity=0)
        luis.refresh_from_db()
        self.assertTrue(luis.check_password("Contraseña de dueño modificada 2026!"))

    def test_bulk_create_update_delete_and_atomic_validation(self):
        payload = {key: value for key, value in self.task_payload().items() if key not in {"project", "section", "project_position"}}
        created = self.client.post("/api/v2/tasks/bulk/", {"operation": "create", "items": [{**payload, "title": "Uno"}, {**payload, "title": "Dos"}]}, format="json")
        self.assertEqual(created.status_code, 201, getattr(created, "data", None))
        ids = created.data["created"]
        changed = self.client.post("/api/v2/tasks/bulk/", {"operation": "update", "ids": ids, "changes": {"priority": "low"}}, format="json")
        self.assertEqual(changed.status_code, 200, getattr(changed, "data", None))
        self.assertEqual(Task.objects.filter(id__in=ids, priority="low").count(), 2)
        invalid = self.client.post("/api/v2/tasks/bulk/", {"operation": "update", "ids": ids, "changes": {"status": str(self.ops_status.id)}}, format="json")
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(Task.objects.filter(id__in=ids, priority="low").count(), 2)
        deleted = self.client.post("/api/v2/tasks/bulk/", {"operation": "delete", "ids": ids}, format="json")
        self.assertEqual(deleted.status_code, 200, getattr(deleted, "data", None))
        self.assertEqual(Task.all_objects.filter(id__in=ids, deleted_at__isnull=False).count(), 2)

    def test_bulk_parent_cycle_is_rejected(self):
        payload = {key: value for key, value in self.task_payload().items() if key not in {"project", "section", "project_position"}}
        created = self.client.post("/api/v2/tasks/bulk/", {"operation": "create", "items": [{**payload, "title": "Raiz"}, {**payload, "title": "Hija"}]}, format="json")
        self.assertEqual(created.status_code, 201, getattr(created, "data", None))
        root, child = created.data["created"]
        first = self.client.post("/api/v2/tasks/bulk/", {"operation": "update", "ids": [child], "changes": {"parent_task": root}}, format="json")
        self.assertEqual(first.status_code, 200, getattr(first, "data", None))
        cycle = self.client.post("/api/v2/tasks/bulk/", {"operation": "update", "ids": [root], "changes": {"parent_task": child}}, format="json")
        self.assertEqual(cycle.status_code, 400)
        self.assertIsNone(Task.objects.get(pk=root).parent_task_id)

    def test_bulk_project_link_and_invalid_ids(self):
        created = self.client.post("/api/v2/tasks/", self.task_payload(), format="json")
        self.assertEqual(created.status_code, 201, getattr(created, "data", None))
        task_id = created.data["id"]
        linked = self.client.post("/api/v2/tasks/bulk/", {"operation": "link", "ids": [task_id], "project": str(self.ops_project.id), "section": str(self.ops_section.id)}, format="json")
        self.assertEqual(linked.status_code, 200, getattr(linked, "data", None))
        self.assertEqual(TaskProject.objects.get(task_id=task_id, project=self.ops_project).section_id, self.ops_section.id)
        again = self.client.post("/api/v2/tasks/bulk/", {"operation": "link", "ids": [task_id], "project": str(self.ops_project.id)}, format="json")
        self.assertEqual(again.status_code, 200, getattr(again, "data", None))
        self.assertEqual(TaskProject.objects.get(task_id=task_id, project=self.ops_project).section_id, self.ops_section.id)
        invalid = self.client.post("/api/v2/tasks/bulk/", {"operation": "delete", "ids": ["not-a-uuid"]}, format="json")
        self.assertEqual(invalid.status_code, 400)
        self.assertTrue(Task.objects.filter(pk=task_id).exists())

    def test_bulk_create_rolls_back_when_a_later_item_is_invalid(self):
        payload = {key: value for key, value in self.task_payload().items() if key not in {"project", "section", "project_position"}}
        response = self.client.post("/api/v2/tasks/bulk/", {"operation": "create", "items": [{**payload, "title": "No debe quedar"}, {**payload, "title": "   "}]}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertFalse(Task.objects.filter(title="No debe quedar").exists())

    def test_requires_an_active_assignment_owned_by_the_account(self):
        foreign_client = APIClient()
        foreign_client.force_authenticate(user=self.actor, token=self.auth_session)
        foreign_client.credentials(
            HTTP_X_ASSIGNMENT_ID=str(self.david_assignment.id),
        )
        response = foreign_client.get("/api/v2/projects/")
        self.assertEqual(response.status_code, 403)

    def test_assignment_directory_is_paginated_and_exposes_only_safe_fields(self):
        response = self.client.get("/api/v2/core/position-assignments/directory/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["count"], len(DEMO_PEOPLE))
        self.assertIn("samuel@bold.gt", {row["employee_email"] for row in response.data["results"]})
        self.assertEqual(
            set(response.data["results"][0]),
            {
                "id", "employee", "employee_name", "employee_email", "unit", "unit_name",
                "job_role", "job_role_title", "account_is_superuser",
            },
        )

    def test_nonprivileged_seed_neutralizes_every_known_privileged_demo_account(self):
        with self.settings(
            DEBUG=False,
            SEED_DEMO_ACCOUNTS=True,
            SEED_PRIVILEGED_DEMO_ACCOUNTS=False,
        ):
            call_command("seed_demo_data", verbosity=0)

        for email in {"luis@bold.gt", "paulus@bold.gt", "developer@bold.gt"}:
            account = UserAccount.objects.get(email=email)
            self.assertFalse(account.is_active)
            self.assertFalse(account.is_staff)
            self.assertFalse(account.is_superuser)
            self.assertFalse(account.has_usable_password())

    def test_project_dates_validation_duplicate_names_and_empty_sections(self):
        payload = {
            "unit": str(self.marketing.id),
            "owner_assignment": str(self.ana_assignment.id),
            "name": "  Proyecto nuevo  ",
            "status": "Activo",
            "start_date": "2026-09-11",
            "end_date": "2026-09-30",
        }
        first = self.client.post("/api/v2/projects/", payload, format="json")
        second = self.client.post("/api/v2/projects/", payload, format="json")
        self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual(first.data["name"], "Proyecto nuevo")
        self.assertEqual(second.status_code, 201, second.data)
        self.assertEqual(second.data["name"], "Proyecto nuevo (2)")
        self.assertFalse(Section.objects.filter(project_id=first.data["id"]).exists())

        payload["name"] = "Rango incorrecto"
        payload["start_date"], payload["end_date"] = "2026-10-01", "2026-09-30"
        invalid = self.client.post("/api/v2/projects/", payload, format="json")
        self.assertEqual(invalid.status_code, 400)
        self.assertIn("end_date", invalid.data)

    def test_section_delete_unsections_tasks_and_task_titles_are_trimmed(self):
        response = self.client.post("/api/v2/tasks/", {**self.task_payload(), "title": "  Tarea limpia  "}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        task = Task.objects.get(id=response.data["id"])
        link = TaskProject.objects.get(task=task)
        self.assertEqual(task.title, "Tarea limpia")
        deleted = self.client.delete(f"/api/v2/sections/{self.ops_section.id}/")
        self.assertEqual(deleted.status_code, 204)
        link.refresh_from_db()
        self.assertIsNone(link.section_id)

        invalid = self.client.post("/api/v2/tasks/", {**self.task_payload(), "section": None, "title": "   "}, format="json")
        self.assertEqual(invalid.status_code, 400)
        self.assertIn("title", invalid.data)

    def test_webhook_secret_is_only_returned_when_endpoint_is_created(self):
        self.auth_session.mfa_verified_at = timezone.now()
        self.auth_session.auth_strength = "password_totp"
        self.auth_session.save(update_fields=["mfa_verified_at", "auth_strength"])
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
        self.assertEqual(task.created_by_assignment, self.actor_assignment)

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

    def test_websocket_requires_single_use_ticket_and_matching_assignment(self):
        valid_ticket = issue_ws_ticket(self.actor, self.auth_session, self.actor_assignment.id, self.operations.id)
        invalid_ticket = issue_ws_ticket(self.actor, self.auth_session, self.david_assignment.id, self.operations.id)
        async def checks():
            valid = WebsocketCommunicator(
                application,
                f"/ws/unit/{self.operations.id}/?ticket={valid_ticket}",
                headers=[(b"origin", b"http://localhost:5173")],
            )
            connected, _ = await valid.connect()
            self.assertTrue(connected)
            await valid.disconnect()

            invalid = WebsocketCommunicator(
                application,
                f"/ws/unit/{self.operations.id}/?ticket={invalid_ticket}",
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

    def test_board_move_notifies_two_clients_without_changing_task_status(self):
        created = self.client.post("/api/v2/tasks/", self.task_payload(), format="json")
        task = Task.objects.get(id=created.data["id"])
        link = TaskProject.objects.get(task=task)
        layer = get_channel_layer()
        clients = [async_to_sync(layer.new_channel)() for _ in range(2)]
        for channel in clients:
            async_to_sync(layer.group_add)(f"unit_{task.unit_id}", channel)
        response = self.client.patch(
            f"/api/v2/task-projects/{link.id}/",
            {"section": None, "position": "2000.0000000000"}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        task.refresh_from_db()
        self.assertEqual(task.status_id, self.marketing_status.id)
        events = [async_to_sync(layer.receive)(channel)["envelope"] for channel in clients]
        self.assertEqual(events[0]["event_type"], "task.updated")
        self.assertEqual(events[0]["event_id"], events[1]["event_id"])

    @override_settings(CORS_ALLOWED_ORIGINS=["http://localhost:5173"])
    def test_browser_cors_allows_assignment_header(self):
        response = self.client.options(
            "/api/v2/tasks/", HTTP_ORIGIN="http://localhost:5173",
            HTTP_ACCESS_CONTROL_REQUEST_METHOD="POST",
            HTTP_ACCESS_CONTROL_REQUEST_HEADERS="authorization,content-type,x-assignment-id",
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("x-assignment-id", response["Access-Control-Allow-Headers"])
