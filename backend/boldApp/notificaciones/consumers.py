import asyncio
import uuid
from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

from boldApp.core.events import build_event_envelope
from boldApp.core.security_control import security_snapshot as sync_security_snapshot

security_snapshot = database_sync_to_async(sync_security_snapshot)


@database_sync_to_async
def authorize_notification_ticket(ticket_key):
    from django.db.models import F, Q
    from django.utils import timezone

    from boldApp.autenticacion.models import AuthSession
    from boldApp.autenticacion.services import consume_ws_ticket
    from boldApp.core.models import PositionAssignment

    ticket = consume_ws_ticket(ticket_key)
    if not ticket or ticket.get("channel") != "notifications":
        return None
    now = timezone.now()
    try:
        session = AuthSession.objects.filter(
            id=ticket["session"], user_account_id=ticket["user"],
            user_account__is_active=True, user_account__employee__is_active=True,
            revoked_at__isnull=True, expires_at__gt=now,
            credentials_version=F("user_account__credentials_version"),
        ).filter(Q(idle_expires_at__isnull=True) | Q(idle_expires_at__gt=now)).get()
        assignment = PositionAssignment.objects.get(
            id=ticket["assignment"], employee_id=session.user_account.employee_id,
            employee__is_active=True, is_active=True, released_at__isnull=True,
        )
    except (AuthSession.DoesNotExist, PositionAssignment.DoesNotExist, KeyError, ValueError):
        return None
    return {"session": str(session.id), "assignment": str(assignment.id)}


@database_sync_to_async
def notification_identity_is_active(session_id, assignment_id):
    from django.db.models import F, Q
    from django.utils import timezone

    from boldApp.autenticacion.models import AuthSession
    from boldApp.core.models import PositionAssignment

    now = timezone.now()
    session = AuthSession.objects.filter(
        id=session_id, user_account__is_active=True, user_account__employee__is_active=True,
        revoked_at__isnull=True, expires_at__gt=now,
        credentials_version=F("user_account__credentials_version"),
    ).filter(Q(idle_expires_at__isnull=True) | Q(idle_expires_at__gt=now)).first()
    return bool(session and PositionAssignment.objects.filter(
        id=assignment_id, employee_id=session.user_account.employee_id,
        employee__is_active=True, is_active=True, released_at__isnull=True,
    ).exists())


class NotificationConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        query = parse_qs(self.scope.get("query_string", b"").decode("utf-8"))
        ticket = query.get("ticket", [None])[0]
        identity = await authorize_notification_ticket(ticket) if ticket else None
        if not identity:
            await self.close(code=4403)
            return
        self.session_id = identity["session"]
        self.assignment_id = identity["assignment"]
        self.notification_group = f"notifications_assignment_{self.assignment_id}"
        self.session_group = f"session_{self.session_id}"
        self.groups_joined = (self.notification_group, self.session_group,
                              f"assignment_{self.assignment_id}", "permission_watch")
        for group in self.groups_joined:
            await self.channel_layer.group_add(group, self.channel_name)
        self.control_channel = str(uuid.uuid4())
        self.control_sequence = 0
        self.control_state = None
        self.security_task = None
        self.security_checked = asyncio.Event()
        self.security_wake = asyncio.Event()
        await self.accept()
        if await self.send_control("control.ready"):
            self.security_task = asyncio.create_task(self.watch_security())

    async def disconnect(self, close_code):
        task = getattr(self, "security_task", None)
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        for group in getattr(self, "groups_joined", ()):
            await self.channel_layer.group_discard(group, self.channel_name)

    async def send_control(self, event_type="control.ready", force=False):
        snapshot = await security_snapshot(self.session_id, self.assignment_id)
        if snapshot.get("close_code"):
            if self.security_task:
                self.security_task.cancel()
            await self.close(code=snapshot["close_code"])
            return False
        changed = self.control_state is not None and self.control_state != (snapshot["revision"], snapshot["state"])
        self.control_state = (snapshot["revision"], snapshot["state"])
        self.next_check_seconds = max(0.05, min(30, snapshot["boundary_ms"] / 1000))
        self.control_sequence += 1
        await self.send_json(build_event_envelope(
            event_type, "security_control", self.control_channel,
            {**snapshot, "assignment": self.assignment_id, "sequence": self.control_sequence,
             "capabilities": {"permissions_revision": True}, "lease_ms": 45000,
             "force": force or changed},
        ))
        return True

    async def watch_security(self):
        try:
            while True:
                try:
                    await asyncio.wait_for(self.security_wake.wait(), timeout=self.next_check_seconds)
                except asyncio.TimeoutError:
                    pass
                self.security_wake.clear()
                # Use the channel dispatcher to serialize checks with policy events.
                await self.channel_layer.send(self.channel_name, {"type": "security.check"})
                # The next delay is updated by security_check. Yield until dispatched.
                await self.security_checked.wait()
                self.security_checked.clear()
        except asyncio.CancelledError:
            raise
        except Exception:
            # Do not retain a healthy-looking control channel after a failed check.
            await self.close(code=1011)

    async def security_check(self, event):
        try:
            if not await self.send_control() and self.security_task:
                self.security_task.cancel()
        except Exception:
            await self.close(code=1011)
            if self.security_task:
                self.security_task.cancel()
        finally:
            self.security_checked.set()

    async def permission_changed(self, event):
        # Compare the current scoped fingerprint, not the broadcast's stale/null
        # revision. Duplicate/irrelevant model signals must not reload every client.
        await self.send_control("permissions.revision")
        self.security_wake.set()

    async def notification_created(self, event):
        if not await notification_identity_is_active(self.session_id, self.assignment_id):
            await self.close(code=4403)
            return
        await self.send_json(event["envelope"])

    async def session_revoked(self, event):
        if self.security_task:
            self.security_task.cancel()
        await self.close(code=4401)

    async def assignment_changed(self, event):
        await self.send_control("assignment.changed")
        self.security_wake.set()
