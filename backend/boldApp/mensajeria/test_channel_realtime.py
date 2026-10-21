import uuid
from asgiref.sync import async_to_sync
from channels.db import database_sync_to_async
from channels.layers import get_channel_layer
from channels.testing import WebsocketCommunicator
from django.core.cache import cache
from django.test import RequestFactory, TransactionTestCase, override_settings
from rest_framework.test import APIClient

from config.asgi import application
from boldApp.autenticacion.services import create_session, issue_ws_ticket
from boldApp.core.models import Employee, JobRole, OrganizationalUnit, Position, PositionAssignment, UserAccount, Permission, JobRolePermission
from boldApp.notificaciones.tests.socket_helpers import receive_event
from .models import DepartmentChannel


@override_settings(MESSAGING_PILOT_ENABLED=False)
class ChannelSocketTests(TransactionTestCase):
    def setUp(self):
        cache.clear()
        # TransactionTestCase flushes data-migration rows between methods.
        for resource, action in (("channel", "read"), ("channel", "create"), ("channel", "manage"), ("channel", "access"), ("message", "create"), ("message", "update")):
            Permission.objects.get_or_create(code=f"slack.{resource}.{action}", defaults={"module_code":"slack", "resource":resource, "action":action, "risk_level":"low"})
        self.people = []
        for name in ("alpha", "beta"):
            unit = OrganizationalUnit.objects.create(name=name, sensitivity_level="low", unit_type="department")
            role = JobRole.objects.create(title=name)
            employee = Employee.objects.create(full_name=name)
            account = UserAccount.objects.create_user(email=f"slack-test-{name}@bold.gt", employee=employee)
            assignment = PositionAssignment.objects.create(employee=employee, position=Position.objects.create(unit=unit, job_role=role))
            _, session = create_session(account, RequestFactory().get("/", REMOTE_ADDR="127.0.0.1"))
            self.people.append((account, assignment, session))
        self.channel = DepartmentChannel.objects.create(unit=self.people[0][1].position.unit, name="Prueba de canales", creator=self.people[0][1])

    def socket(self, index):
        account, assignment, session = self.people[index]
        ticket = issue_ws_ticket(account, session, assignment.pk, None, "notifications")
        return WebsocketCommunicator(application, f"/ws/notifications/?ticket={ticket}", headers=[(b"origin", b"http://localhost:5174")])

    def send(self):
        account, assignment, _ = self.people[0]
        client = APIClient()
        client.force_authenticate(account)
        client.credentials(HTTP_X_ASSIGNMENT_ID=str(assignment.pk))
        return client.post(f"/api/v2/messaging/channels/{self.channel.pk}/messages/", {"body": "Contenido no emitido en el hint", "client_id": str(uuid.uuid4())}, format="json")

    def restrict_second(self):
        JobRolePermission.objects.create(job_role=self.people[1][1].position.job_role,
            permission=Permission.objects.get(code="slack.channel.read"), scope_type="global", effect="deny")

    def follow_second(self):
        account,assignment,_=self.people[1]
        client=APIClient();client.force_authenticate(account);client.credentials(HTTP_X_ASSIGNMENT_ID=str(assignment.pk))
        return client.put(f"/api/v2/messaging/channels/{self.channel.pk}/following/",{"following":True},format="json")

    def test_followed_channel_sends_a_generic_bell_notice_and_private_state_on_the_same_socket(self):
        sockets=[self.socket(index) for index in range(2)]
        async def scenario():
            try:
                for socket in sockets:
                    self.assertTrue((await socket.connect())[0]);await receive_event(socket,"control.ready")
                result=await database_sync_to_async(self.follow_second)();self.assertEqual(result.status_code,200,result.data)
                state=await receive_event(sockets[1],"slack.changed");self.assertEqual(state["payload"]["kind"],"state.changed")
                result=await database_sync_to_async(self.send)();self.assertEqual(result.status_code,201,result.data)
                notice=await receive_event(sockets[1],"notification.created")
                self.assertEqual(notice["payload"]["route"]["module"],"slack")
                self.assertNotIn("Contenido",str(notice));self.assertNotIn("body",notice["payload"])
                for socket in sockets:
                    change=await receive_event(socket,"slack.changed");self.assertEqual(change["payload"]["kind"],"message.created")
            finally:
                for socket in sockets:await socket.disconnect()
        async_to_sync(scenario)()

    def test_two_departments_receive_same_socket_hint_without_private_content(self):
        sockets = [self.socket(index) for index in range(2)]

        async def scenario():
            try:
                for socket in sockets:
                    self.assertTrue((await socket.connect())[0])
                    await receive_event(socket, "control.ready")
                response = await database_sync_to_async(self.send)()
                self.assertEqual(response.status_code, 201, response.data)
                for socket in sockets:
                    event = await receive_event(socket, "slack.changed")
                    self.assertEqual(event["payload"]["channel_id"], str(self.channel.pk))
                    self.assertEqual(event["payload"]["activity_version"], 1)
                    self.assertNotIn("Contenido", str(event))
            finally:
                for socket in sockets:
                    await socket.disconnect()
        async_to_sync(scenario)()

    def test_live_restriction_blocks_even_misrouted_hint_on_existing_socket(self):
        socket = self.socket(1)

        async def scenario():
            try:
                self.assertTrue((await socket.connect())[0])
                await receive_event(socket, "control.ready")
                await database_sync_to_async(self.restrict_second)()
                await get_channel_layer().group_send("slack_watch", {"type": "slack.changed", "channel_id": str(self.channel.pk), "kind": "message.created"})
                # Policy control messages can precede the hint, but no channel
                # metadata or content may escape after permission revocation.
                for _ in range(12):
                    if await socket.receive_nothing(timeout=.1):
                        break
                    event = await socket.receive_json_from()
                    self.assertNotEqual(event.get("event_type"), "slack.changed")
            finally:
                await socket.disconnect()
        async_to_sync(scenario)()

    def test_private_invitation_revocation_invalidates_the_existing_security_lease(self):
        from .models import ChannelAccessRule
        self.channel.visibility="private";self.channel.save(update_fields=["visibility"])
        ChannelAccessRule.objects.bulk_create([ChannelAccessRule(channel=self.channel,employee=person[1].employee,access="write") for person in self.people])
        socket=self.socket(1)
        def revoke():
            account,assignment,_=self.people[0]
            client=APIClient();client.force_authenticate(account);client.credentials(HTTP_X_ASSIGNMENT_ID=str(assignment.pk))
            return client.patch(f"/api/v2/messaging/channels/{self.channel.pk}/access/",{"visibility":"private","version":1,
                "members":[{"employee_id":str(assignment.employee_id),"access":"write"}]},format="json")
        async def scenario():
            try:
                self.assertTrue((await socket.connect())[0])
                initial=await receive_event(socket,"control.ready")
                response=await database_sync_to_async(revoke)()
                self.assertEqual(response.status_code,200,response.data)
                revision=await receive_event(socket,"permissions.revision")
                self.assertTrue(revision["payload"]["force"])
                self.assertNotEqual(initial["payload"]["state"],revision["payload"]["state"])
                self.assertNotIn(str(self.channel.pk),str(revision),"a revoked channel's identifier is not a control payload")
                await get_channel_layer().group_send("slack_watch",{"type":"slack.changed","channel_id":str(self.channel.pk),"kind":"message.created"})
                for _ in range(12):
                    if await socket.receive_nothing(timeout=.1):break
                    event=await socket.receive_json_from()
                    self.assertNotEqual(event.get("event_type"),"slack.changed")
            finally:
                await socket.disconnect()
        async_to_sync(scenario)()
