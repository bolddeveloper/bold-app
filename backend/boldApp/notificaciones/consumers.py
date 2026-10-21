import asyncio
import logging
import uuid
from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

from boldApp.core.events import build_event_envelope
from boldApp.core.security_control import security_snapshot as sync_security_snapshot

security_snapshot = database_sync_to_async(sync_security_snapshot)
from boldApp.autenticacion.presence import heartbeat_snapshot, disconnect_presence
presence_snapshot = database_sync_to_async(heartbeat_snapshot)
presence_disconnected = database_sync_to_async(disconnect_presence)
log = logging.getLogger(__name__)


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
    from boldApp.mensajeria.access import assignment_can_chat
    return {"session": str(session.id), "assignment": str(assignment.id), "employee": str(session.user_account.employee_id),
            "chat_allowed": assignment_can_chat(assignment)}


@database_sync_to_async
def chat_assignment_is_allowed(assignment_id):
    from boldApp.core.models import PositionAssignment
    from boldApp.mensajeria.access import assignment_can_chat
    assignment = PositionAssignment.objects.select_related("position", "employee").filter(pk=assignment_id).first()
    return assignment_can_chat(assignment)


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


@database_sync_to_async
def notification_resource_is_readable(assignment_id, notification_id, session_id=None):
    from .models import Notification
    from .services import _readable_assignments

    notification = Notification.objects.select_related(
        "recipient_assignment__employee__user_account", "recipient_assignment__position__unit",
        "recipient_assignment__position__job_role", "task__unit", "project__unit",
    ).filter(pk=notification_id, recipient_assignment_id=assignment_id).first()
    if not notification:
        return False
    if notification.module == "slack":
        from boldApp.autenticacion.models import AuthSession
        from boldApp.mensajeria.channel_notifications import notification_channel_readable
        session = AuthSession.objects.filter(pk=session_id, user_account__employee_id=notification.recipient_assignment.employee_id).first() if session_id else None
        return notification_channel_readable(notification.recipient_assignment, notification, session, push=True)
    if notification.module == "messaging":
        from boldApp.mensajeria.access import assignment_can_chat
        from boldApp.mensajeria.events import _conversations
        return bool(assignment_can_chat(notification.recipient_assignment)
                    and notification.resource_type == "direct_conversation"
                    and _conversations(notification.recipient_assignment.employee_id).filter(pk=notification.resource_id).exists())
    if notification.module == "sheets":
        from boldApp.hojas.access import readable
        return notification.resource_type == "file" and notification.resource_id is not None and readable(notification.recipient_assignment, notification.resource_id)
    for resource, permission in ((notification.task, "tasks.task.read"), (notification.project, "tasks.project.read")):
        if resource and (resource.deleted_at or not _readable_assignments([notification.recipient_assignment], permission, resource)):
            return False
    return True


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
        self.employee_id = identity["employee"]
        self.notification_group = f"notifications_assignment_{self.assignment_id}"
        self.session_group = f"session_{self.session_id}"
        self.groups_joined = (self.notification_group, self.session_group,
                              f"assignment_{self.assignment_id}", "permission_watch", "presence_watch")
        if identity["chat_allowed"]:
            self.groups_joined += (f"messaging_employee_{self.employee_id}", "slack_watch")
        for group in self.groups_joined:
            await self.channel_layer.group_add(group, self.channel_name)
        self.control_channel = str(uuid.uuid4())
        self.control_sequence = 0
        self.control_state = None
        self.security_task = None
        self.presence_task = None
        self.closing = False
        self.security_checked = asyncio.Event()
        self.security_wake = asyncio.Event()
        await self.accept()
        if await self.send_control("control.ready"):
            self.security_task = asyncio.create_task(self.watch_security())
            # Bounded recovery on the same authenticated socket, not another
            # timer/socket per chat. Old clients can safely ignore these envelopes.
            from boldApp.mensajeria.events import pending_event
            backlog = await database_sync_to_async(pending_event)(self.employee_id) if identity["chat_allowed"] else None
            if backlog and await chat_assignment_is_allowed(self.assignment_id) and await notification_identity_is_active(self.session_id, self.assignment_id):
                await self.send_json(backlog)

    async def disconnect(self, close_code):
        self.closing = True
        for task in (getattr(self, "security_task", None), getattr(self, "presence_task", None)):
            if task:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
        for group in getattr(self, "groups_joined", ()):
            await self.channel_layer.group_discard(group, self.channel_name)
        if hasattr(self, "session_id"):
            await presence_disconnected(self.session_id, self.channel_name)

    async def send_control(self, event_type="control.ready", force=False):
        if self.closing:
            return False
        snapshot = await security_snapshot(self.session_id, self.assignment_id)
        if snapshot.get("close_code"):
            self.closing = True
            if self.security_task:
                self.security_task.cancel()
            await self.close(code=snapshot["close_code"])
            return False
        changed = self.control_state is not None and self.control_state != (snapshot["revision"], snapshot["state"])
        self.control_state = (snapshot["revision"], snapshot["state"])
        self.next_check_seconds = max(0.05, min(30, snapshot["boundary_ms"] / 1000))
        self.control_sequence += 1
        presence = await presence_snapshot(self.session_id, self.channel_name)
        await self.send_json(build_event_envelope(
            event_type, "security_control", self.control_channel,
            {**snapshot, "presence": presence, "assignment": self.assignment_id, "sequence": self.control_sequence,
             "capabilities": {"permissions_revision": True}, "lease_ms": 45000,
             "force": force or changed},
        ))
        return True

    async def watch_security(self):
        try:
            while True:
                try:
                    await asyncio.wait_for(self.security_wake.wait(), timeout=self.next_check_seconds)
                    # Policy/assignment handlers already checked and sent control.
                    # Wake only restarts the lease timer; do not send a duplicate.
                    self.security_wake.clear()
                    continue
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

    async def presence_changed(self, event):
        # A simultaneous login burst used to enqueue N full checks per client.
        # Coalesce presence only; permission/revocation handlers and the security
        # deadline timer remain immediate and independent of this short delay.
        if not self.closing and self.presence_task is None:
            self.presence_task = asyncio.create_task(self.queue_presence_refresh())

    async def queue_presence_refresh(self):
        try:
            await asyncio.sleep(0.15)
            await self.channel_layer.send(self.channel_name, {"type": "presence.refresh"})
        except asyncio.CancelledError:
            raise
        except Exception:
            # Do not leave a failed task blocking all future presence updates or
            # raising during disconnect before subscriptions can be removed.
            self.presence_task = None
            log.warning("Presence refresh enqueue failed; next heartbeat will reconcile", exc_info=True)

    async def presence_refresh(self, event):
        self.presence_task = None
        await self.send_control()

    async def notification_created(self, event):
        if self.closing:
            return
        if not await notification_identity_is_active(self.session_id, self.assignment_id):
            self.closing = True
            await self.close(code=4403)
            return
        if not await notification_resource_is_readable(self.assignment_id, event["envelope"].get("entity_id"), self.session_id):
            return
        await self.send_json(event["envelope"])

    async def notification_invalidated(self, event):
        if self.closing:
            return
        if not await notification_identity_is_active(self.session_id, self.assignment_id):
            self.closing = True
            await self.close(code=4403)
            return
        await self.send_json(build_event_envelope("notification.invalidated", "notification_collection", self.assignment_id, {}))

    async def session_revoked(self, event):
        self.closing = True
        if self.security_task:
            self.security_task.cancel()
        await self.close(code=4401)

    async def messaging_changed(self, event):
        if self.closing:
            return
        if not await chat_assignment_is_allowed(self.assignment_id):
            return
        if not await notification_identity_is_active(self.session_id, self.assignment_id):
            self.closing = True
            await self.close(code=4403)
            return
        from boldApp.mensajeria.events import private_event
        envelope = await database_sync_to_async(private_event)(self.employee_id, event)
        if envelope:
            await self.send_json(envelope)

    async def slack_changed(self, event):
        if self.closing:
            return
        if not await notification_identity_is_active(self.session_id, self.assignment_id):
            self.closing = True
            await self.close(code=4403)
            return
        from boldApp.mensajeria.channel_events import channel_event
        envelope = await database_sync_to_async(channel_event)(self.assignment_id, event, self.session_id)
        if envelope:
            await self.send_json(envelope)

    async def assignment_changed(self, event):
        await self.send_control("assignment.changed")
        self.security_wake.set()
