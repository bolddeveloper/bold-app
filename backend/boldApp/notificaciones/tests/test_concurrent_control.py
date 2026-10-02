"""Synthetic concurrent ASGI tests, not a public/production load benchmark."""
import asyncio
import json
import math
import os
from time import perf_counter
from unittest import SkipTest

from asgiref.sync import async_to_sync
from channels.db import database_sync_to_async
from channels.layers import get_channel_layer
from channels.testing import WebsocketCommunicator
from django.core.cache import cache
from django.conf import settings
from django.test import RequestFactory, TransactionTestCase, override_settings

from boldApp.autenticacion.services import create_session, issue_ws_ticket, revoke_session
from boldApp.core.models import Employee, JobRole, JobRolePermission, OrganizationalUnit, Permission, Position, PositionAssignment, UserAccount
from config.asgi import application


@override_settings(SECURE_SSL_REDIRECT=False)
class ConcurrentControlTests(TransactionTestCase):
    def setUp(self):
        if (settings.DATABASES["default"]["ENGINE"] != "django.db.backends.sqlite3"
                or settings.CHANNEL_LAYERS["default"]["BACKEND"] != "channels.layers.InMemoryChannelLayer"
                or settings.CACHES["default"]["BACKEND"] != "django.core.cache.backends.locmem.LocMemCache"):
            raise SkipTest("Use config.settings_test: this synthetic suite must not touch external DB/cache/channels.")
        cache.clear()  # settings_test uses an isolated cache, never production Redis.
        self.unit = OrganizationalUnit.objects.create(name="Capacidad sintética", unit_type="department", sensitivity_level="low")
        self.role = JobRole.objects.create(title="Cargo sintético")
        permission, _ = Permission.objects.get_or_create(code="tasks.task.read", defaults={"module_code": "tasks", "resource": "task", "action": "read"})
        JobRolePermission.objects.create(job_role=self.role, permission=permission, effect="allow", scope_type="own_unit")

    def identity(self, index):
        employee = Employee.objects.create(full_name=f"Prueba sintética {index}")
        account = UserAccount.objects.create_user(email=f"synthetic-{index}@bold.gt", employee=employee)
        assignment = PositionAssignment.objects.create(employee=employee, position=Position.objects.create(unit=self.unit, job_role=self.role))
        _, session = create_session(account, RequestFactory().get("/", REMOTE_ADDR="127.0.0.1"))
        return account, assignment, session

    def socket(self, identity, channel="notifications"):
        account, assignment, session = identity
        unit = self.unit.id if channel == "tasks" else None
        ticket = issue_ws_ticket(account, session, assignment.id, unit, channel)
        path = f"/ws/unit/{unit}/" if unit else "/ws/notifications/"
        return WebsocketCommunicator(application, f"{path}?ticket={ticket}", headers=[(b"origin", b"http://localhost:5174")])

    def run_clients(self, count):
        identities = [self.identity(index) for index in range(count)]
        controls = [self.socket(identity) for identity in identities]
        tasks = [self.socket(identity, "tasks") for identity in identities]
        sockets = controls + tasks

        async def scenario():
            connect_times = []
            async def connect(socket):
                start = perf_counter()
                self.assertTrue((await socket.connect(timeout=10))[0])
                connect_times.append((perf_counter() - start) * 1000)
            try:
                await asyncio.gather(*(connect(socket) for socket in sockets))
                ready = await asyncio.gather(*(socket.receive_json_from(timeout=10) for socket in controls))
                self.assertEqual({event["payload"]["assignment"] for event in ready}, {str(identity[1].id) for identity in identities})
                self.assertTrue(all(event["event_type"] == "control.ready" for event in ready))
                start = perf_counter()
                await get_channel_layer().group_send("permission_watch", {"type": "permission.changed", "revision": None})
                updates = await asyncio.gather(*(socket.receive_json_from(timeout=10) for socket in controls))
                self.assertTrue(all(event["event_type"] == "permissions.revision" for event in updates))
                # Revoke exactly one session, not the other 24 clients.
                await database_sync_to_async(revoke_session)(identities[0][2])
                close = await asyncio.gather(controls[0].receive_output(timeout=10), tasks[0].receive_output(timeout=10))
                self.assertEqual([event["code"] for event in close], [4401, 4403])
                await get_channel_layer().group_send(f"notifications_assignment_{identities[-1][1].id}", {
                    "type": "notification.created", "envelope": {"event_type": "notification.created", "event_id": "synthetic-survivor"},
                })
                # A policy signal may queue a control heartbeat as well. It is
                # allowed; prove survival with a recipient-scoped notification.
                for _ in range(5):
                    survivor = await controls[-1].receive_json_from(timeout=10)
                    if survivor.get("event_id") == "synthetic-survivor":
                        break
                self.assertEqual(survivor.get("event_id"), "synthetic-survivor")
                if os.getenv("BOLD_REPORT_CAPACITY") == "1":
                    times = sorted(connect_times)
                    print("CAPACITY " + json.dumps({"scope": "isolated-asgi-not-cloud-capacity", "clients": count, "sockets": len(sockets),
                        "connect_p50_ms": round(times[math.ceil(len(times) * 0.5) - 1], 2), "connect_p95_ms": round(times[math.ceil(len(times) * 0.95) - 1], 2),
                        "broadcast_and_revocation_ms": round((perf_counter() - start) * 1000, 2)}))
            finally:
                await asyncio.gather(*(socket.disconnect(timeout=10) for socket in sockets))

        async_to_sync(scenario)()
        self.assertFalse(get_channel_layer().groups)  # all subscriptions removed

    def test_five_clients(self):
        self.run_clients(5)

    def test_ten_clients(self):
        self.run_clients(10)

    def test_twenty_five_clients(self):
        self.run_clients(25)

    def test_two_tabs_of_one_session_are_both_revoked(self):
        identity = self.identity(0)
        sockets = [self.socket(identity), self.socket(identity)]
        async def scenario():
            try:
                self.assertTrue(all(result[0] for result in await asyncio.gather(*(socket.connect() for socket in sockets))))
                await asyncio.gather(*(socket.receive_json_from() for socket in sockets))
                await database_sync_to_async(revoke_session)(identity[2])
                closed = await asyncio.gather(*(socket.receive_output() for socket in sockets))
                self.assertEqual([event["code"] for event in closed], [4401, 4401])
            finally:
                await asyncio.gather(*(socket.disconnect() for socket in sockets))
        async_to_sync(scenario)()
        self.assertFalse(get_channel_layer().groups)
