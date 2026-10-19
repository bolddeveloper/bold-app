from asgiref.sync import async_to_sync
from channels.db import database_sync_to_async
from channels.testing import WebsocketCommunicator
from django.test import RequestFactory, TransactionTestCase
from rest_framework.test import APIClient
from boldApp.autenticacion.services import create_session, issue_ws_ticket
from boldApp.core.models import Employee, UserAccount, OrganizationalUnit, JobRole, Position, PositionAssignment
from boldApp.notificaciones.models import Notification
from config.asgi import application
from .socket_helpers import receive_event


class NotificationMutationSyncTests(TransactionTestCase):
    def setUp(self):
        unit = OrganizationalUnit.objects.create(name="Prueba", unit_type="department", sensitivity_level="low")
        role = JobRole.objects.create(title="Prueba")
        self.accounts = []
        for name in ("uno", "otro"):
            employee = Employee.objects.create(full_name=name)
            account = UserAccount.objects.create_user(email=f"sync.{name}@bold.gt", employee=employee)
            assignment = PositionAssignment.objects.create(employee=employee, position=Position.objects.create(unit=unit, job_role=role))
            self.accounts.append((account, assignment))
        self.row = Notification.objects.create(recipient_assignment=self.accounts[0][1], title="Prueba privada", type="test")

    def socket(self, index):
        account, assignment = self.accounts[index]
        _, session = create_session(account, RequestFactory().get("/", REMOTE_ADDR="127.0.0.1"))
        ticket = issue_ws_ticket(account, session, assignment.pk, None, "notifications")
        return WebsocketCommunicator(application, f"/ws/notifications/?ticket={ticket}", headers=[(b"origin", b"http://localhost:5174")])

    def mutate(self, suffix):
        account, assignment = self.accounts[0]
        client = APIClient(); client.force_authenticate(account); client.credentials(HTTP_X_ASSIGNMENT_ID=str(assignment.pk))
        return client.post("/api/v2/notifications/" + suffix)

    def test_read_unread_and_clear_sync_private_tabs_without_polling(self):
        first, second, outsider = self.socket(0), self.socket(0), self.socket(1)
        async def scenario():
            for socket in (first, second, outsider):
                self.assertTrue((await socket.connect())[0]); await receive_event(socket, "control.ready")
            for suffix in (f"{self.row.pk}/mark-read/", f"{self.row.pk}/mark-unread/", "mark-all-read/", "clear/"):
                response = await database_sync_to_async(self.mutate)(suffix)
                self.assertEqual(response.status_code, 200, response.data)
                for socket in (first, second):
                    event = await receive_event(socket, "notification.invalidated")
                    self.assertEqual(event["payload"], {})
                    self.assertEqual(event["entity_id"], str(self.accounts[0][1].pk))
                for _ in range(10):
                    if await outsider.receive_nothing(timeout=.03):
                        break
                    event = await outsider.receive_json_from()
                    self.assertNotEqual(event["event_type"], "notification.invalidated")
            for socket in (first, second, outsider):
                await socket.disconnect()
        async_to_sync(scenario)()
