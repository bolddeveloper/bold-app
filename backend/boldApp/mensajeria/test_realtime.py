import asyncio
import json
import uuid
from datetime import timedelta
from unittest.mock import patch

from asgiref.sync import async_to_sync
from channels.db import database_sync_to_async
from channels.layers import get_channel_layer
from channels.testing import WebsocketCommunicator
from django.core.cache import cache
from django.test import RequestFactory, TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from config.asgi import application
from boldApp.autenticacion.services import create_session, issue_ws_ticket, revoke_session
from boldApp.core.models import Employee, JobRole, OrganizationalUnit, Position, PositionAssignment, UserAccount
from boldApp.notificaciones.tests.socket_helpers import receive_event, receive_close
from .events import pending_event
from .models import DirectConversation, DirectMessage


@override_settings(MESSAGING_PILOT_ENABLED=False)
class RealtimeChatTests(TransactionTestCase):
    def setUp(self):
        cache.clear()
        unit = OrganizationalUnit.objects.create(name="Prueba", sensitivity_level="low", unit_type="department")
        role = JobRole.objects.create(title="Chat")
        self.people = []
        for name in ("alpha", "beta", "owner"):
            employee = Employee.objects.create(full_name=name)
            account = UserAccount.objects.create_user(email=f"{name}@bold.gt", employee=employee, is_superuser=name == "owner")
            assignment = PositionAssignment.objects.create(employee=employee, position=Position.objects.create(unit=unit, job_role=role))
            _, session = create_session(account, RequestFactory().get("/", REMOTE_ADDR="127.0.0.1"))
            self.people.append((account, assignment, session))
        first, second = sorted([row[0].employee_id for row in self.people[:2]])
        self.conversation = DirectConversation.objects.create(first_employee_id=first, second_employee_id=second)
        self.root = f"/api/v2/messaging/conversations/{self.conversation.pk}/"

    def client_for(self, index):
        account, assignment, _ = self.people[index]
        client = APIClient()
        client.force_authenticate(account)
        client.credentials(HTTP_X_ASSIGNMENT_ID=str(assignment.pk))
        return client

    def socket_for(self, index):
        account, assignment, session = self.people[index]
        ticket = issue_ws_ticket(account, session, assignment.pk, None, "notifications")
        return WebsocketCommunicator(application, f"/ws/notifications/?ticket={ticket}", headers=[(b"origin", b"http://localhost:5174")])

    def post(self, index, suffix, data):
        return self.client_for(index).post(self.root + suffix, data, format="json")

    async def no_chat(self, socket):
        for _ in range(20):
            if await socket.receive_nothing(timeout=.05):
                return
            event = await socket.receive_json_from()
            self.assertEqual(event.get("entity_type"), "security_control")
        self.fail("Unexpected socket flood")

    def test_two_accounts_receive_live_messages_and_truthful_delivery_read(self):
        sockets = [self.socket_for(i) for i in range(3)]
        async def scenario():
            for socket in sockets:
                self.assertTrue((await socket.connect())[0])
                await receive_event(socket, "control.ready")
            response = await database_sync_to_async(self.post)(0, "messages/", {"body": "Mensaje privado", "client_id": str(uuid.uuid4())})
            self.assertEqual(response.status_code, 201)
            message = response.data["message"]
            notice = await receive_event(sockets[1], "notification.created")
            self.assertEqual(notice["payload"]["module"], "messaging")
            self.assertNotIn("Mensaje privado", notice["payload"]["title"])
            for index in (0, 1):
                event = await receive_event(sockets[index], "messaging.message.created")
                row = event["payload"]["messages"][0]
                self.assertEqual(row["body"], "Mensaje privado")
                self.assertEqual(row["can_edit"], index == 0)
                self.assertIsNone(row["delivered_at"])
            self.assertIsNone(await database_sync_to_async(lambda: DirectMessage.objects.get(pk=message["id"]).delivered_at)())
            delivered = await database_sync_to_async(self.post)(1, "receipts/", {"message_ids": [message["id"]], "state": "delivered"})
            self.assertEqual(delivered.status_code, 200)
            event = await receive_event(sockets[0], "messaging.receipt.updated")
            self.assertIsNotNone(event["payload"]["receipts"][0]["delivered_at"])
            self.assertIsNone(event["payload"]["receipts"][0]["read_at"])
            peer_delivery = await receive_event(sockets[1], "messaging.receipt.updated")
            self.assertEqual(peer_delivery["payload"]["unread"]["count"], 1)
            read = await database_sync_to_async(self.post)(1, "receipts/", {"message_ids": [message["id"]], "state": "read"})
            self.assertEqual(read.status_code, 200)
            event = await receive_event(sockets[0], "messaging.receipt.updated")
            self.assertIsNotNone(event["payload"]["receipts"][0]["read_at"])
            await receive_event(sockets[1], "notification.invalidated")
            peer_read = await receive_event(sockets[1], "messaging.receipt.updated")
            self.assertEqual(peer_read["payload"]["unread"]["count"], 0)
            self.assertEqual(peer_read["payload"]["unread"]["version"], 2)
            await self.no_chat(sockets[2])
            # Even a misrouted internal hint cannot grant the owner membership.
            await get_channel_layer().group_send(f"messaging_employee_{self.people[2][0].employee_id}", {"type": "messaging.changed", "kind": "message.created", "conversation_id": str(self.conversation.pk), "message_ids": [message["id"]]})
            await self.no_chat(sockets[2])
            for socket in sockets:
                await socket.disconnect()
        async_to_sync(scenario)()

    def test_only_recipient_can_acknowledge_and_read_is_monotonic(self):
        sent = self.post(0, "messages/", {"body": "Hola", "client_id": str(uuid.uuid4())}).data["message"]
        body = {"message_ids": [sent["id"]], "state": "read"}
        self.assertEqual(self.post(0, "receipts/", body).status_code, 404)
        self.assertEqual(self.post(2, "receipts/", body).status_code, 404)
        result = self.post(1, "receipts/", body)
        self.assertEqual(result.status_code, 200)
        first = result.data["receipts"][0]
        self.assertIsNotNone(first["delivered_at"])
        self.assertIsNotNone(first["read_at"])
        with patch("boldApp.mensajeria.views.publish_change") as publish:
            repeated = self.post(1, "receipts/", {**body, "state": "delivered"})
            publish.assert_not_called()
        self.assertEqual(repeated.data["receipts"][0], first)
        self.assertEqual(self.post(1, "receipts/", {**body, "message_ids": [sent["id"], str(uuid.uuid4())]}).status_code, 404)
        self.assertEqual(self.post(1, "receipts/", {**body, "read_at": "fake"}).status_code, 400)
        self.assertEqual(self.post(1, "receipts/", {**body, "message_ids": [sent["id"]] * 101}).status_code, 400)

    def test_preferences_are_persistent_and_cannot_change_other_accounts(self):
        url = "/api/v2/messaging/preferences/"
        first, second = self.client_for(0), self.client_for(1)
        self.assertEqual(first.get(url).data, {"enter_behavior": "send"})
        self.assertEqual(first.put(url, {"enter_behavior": "newline"}, format="json").status_code, 200)
        self.assertEqual(self.client_for(0).get(url).data["enter_behavior"], "newline")
        self.assertEqual(second.get(url).data["enter_behavior"], "send")
        self.assertEqual(first.put(url, {"enter_behavior": "other"}, format="json").status_code, 400)
        self.assertEqual(first.put(url, {"enter_behavior": "send", "account": str(self.people[1][0].pk)}, format="json").status_code, 400)

    def test_offline_backlog_is_private_bounded_and_does_not_imply_delivery(self):
        DirectMessage.objects.bulk_create([DirectMessage(conversation=self.conversation, author=self.people[0][0].employee, client_id=uuid.uuid4(), body=f"Pendiente {i}") for i in range(105)])
        payload = pending_event(self.people[1][0].employee_id)["payload"]
        self.assertEqual(len(payload["messages"]), 100)
        self.assertIsNone(pending_event(self.people[2][0].employee_id))
        self.assertEqual(DirectMessage.objects.filter(delivered_at__isnull=True).count(), 105)
        socket = self.socket_for(1)
        async def scenario():
            self.assertTrue((await socket.connect())[0])
            await receive_event(socket, "control.ready")
            event = await receive_event(socket, "messaging.sync")
            self.assertEqual(len(event["payload"]["messages"]), 100)
            await socket.disconnect()
        async_to_sync(scenario)()

    def test_session_revocation_closes_shared_socket(self):
        socket = self.socket_for(1)
        async def scenario():
            self.assertTrue((await socket.connect())[0])
            await receive_event(socket, "control.ready")
            await database_sync_to_async(revoke_session)(self.people[1][2], reason="chat_test")
            self.assertEqual((await receive_close(socket))["code"], 4401)
            await socket.disconnect()
        async_to_sync(scenario)()

    def test_live_edits_are_author_scoped(self):
        sent = self.post(0, "messages/", {"body": "Original", "client_id": str(uuid.uuid4())}).data["message"]
        # Acknowledge offline data before connecting to keep this scenario focused.
        self.post(1, "receipts/", {"message_ids": [sent["id"]], "state": "delivered"})
        socket = self.socket_for(1)
        async def scenario():
            self.assertTrue((await socket.connect())[0])
            await receive_event(socket, "control.ready")
            url = self.root + f"messages/{sent['id']}/"
            response = await database_sync_to_async(lambda: self.client_for(0).patch(url, {"body": "Edición en vivo", "version": 1}, format="json"))()
            self.assertEqual(response.status_code, 200)
            event = await receive_event(socket, "messaging.message.updated")
            self.assertEqual(event["payload"]["messages"][0]["body"], "Edición en vivo")
            self.assertFalse(event["payload"]["messages"][0]["can_edit"])
            await socket.disconnect()
        async_to_sync(scenario)()

    def test_non_it_socket_keeps_control_but_has_no_chat_backlog_or_messages(self):
        unit = self.people[0][1].position.unit
        outside = OrganizationalUnit.objects.create(name="Fuera del piloto", unit_type="department", sensitivity_level="low")
        position = self.people[1][1].position
        position.unit = outside; position.save(update_fields=["unit"])
        message = DirectMessage.objects.create(conversation=self.conversation, author=self.people[0][0].employee, client_id=uuid.uuid4(), body="No filtrar")
        with self.settings(MESSAGING_PILOT_ENABLED=True, MESSAGING_PILOT_UNIT_IDS=(str(unit.pk),)):
            socket = self.socket_for(1)
            async def scenario():
                self.assertTrue((await socket.connect())[0])
                await receive_event(socket, "control.ready")
                await self.no_chat(socket)
                # Even a wrongly routed internal event may not reveal history.
                await get_channel_layer().group_send(f"messaging_employee_{self.people[1][0].employee_id}", {"type":"messaging.changed", "conversation_id":str(self.conversation.pk), "kind":"message.created", "message_ids":[str(message.pk)]})
                await self.no_chat(socket)
                await socket.disconnect()
            async_to_sync(scenario)()

    def test_open_socket_loses_chat_when_its_active_assignment_leaves_it(self):
        unit = self.people[0][1].position.unit
        outside = OrganizationalUnit.objects.create(name="Otra unidad", unit_type="department", sensitivity_level="low")
        with self.settings(MESSAGING_PILOT_ENABLED=True, MESSAGING_PILOT_UNIT_IDS=(str(unit.pk),)):
            socket = self.socket_for(1)
            async def move():
                await database_sync_to_async(lambda: Position.objects.filter(pk=self.people[1][1].position_id).update(unit=outside))()
            async def scenario():
                self.assertTrue((await socket.connect())[0]); await receive_event(socket, "control.ready")
                await move()
                message = await database_sync_to_async(DirectMessage.objects.create)(conversation=self.conversation, author=self.people[0][0].employee, client_id=uuid.uuid4(), body="Evento tras salir de IT")
                await get_channel_layer().group_send(f"messaging_employee_{self.people[1][0].employee_id}", {"type":"messaging.changed", "conversation_id":str(self.conversation.pk), "kind":"message.created", "message_ids":[str(message.pk)]})
                await self.no_chat(socket); await socket.disconnect()
            async_to_sync(scenario)()
