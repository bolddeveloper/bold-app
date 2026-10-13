"""Prepared collaboration checks; run only after the user authorizes tests."""
from asgiref.sync import async_to_sync
from channels.db import database_sync_to_async
from channels.layers import get_channel_layer
from channels.testing import WebsocketCommunicator
from django.test import RequestFactory, TransactionTestCase, override_settings

from boldApp.autenticacion.services import create_session, issue_ws_ticket
from boldApp.core.models import Employee, JobRole, JobRolePermission, OrganizationalUnit, Permission, Position, PositionAssignment, UserAccount
from boldApp.hojas.document import blank
from boldApp.hojas.models import Member, Workbook
from config.asgi import application


@override_settings(SECURE_SSL_REDIRECT=False, CORS_ALLOWED_ORIGINS=["http://localhost:5174"], CHANNEL_LAYERS={"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}})
class SheetCollaborationTests(TransactionTestCase):
    def setUp(self):
        unit = OrganizationalUnit.objects.create(name="Hojas", unit_type="department", sensitivity_level="low")
        role = JobRole.objects.create(title="Editor")
        employee = Employee.objects.create(full_name="Lector de Hojas")
        self.account = UserAccount.objects.create_user(email="sheets-reader@bold.gt", employee=employee, password="Prepared-test-password-2026!")
        self.assignment = PositionAssignment.objects.create(employee=employee, position=Position.objects.create(unit=unit, job_role=role))
        permission, _ = Permission.objects.get_or_create(code="sheets.file.read", defaults={"module_code": "sheets", "resource": "file", "action": "read"})
        JobRolePermission.objects.create(job_role=role, permission=permission, effect="allow", scope_type="own_unit")
        owner_employee = Employee.objects.create(full_name="Propietario")
        owner = UserAccount.objects.create_user(email="sheets-owner@bold.gt", employee=owner_employee, password="Prepared-test-password-2026!")
        owner_assignment = PositionAssignment.objects.create(employee=owner_employee, position=Position.objects.create(unit=unit, job_role=role))
        document = blank("Compartido")
        self.file = Workbook.objects.create(id=document["id"], name=document["name"], document=document, owner=owner, creator=owner_assignment)
        Member.objects.create(workbook=self.file, account=self.account, role="reader")
        _, self.session = create_session(self.account, RequestFactory().get("/", REMOTE_ADDR="127.0.0.1"))

    def test_revocation_closes_the_socket_and_tickets_cannot_be_replayed(self):
        ticket = issue_ws_ticket(self.account, self.session, self.assignment.id, self.file.id, "sheets")
        path = f"/ws/sheets/{self.file.id}/?ticket={ticket}"
        headers = [(b"origin", b"http://localhost:5174")]

        async def scenario():
            socket = WebsocketCommunicator(application, path, headers=headers)
            self.assertTrue((await socket.connect())[0])
            await database_sync_to_async(lambda: Member.objects.filter(workbook=self.file, account=self.account).delete())()
            await get_channel_layer().group_send("sheet_" + str(self.file.id), {"type": "sheet.changed", "data": {"revision": 1}})
            self.assertEqual(await socket.receive_json_from(), {"revoked": True})
            closed = await socket.receive_output()
            self.assertEqual(closed["code"], 4403)
            await socket.disconnect()
            replay = WebsocketCommunicator(application, path, headers=headers)
            self.assertFalse((await replay.connect())[0])
            await replay.disconnect()

        async_to_sync(scenario)()
