from unittest.mock import patch

from asgiref.sync import async_to_sync
from channels.db import database_sync_to_async
from channels.testing import WebsocketCommunicator
from django.core.management import call_command
from django.db import transaction
from django.test import RequestFactory, TransactionTestCase, override_settings
from rest_framework.test import APIClient

from boldApp.autenticacion.services import create_session, issue_ws_ticket
from boldApp.core.models import JobRolePermission, OrganizationalUnit, Permission, PositionAssignment, UserAccount
from boldApp.notificaciones.consumers import notification_resource_is_readable
from boldApp.notificaciones.models import Notification
from boldApp.tareas.models import Project, ProjectMember, TaskStatus, TaskFollower, Section
from config.asgi import application


@override_settings(SECURE_SSL_REDIRECT=False, DEBUG=True)
class NotificationModuleTests(TransactionTestCase):
    reset_sequences = True

    def setUp(self):
        call_command("seed_demo_data", verbosity=0)
        Notification.objects.all().delete()
        self.actor = UserAccount.objects.get(email="developer@bold.gt")
        self.recipient = UserAccount.objects.get(email="ana@bold.gt")
        self.actor_assignment = PositionAssignment.objects.get(employee=self.actor.employee, is_active=True)
        self.recipient_assignment = PositionAssignment.objects.get(employee=self.recipient.employee, is_active=True)
        self.marketing = OrganizationalUnit.objects.get(name="Marketing")
        self.status = TaskStatus.objects.get(unit=self.marketing, category="todo")
        self.actor_client = self.client_for(self.actor, self.actor_assignment)
        self.recipient_client = self.client_for(self.recipient, self.recipient_assignment)

    def client_for(self, account, assignment):
        _, session = create_session(account, RequestFactory().get("/", REMOTE_ADDR="127.0.0.1"))
        client = APIClient()
        client.force_authenticate(account, session)
        client.credentials(HTTP_X_ASSIGNMENT_ID=str(assignment.id))
        return client

    def create_task(self, title="Notificación verificable"):
        response = self.actor_client.post("/api/v2/tasks/", {
            "unit": str(self.marketing.id),
            "assignee_assignment": str(self.recipient_assignment.id),
            "status": str(self.status.id),
            "title": title,
            "priority": "high",
        }, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def test_assignment_creates_private_navigable_notification(self):
        task = self.create_task()
        notification = Notification.objects.get(
            recipient_assignment=self.recipient_assignment,
            type="task.assigned",
        )
        self.assertEqual(notification.route["task_id"], task["id"])
        self.assertFalse(Notification.objects.filter(recipient_assignment=self.actor_assignment).exists())

        listed = self.recipient_client.get("/api/v2/notifications/")
        self.assertEqual(listed.status_code, 200, listed.data)
        self.assertEqual(listed.data["results"][0]["id"], str(notification.id))
        self.assertEqual(self.actor_client.get("/api/v2/notifications/").data["results"], [])

    def test_clear_hides_only_authorized_current_recipient_notifications(self):
        task = self.create_task("Aviso para limpiar")
        notification = Notification.objects.get(recipient_assignment=self.recipient_assignment)
        self.assertEqual(self.actor_client.post("/api/v2/notifications/clear/").data["updated"], 0)
        result = self.recipient_client.post("/api/v2/notifications/clear/")
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.data["updated"], 1)
        self.assertEqual(self.recipient_client.get("/api/v2/notifications/").data["results"], [])
        notification.refresh_from_db()
        self.assertIsNotNone(notification.dismissed_at)
        self.assertEqual(str(notification.task_id), task["id"])
        self.assertEqual(self.recipient_client.post("/api/v2/notifications/clear/").data["updated"], 0)

    def test_read_state_supports_one_all_and_unread(self):
        self.create_task("Lectura reversible")
        notification = Notification.objects.get(recipient_assignment=self.recipient_assignment)
        marked = self.recipient_client.post(f"/api/v2/notifications/{notification.id}/mark-read/")
        self.assertEqual(marked.status_code, 200)
        self.assertTrue(marked.data["is_read"])
        unread = self.recipient_client.post(f"/api/v2/notifications/{notification.id}/mark-unread/")
        self.assertEqual(unread.status_code, 200)
        self.assertFalse(unread.data["is_read"])
        count = self.recipient_client.get("/api/v2/notifications/unread-count/")
        self.assertEqual(count.data["count"], 1)
        self.assertEqual(self.recipient_client.post("/api/v2/notifications/mark-all-read/").data["updated"], 1)

    def test_comment_notifies_relevant_people_and_prioritizes_mentions(self):
        task = self.create_task("Conversación segura")
        Notification.objects.all().delete()
        response = self.actor_client.post("/api/v2/comments/", {
            "task": task["id"],
            "body": "Necesito tu revisión @ana@bold.gt",
        }, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        notification = Notification.objects.get(recipient_assignment=self.recipient_assignment)
        self.assertEqual(notification.type, "comment.mentioned")
        self.assertEqual(notification.route["comment_id"], response.data["id"])

    def test_project_creation_notifies_its_owner(self):
        response = self.actor_client.post("/api/v2/projects/", {
            "unit": str(self.marketing.id),
            "owner_assignment": str(self.recipient_assignment.id),
            "name": "Proyecto anunciado",
            "status": "active",
        }, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        notification = Notification.objects.get(
            recipient_assignment=self.recipient_assignment,
            type="project.created",
        )
        self.assertEqual(notification.route["project_id"], response.data["id"])

    def test_selected_project_members_are_atomic_private_and_notified(self):
        other = UserAccount.objects.get(email="carla@bold.gt")
        other_assignment = PositionAssignment.objects.get(employee=other.employee, is_active=True)
        other_client = self.client_for(other, other_assignment)
        response = self.actor_client.post("/api/v2/projects/", {
            "unit": str(self.marketing.pk), "owner_assignment": str(self.recipient_assignment.pk),
            "name": "Equipo específico", "status": "active", "member_ids": [str(self.recipient_assignment.pk)],
        }, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        project_id = response.data["id"]
        self.assertEqual(list(ProjectMember.objects.filter(project_id=project_id, status="active").values_list("assignment_id", flat=True)), [self.recipient_assignment.pk])
        self.assertEqual(self.recipient_client.get(f"/api/v2/projects/{project_id}/").status_code, 200)
        self.assertEqual(other_client.get(f"/api/v2/projects/{project_id}/").status_code, 404)
        owner = UserAccount.objects.get(email="luis@bold.gt")
        owner_assignment = PositionAssignment.objects.get(employee=owner.employee, is_active=True)
        self.assertEqual(self.client_for(owner, owner_assignment).get(f"/api/v2/projects/{project_id}/").status_code, 200)
        self.assertNotIn(project_id, [row["id"] for row in other_client.get("/api/v2/projects/").data["results"]])
        section = Section.objects.create(project_id=project_id, name="Reservada", position=0)
        self.assertEqual(other_client.get(f"/api/v2/sections/{section.pk}/").status_code, 404)
        self.assertEqual(Notification.objects.filter(project_id=project_id, recipient_assignment=self.recipient_assignment).count(), 1)
        self.assertFalse(Notification.objects.filter(project_id=project_id, recipient_assignment=other_assignment).exists())
        # Explicit addition immediately enables authorized reads and sends one event.
        added = self.actor_client.patch(f"/api/v2/projects/{project_id}/", {"member_ids": [str(other_assignment.pk)]}, format="json")
        self.assertEqual(added.status_code, 200, added.data)
        self.assertEqual(other_client.get(f"/api/v2/projects/{project_id}/").status_code, 200)
        self.assertEqual(Notification.objects.filter(project_id=project_id, recipient_assignment=other_assignment, type="project.member_added").count(), 1)
        unchanged = self.actor_client.patch(f"/api/v2/projects/{project_id}/", {"member_ids": [str(other_assignment.pk)]}, format="json")
        self.assertEqual(unchanged.status_code, 200, unchanged.data)
        self.assertEqual(Notification.objects.filter(project_id=project_id, recipient_assignment=other_assignment).count(), 1)
        removed = self.actor_client.patch(f"/api/v2/projects/{project_id}/", {"member_ids": []}, format="json")
        self.assertEqual(removed.status_code, 200, removed.data)
        self.assertEqual(other_client.get(f"/api/v2/projects/{project_id}/").status_code, 404)
        self.assertFalse(any(row["project"] == project_id for row in other_client.get("/api/v2/notifications/").data["results"]))
        self.actor_client.patch(f"/api/v2/projects/{project_id}/", {"member_ids": [str(other_assignment.pk)]}, format="json")
        self.assertEqual(Notification.objects.filter(project_id=project_id, recipient_assignment=other_assignment, type="project.member_added").count(), 2)

    def test_bad_members_do_not_create_a_project_or_notifications(self):
        other = PositionAssignment.objects.get(employee__user_account__email="david@bold.gt", is_active=True)
        response = self.actor_client.post("/api/v2/projects/", {
            "unit": str(self.marketing.pk), "owner_assignment": str(self.recipient_assignment.pk),
            "name": "No debe existir", "status": "active", "member_ids": [str(other.pk)],
        }, format="json")
        self.assertEqual(response.status_code, 400, response.data)
        self.assertFalse(Project.objects.filter(name="No debe existir").exists())
        self.assertFalse(Notification.objects.exists())

    def test_member_failure_rolls_back_project_and_notifications(self):
        with patch("boldApp.tareas.serializers.ProjectSerializer._save_members", side_effect=RuntimeError("fallo de prueba")):
            with self.assertRaises(RuntimeError):
                self.actor_client.post("/api/v2/projects/", {
                    "unit": str(self.marketing.pk), "owner_assignment": str(self.recipient_assignment.pk),
                    "name": "Rollback de prueba", "status": "active", "member_ids": [],
                }, format="json")
        self.assertFalse(Project.objects.filter(name="Rollback de prueba").exists())
        self.assertFalse(Notification.objects.exists())

    def test_new_task_collaborator_and_reactivation_notify_once(self):
        task = self.create_task()
        # Pick a collaborator distinct from the responsible.
        other = PositionAssignment.objects.get(employee__user_account__email="carla@bold.gt", is_active=True)
        response = self.actor_client.post("/api/v2/task-followers/", {
            "task": task["id"], "assignment": str(other.pk), "notification_level": "all",
        }, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        query = Notification.objects.filter(recipient_assignment=other, type="task.collaborator_added")
        self.assertEqual(query.count(), 1)
        self.assertEqual(query.first().route["task_id"], task["id"])
        self.assertEqual(query.first().actor_assignment, self.actor_assignment)
        url = f"/api/v2/task-followers/{response.data['id']}/"
        self.assertEqual(self.actor_client.patch(url, {"notification_level": "all"}, format="json").status_code, 200)
        self.assertEqual(query.count(), 1)
        self.actor_client.patch(url, {"notification_level": "none"}, format="json")
        self.actor_client.patch(url, {"notification_level": "all"}, format="json")
        self.assertEqual(query.count(), 2)

    def test_responsible_change_notifies_as_assignment_even_with_other_changes(self):
        task = self.create_task()
        other = PositionAssignment.objects.get(employee__user_account__email="carla@bold.gt", is_active=True)
        response = self.actor_client.patch(f"/api/v2/tasks/{task['id']}/", {
            "assignee_assignment": str(other.pk), "due_date": "2026-11-01", "priority": "low",
        }, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        notification = Notification.objects.get(recipient_assignment=other)
        self.assertEqual(notification.type, "task.assigned")
        self.assertIn("responsable", notification.body)

    def test_project_responsible_change_notifies_new_person(self):
        response = self.actor_client.post("/api/v2/projects/", {
            "unit": str(self.marketing.pk), "owner_assignment": str(self.recipient_assignment.pk),
            "name": "Cambio de responsable", "status": "active", "member_ids": [],
        }, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        other = PositionAssignment.objects.get(employee__user_account__email="carla@bold.gt", is_active=True)
        updated = self.actor_client.patch(f"/api/v2/projects/{response.data['id']}/", {"owner_assignment": str(other.pk)}, format="json")
        self.assertEqual(updated.status_code, 200, updated.data)
        notification = Notification.objects.get(recipient_assignment=other, type="project.assigned")
        self.assertEqual(notification.actor_assignment, self.actor_assignment)

    def test_participation_never_overrides_an_explicit_permission_deny(self):
        JobRolePermission.objects.filter(job_role=self.recipient_assignment.position.job_role, permission__code="tasks.project.read").delete()
        JobRolePermission.objects.create(
            job_role=self.recipient_assignment.position.job_role,
            permission=Permission.objects.get(code="tasks.project.read"),
            scope_type="own_unit", effect="deny",
        )
        response = self.actor_client.post("/api/v2/projects/", {
            "unit": str(self.marketing.pk), "owner_assignment": str(self.recipient_assignment.pk),
            "name": "Participación no es autorización", "status": "active", "member_ids": [str(self.recipient_assignment.pk)],
        }, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(self.recipient_client.get(f"/api/v2/projects/{response.data['id']}/").status_code, 404)
        self.assertFalse(Notification.objects.filter(project_id=response.data["id"], recipient_assignment=self.recipient_assignment).exists())

    def test_websocket_checks_current_membership_before_sending_queued_notice(self):
        other = PositionAssignment.objects.get(employee__user_account__email="carla@bold.gt", is_active=True)
        response = self.actor_client.post("/api/v2/projects/", {
            "unit": str(self.marketing.pk), "owner_assignment": str(self.recipient_assignment.pk),
            "name": "Revocación del aviso en vuelo", "status": "active", "member_ids": [str(other.pk)],
        }, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        notification = Notification.objects.get(project_id=response.data["id"], recipient_assignment=other)
        self.assertTrue(async_to_sync(notification_resource_is_readable)(str(other.pk), str(notification.pk)))
        self.actor_client.patch(f"/api/v2/projects/{response.data['id']}/", {"member_ids": []}, format="json")
        self.assertFalse(async_to_sync(notification_resource_is_readable)(str(other.pk), str(notification.pk)))
        self.assertFalse(async_to_sync(notification_resource_is_readable)(str(self.recipient_assignment.pk), str(notification.pk)))

    def test_collaborator_notice_is_rolled_back_with_its_write(self):
        task = self.create_task()
        other = PositionAssignment.objects.get(employee__user_account__email="carla@bold.gt", is_active=True)
        with self.assertRaises(RuntimeError):
            with transaction.atomic():
                TaskFollower.objects.create(task_id=task["id"], assignment=other, notification_level="all", added_by_assignment=self.actor_assignment)
                raise RuntimeError("cancelar transacción")
        self.assertFalse(Notification.objects.filter(recipient_assignment=other).exists())
        self.assertFalse(TaskFollower.objects.filter(task_id=task["id"], assignment=other).exists())

    def test_notification_websocket_requires_matching_single_use_ticket(self):
        _, session = create_session(self.recipient, RequestFactory().get("/", REMOTE_ADDR="127.0.0.1"))
        ticket = issue_ws_ticket(
            self.recipient, session, self.recipient_assignment.id, None, "notifications"
        )

        async def scenario():
            communicator = WebsocketCommunicator(
                application,
                f"/ws/notifications/?ticket={ticket}",
                headers=[(b"origin", b"http://localhost:5173")],
            )
            connected, _ = await communicator.connect()
            self.assertTrue(connected)
            await communicator.disconnect()
            replay = WebsocketCommunicator(
                application,
                f"/ws/notifications/?ticket={ticket}",
                headers=[(b"origin", b"http://localhost:5173")],
            )
            connected_again, code = await replay.connect()
            self.assertFalse(connected_again)
            self.assertEqual(code, 4403)

        async_to_sync(scenario)()

    def test_task_collaborator_notification_arrives_over_websocket(self):
        task = self.create_task()
        other = UserAccount.objects.get(email="carla@bold.gt")
        assignment = PositionAssignment.objects.get(employee=other.employee, is_active=True)
        _, session = create_session(other, RequestFactory().get("/", REMOTE_ADDR="127.0.0.1"))
        ticket = issue_ws_ticket(other, session, assignment.id, None, "notifications")

        async def scenario():
            communicator = WebsocketCommunicator(
                application, f"/ws/notifications/?ticket={ticket}",
                headers=[(b"origin", b"http://localhost:5174")],
            )
            try:
                connected, _ = await communicator.connect()
                self.assertTrue(connected)
                self.assertEqual((await communicator.receive_json_from())["event_type"], "control.ready")
                response = await database_sync_to_async(self.actor_client.post)(
                    "/api/v2/task-followers/", {"task": task["id"], "assignment": str(assignment.pk), "notification_level": "all"}, format="json",
                )
                self.assertEqual(response.status_code, 201, response.data)
                event = await communicator.receive_json_from(timeout=5)
                self.assertEqual(event["event_type"], "notification.created")
                self.assertEqual(event["payload"]["type"], "task.collaborator_added")
                self.assertEqual(event["payload"]["route"]["task_id"], task["id"])
            finally:
                await communicator.disconnect()

        async_to_sync(scenario)()
