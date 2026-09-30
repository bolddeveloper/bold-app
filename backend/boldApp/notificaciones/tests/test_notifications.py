from asgiref.sync import async_to_sync
from channels.testing import WebsocketCommunicator
from django.core.management import call_command
from django.test import RequestFactory, TransactionTestCase, override_settings
from rest_framework.test import APIClient

from boldApp.autenticacion.services import create_session, issue_ws_ticket
from boldApp.core.models import OrganizationalUnit, PositionAssignment, UserAccount
from boldApp.notificaciones.models import Notification
from boldApp.tareas.models import Project, TaskStatus
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
