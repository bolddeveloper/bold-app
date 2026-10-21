"""Integrated local checks: real login/cookies/CSRF/tickets, never company accounts."""
import uuid

from asgiref.sync import async_to_sync
from channels.db import database_sync_to_async
from channels.testing import WebsocketCommunicator
from django.conf import settings
from django.core.cache import cache
from django.test import TransactionTestCase, override_settings
from rest_framework.test import APIClient

from config.asgi import application
from boldApp.core.models import Employee, JobRole, OrganizationalUnit, Permission, Position, PositionAssignment, UserAccount
from boldApp.notificaciones.tests.socket_helpers import receive_close, receive_event


@override_settings(AUTH_MFA_REQUIRED=False, MESSAGING_PILOT_ENABLED=False)
class ChannelCookieSessionTests(TransactionTestCase):
    def setUp(self):
        cache.clear()
        for resource, action in (("channel", "read"), ("channel", "create"), ("channel", "manage"), ("message", "create"), ("message", "update")):
            Permission.objects.get_or_create(code=f"slack.{resource}.{action}", defaults={"module_code":"slack", "resource":resource, "action":action, "risk_level":"low"})
        self.clients = []
        self.assignments = []
        for index, name in enumerate(("IT", "Marketing")):
            unit = OrganizationalUnit.objects.create(name=name, unit_type="department", sensitivity_level="low")
            role = JobRole.objects.create(title=f"Empleado sintético {index}")
            employee = Employee.objects.create(full_name=f"Sesión sintética {index}")
            password = "Isolated-Only-2026!" + uuid.uuid4().hex
            account = UserAccount.objects.create_user(email=f"slack-cookie-test-{index}@bold.gt", employee=employee, password=password)
            assignment = PositionAssignment.objects.create(employee=employee, position=Position.objects.create(unit=unit, job_role=role))
            client = APIClient(enforce_csrf_checks=True)
            csrf = client.get("/api/v2/auth/session/").data["csrf_token"]
            login = client.post("/api/v2/auth/login/", {"email":account.email, "password":password}, format="json", HTTP_X_CSRFTOKEN=csrf)
            self.assertEqual(login.status_code, 200, login.data)
            self.assertTrue(login.data["authenticated"])
            csrf = client.get("/api/v2/auth/session/").data["csrf_token"]
            client.credentials(HTTP_X_ASSIGNMENT_ID=str(assignment.pk), HTTP_X_CSRFTOKEN=csrf)
            self.clients.append(client)
            self.assignments.append(assignment)
        self.assertNotEqual(*(client.cookies[settings.AUTH_SESSION_COOKIE_NAME].value for client in self.clients))
        opened = self.clients[0].post("/api/v2/messaging/channels/", {"unit_id":str(self.assignments[0].position.unit_id), "name":"Coordinación integrada"}, format="json")
        self.assertEqual(opened.status_code, 201, opened.data)
        self.channel_id = opened.data["id"]
        self.url = f"/api/v2/messaging/channels/{self.channel_id}/"

    def ticket(self, index):
        response = self.clients[index].post("/api/v2/auth/websocket-ticket/", {"channel":"notifications", "assignment":str(self.assignments[index].pk)}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        return response.data["ticket"]

    def send(self, index, body="Coordinación entre departamentos", **extra):
        return self.clients[index].post(self.url + "messages/", {"body":body, "client_id":str(uuid.uuid4()), **extra}, format="json")

    def test_cookie_sessions_enforce_csrf_and_ownership_without_force_authenticate(self):
        sent = self.send(0)
        self.assertEqual(sent.status_code, 201, sent.data)
        message = sent.data["message"]
        self.assertEqual(message["department"]["name"], "IT")
        history = self.clients[1].get(self.url + "messages/")
        self.assertEqual(history.status_code, 200)
        self.assertEqual(history.data["results"][0]["id"], message["id"])
        edit_url = self.url + "messages/" + message["id"] + "/"
        self.assertEqual(self.clients[1].patch(edit_url, {"body":"Ajeno", "version":1}, format="json").status_code, 403)
        edited = self.clients[0].patch(edit_url, {"body":"Autor corrigió el contexto", "version":1}, format="json")
        self.assertEqual(edited.status_code, 200)
        reply = self.send(1, "Recibido en Marketing", parent_id=message["id"])
        self.assertEqual(reply.status_code, 201, reply.data)
        self.assertEqual(reply.data["message"]["department"]["name"], "Marketing")
        self.assertEqual(self.clients[0].get(self.url + "messages/?parent=" + message["id"]).data["results"][0]["body"], "Recibido en Marketing")
        missing_csrf = APIClient(enforce_csrf_checks=True)
        missing_csrf.cookies = self.clients[0].cookies.copy()
        missing_csrf.credentials(HTTP_X_ASSIGNMENT_ID=str(self.assignments[0].pk))
        self.assertEqual(missing_csrf.post(self.url + "messages/", {"body":"No", "client_id":str(uuid.uuid4())}, format="json").status_code, 403)
        foreign = self.clients[0].post("/api/v2/auth/websocket-ticket/", {"channel":"notifications", "assignment":str(self.assignments[1].pk)}, format="json")
        self.assertEqual(foreign.status_code, 403)

    def test_authenticated_http_send_reaches_both_sockets_and_logout_revokes_only_its_session(self):
        sockets = [WebsocketCommunicator(application, f"/ws/notifications/?ticket={self.ticket(index)}", headers=[(b"origin", b"http://localhost:5174")]) for index in range(2)]

        async def scenario():
            try:
                for socket in sockets:
                    self.assertTrue((await socket.connect())[0])
                    await receive_event(socket, "control.ready")
                response = await database_sync_to_async(self.send)(0)
                self.assertEqual(response.status_code, 201)
                for socket in sockets:
                    event = await receive_event(socket, "slack.changed")
                    self.assertEqual(event["payload"]["channel_id"], self.channel_id)
                logout = await database_sync_to_async(self.clients[0].post)("/api/v2/auth/logout/", {}, format="json")
                self.assertEqual(logout.status_code, 204)
                self.assertEqual((await receive_close(sockets[0]))["code"], 4401)
                self.assertEqual((await database_sync_to_async(self.clients[0].get)(self.url)).status_code, 401)
                self.assertEqual((await database_sync_to_async(self.send)(1, "La segunda sesión continúa activa")).status_code, 201)
                self.assertEqual((await receive_event(sockets[1], "slack.changed"))["payload"]["activity_version"], 2)
            finally:
                for socket in sockets:
                    await socket.disconnect()
        async_to_sync(scenario)()
