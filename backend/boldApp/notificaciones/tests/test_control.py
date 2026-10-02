from datetime import timedelta
from unittest.mock import patch

from asgiref.sync import async_to_sync
from channels.db import database_sync_to_async
from channels.layers import get_channel_layer
from channels.testing import WebsocketCommunicator
from django.test import RequestFactory, TransactionTestCase, override_settings
from django.db import transaction
from django.utils import timezone
from rest_framework.test import APIClient

from boldApp.autenticacion.models import AuthSession
from boldApp.autenticacion.services import create_session, issue_ws_ticket, revoke_session
from boldApp.core.models import (AccessGrant, Employee, GrantAuthority, JobRole, JobRolePermission,
                                 OrganizationalUnit, Permission, Position, PositionAssignment, UserAccount)
from boldApp.core.security_control import security_snapshot
from boldApp.permisos.models import PermissionPolicyState
from config.asgi import application


@override_settings(SECURE_SSL_REDIRECT=False)
class SecurityControlTests(TransactionTestCase):
    def setUp(self):
        self.unit = OrganizationalUnit.objects.create(name="Equipo", unit_type="department", sensitivity_level="low")
        employee = Employee.objects.create(full_name="Colaborador de pruebas")
        self.account = UserAccount.objects.create_user(email="control@bold.gt", employee=employee, password="Solo pruebas 2026!")
        role = JobRole.objects.create(title="Colaborador")
        self.assignment = PositionAssignment.objects.create(employee=employee, position=Position.objects.create(unit=self.unit, job_role=role))
        _, self.session = create_session(self.account, RequestFactory().get("/", REMOTE_ADDR="127.0.0.1"))
        self.permission, _ = Permission.objects.get_or_create(code="tasks.task.read", defaults={"module_code": "tasks", "resource": "task", "action": "read"})

    def socket(self):
        ticket = issue_ws_ticket(self.account, self.session, self.assignment.id, None, "notifications")
        return WebsocketCommunicator(application, f"/ws/notifications/?ticket={ticket}",
                                     headers=[(b"origin", b"http://localhost:5173")])

    def test_ordinary_employee_receives_only_minimal_control_and_policy_changes(self):
        socket = self.socket()

        async def scenario():
            self.assertTrue((await socket.connect())[0])
            ready = await socket.receive_json_from()
            self.assertEqual(ready["event_type"], "control.ready")
            self.assertEqual(ready["payload"]["assignment"], str(self.assignment.id))
            self.assertEqual(ready["payload"]["capabilities"], {"permissions_revision": True})
            self.assertEqual(set(ready["payload"]), {"revision", "state", "context", "boundary_ms", "assignment",
                                                    "sequence", "capabilities", "lease_ms", "force"})
            self.assertFalse(ready["payload"]["force"])
            await get_channel_layer().group_send("permission_watch", {"type": "permission.changed", "revision": None})
            update = await socket.receive_json_from()
            self.assertEqual(update["event_type"], "permissions.revision")
            self.assertFalse(update["payload"]["force"])
            self.assertGreater(update["payload"]["sequence"], ready["payload"]["sequence"])
            await database_sync_to_async(lambda: JobRolePermission.objects.create(job_role=self.assignment.position.job_role,
                permission=self.permission, effect="allow", scope_type="own_unit"))()
            for _ in range(5):
                changed = await socket.receive_json_from()
                if changed["payload"]["force"]:
                    break
            self.assertTrue(changed["payload"]["force"])
            # A second signal for the same committed state carries no invalidation.
            await get_channel_layer().group_send("permission_watch", {"type": "permission.changed", "revision": None})
            duplicate = await socket.receive_json_from()
            self.assertFalse(duplicate["payload"]["force"])
            await socket.disconnect()

        async_to_sync(scenario)()

    def test_control_subscribes_to_assignment_and_closes_when_released(self):
        socket = self.socket()

        async def scenario():
            await socket.connect()
            await socket.receive_json_from()
            await database_sync_to_async(lambda: PositionAssignment.objects.filter(pk=self.assignment.id).update(
                is_active=False, released_at=timezone.now()))()
            await get_channel_layer().group_send(f"assignment_{self.assignment.id}", {"type": "assignment.changed"})
            self.assertEqual((await socket.receive_output())["code"], 4403)
            await socket.disconnect()

        async_to_sync(scenario)()

    def test_session_revocation_closes_control_immediately(self):
        socket = self.socket()

        async def scenario():
            await socket.connect()
            await socket.receive_json_from()
            await database_sync_to_async(revoke_session)(self.session)
            self.assertEqual((await socket.receive_output())["code"], 4401)
            await socket.disconnect()

        async_to_sync(scenario)()

    def test_daily_and_idle_expiry_close_an_otherwise_idle_socket(self):
        for field in ("expires_at", "idle_expires_at"):
            AuthSession.objects.filter(pk=self.session.id).update(
                expires_at=timezone.now() + timedelta(minutes=5), idle_expires_at=None,
            )
            AuthSession.objects.filter(pk=self.session.id).update(**{field: timezone.now() + timedelta(seconds=0.4)})
            socket = self.socket()

            async def scenario():
                self.assertTrue((await socket.connect())[0])
                await socket.receive_json_from()
                self.assertEqual((await socket.receive_output(timeout=2))["code"], 4401)
                await socket.disconnect()

            async_to_sync(scenario)()

    def grant(self, **extra):
        now = timezone.now()
        return AccessGrant.objects.create(grantee_assignment=self.assignment, permission=self.permission,
            granted_by_assignment=self.assignment, scope_type="own_unit", effect="allow",
            valid_from=now - timedelta(minutes=1), valid_until=now + timedelta(minutes=10), reason="Prueba", **extra)

    def test_grant_start_expiry_and_parent_authority_change_temporal_state(self):
        now = timezone.now()
        # This test advances time by 11 min to expire a grant, not the session.
        # Running near 07:00 Guatemala previously hit daily logout instead and
        # returned a closed-session snapshot without "state". Daily expiry has
        # its own test above; do not weaken the production session deadline.
        AuthSession.objects.filter(pk=self.session.id).update(expires_at=now + timedelta(hours=1), idle_expires_at=None)
        parent = GrantAuthority.objects.create(assignment=self.assignment, granted_by_assignment=self.assignment,
            scope_type="own_unit", valid_from=now - timedelta(minutes=1), valid_until=now + timedelta(seconds=5))
        child = GrantAuthority.objects.create(assignment=self.assignment, granted_by_assignment=self.assignment,
            scope_type="own_unit", parent_authority=parent, valid_from=now - timedelta(minutes=1),
            valid_until=now + timedelta(minutes=5))
        grant = self.grant(source_authority=child)
        with patch("boldApp.core.security_control.timezone.now", return_value=now):
            before = security_snapshot(self.session.id, self.assignment.id)
        self.assertAlmostEqual(before["boundary_ms"], 5000, delta=50)
        with patch("boldApp.core.security_control.timezone.now", return_value=now + timedelta(seconds=6)):
            after = security_snapshot(self.session.id, self.assignment.id)
        self.assertNotEqual(before["state"], after["state"])
        self.assertEqual(before["revision"], after["revision"])
        # No model save or policy revision is necessary for a time-based change.
        AccessGrant.objects.filter(pk=grant.id).update(valid_from=now + timedelta(seconds=8))
        with patch("boldApp.core.security_control.timezone.now", return_value=now + timedelta(seconds=6)):
            pending = security_snapshot(self.session.id, self.assignment.id)
        with patch("boldApp.core.security_control.timezone.now", return_value=now + timedelta(seconds=9)):
            started = security_snapshot(self.session.id, self.assignment.id)
        self.assertNotEqual(pending["state"], started["state"])
        with patch("boldApp.core.security_control.timezone.now", return_value=now + timedelta(minutes=11)):
            expired = security_snapshot(self.session.id, self.assignment.id)
        self.assertNotEqual(started["state"], expired["state"])

    def test_mfa_deadline_changes_state_without_policy_mutation(self):
        now = timezone.now()
        AuthSession.objects.filter(pk=self.session.id).update(mfa_verified_at=now - timedelta(seconds=598), auth_strength="password_totp")
        with patch("boldApp.core.security_control.timezone.now", return_value=now):
            before = security_snapshot(self.session.id, self.assignment.id)
        with patch("boldApp.core.security_control.timezone.now", return_value=now + timedelta(seconds=3)):
            after = security_snapshot(self.session.id, self.assignment.id)
        self.assertAlmostEqual(before["boundary_ms"], 2000, delta=5)
        self.assertNotEqual(before["state"], after["state"])

    def test_timer_sends_temporal_invalidation_without_policy_event(self):
        grant = self.grant()
        AccessGrant.objects.filter(pk=grant.id).update(valid_until=timezone.now() + timedelta(seconds=0.4))
        socket = self.socket()

        async def scenario():
            await socket.connect()
            ready = await socket.receive_json_from()
            update = await socket.receive_json_from(timeout=2)
            self.assertEqual(update["payload"]["revision"], ready["payload"]["revision"])
            self.assertTrue(update["payload"]["force"])
            await socket.disconnect()

        async_to_sync(scenario)()

    def test_revision_http_recovers_temporal_state_and_accepts_legacy_client(self):
        client = APIClient()
        client.force_authenticate(self.account, self.session)
        legacy = client.get("/api/v2/permissions/revision/")
        self.assertEqual(legacy.status_code, 200)
        self.assertEqual(set(legacy.data), {"revision"})
        client.credentials(HTTP_X_ASSIGNMENT_ID=str(self.assignment.id))
        response = client.get("/api/v2/permissions/revision/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(response.data), {"revision", "state", "context", "boundary_ms"})

    def test_control_reads_current_revision_instead_of_forwarding_stale_broadcast(self):
        socket = self.socket()

        async def scenario():
            await socket.connect()
            await socket.receive_json_from()
            await database_sync_to_async(lambda: PermissionPolicyState.objects.filter(key="global").update(revision=42))()
            await get_channel_layer().group_send("permission_watch", {"type": "permission.changed", "revision": 2})
            update = await socket.receive_json_from()
            self.assertEqual(update["payload"]["revision"], "42")
            self.assertTrue(update["payload"]["force"])
            await socket.disconnect()

        async_to_sync(scenario)()

    def test_nonversioned_policy_changes_are_detected_after_a_missed_signal(self):
        before = security_snapshot(self.session.id, self.assignment.id)
        JobRolePermission.objects.create(job_role=self.assignment.position.job_role,
            permission=self.permission, effect="allow", scope_type="own_unit")
        after = security_snapshot(self.session.id, self.assignment.id)
        self.assertEqual(before["revision"], after["revision"])
        self.assertNotEqual(before["state"], after["state"])
        self.assertEqual(before["context"], after["context"])

    def test_position_move_changes_context_and_foreign_assignment_is_rejected(self):
        before = security_snapshot(self.session.id, self.assignment.id)
        other = OrganizationalUnit.objects.create(name="Otro equipo", unit_type="department", sensitivity_level="low")
        Position.objects.filter(pk=self.assignment.position_id).update(unit=other)
        after = security_snapshot(self.session.id, self.assignment.id)
        self.assertNotEqual(before["context"], after["context"])
        employee = Employee.objects.create(full_name="Otra persona")
        UserAccount.objects.create_user(email="other@bold.gt", employee=employee, password="Pruebas 2026!")
        foreign = PositionAssignment.objects.create(employee=employee, position=Position.objects.create(unit=other, job_role=self.assignment.position.job_role))
        self.assertEqual(security_snapshot(self.session.id, foreign.id), {"close_code": 4403})
        client = APIClient(); client.force_authenticate(self.account, self.session)
        client.credentials(HTTP_X_ASSIGNMENT_ID=str(foreign.id))
        self.assertEqual(client.get("/api/v2/permissions/revision/").status_code, 403)

    def test_model_invalidation_only_broadcasts_after_commit_not_rollback(self):
        with patch("boldApp.core.signals.dispatch_authorization_invalidation") as broadcast:
            with transaction.atomic():
                self.permission.description = "Nueva descripción"
                self.permission.save()
                broadcast.assert_not_called()
            broadcast.assert_called_once()
            broadcast.reset_mock()
            with self.assertRaises(RuntimeError):
                with transaction.atomic():
                    self.permission.save()
                    raise RuntimeError("rollback")
            broadcast.assert_not_called()

    def test_expiry_of_an_external_ancestor_and_its_principal_invalidates_grants(self):
        now = timezone.now()
        employee = Employee.objects.create(full_name="Emisor de pruebas")
        issuer = UserAccount.objects.create_user(email="issuer@bold.gt", employee=employee, password="Solo pruebas 2026!")
        issuer_assignment = PositionAssignment.objects.create(employee=employee, position=Position.objects.create(unit=self.unit, job_role=self.assignment.position.job_role))
        parent = GrantAuthority.objects.create(assignment=issuer_assignment, granted_by_assignment=issuer_assignment,
            scope_type="own_unit", valid_from=now - timedelta(minutes=1), valid_until=now + timedelta(seconds=5))
        child = GrantAuthority.objects.create(assignment=issuer_assignment, granted_by_assignment=issuer_assignment,
            scope_type="own_unit", parent_authority=parent, valid_from=now - timedelta(minutes=1), valid_until=now + timedelta(minutes=5))
        self.grant(source_authority=child)
        with patch("boldApp.core.security_control.timezone.now", return_value=now):
            before = security_snapshot(self.session.id, self.assignment.id)
        self.assertAlmostEqual(before["boundary_ms"], 5000, delta=5)
        with patch("boldApp.core.security_control.timezone.now", return_value=now + timedelta(seconds=6)):
            expired = security_snapshot(self.session.id, self.assignment.id)
        self.assertNotEqual(before["state"], expired["state"])
        UserAccount.objects.filter(pk=issuer.id).update(is_active=False)
        with patch("boldApp.core.security_control.timezone.now", return_value=now):
            inactive = security_snapshot(self.session.id, self.assignment.id)
        self.assertNotEqual(before["state"], inactive["state"])

    def test_rotated_credentials_close_the_socket_on_check(self):
        socket = self.socket()

        async def scenario():
            await socket.connect(); await socket.receive_json_from()
            await database_sync_to_async(lambda: UserAccount.objects.filter(pk=self.account.id).update(credentials_version=self.account.credentials_version + 1))()
            await get_channel_layer().group_send("permission_watch", {"type": "permission.changed", "revision": None})
            self.assertEqual((await socket.receive_output())["code"], 4401)
            await socket.disconnect()

        async_to_sync(scenario)()
