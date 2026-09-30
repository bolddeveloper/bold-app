from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer


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
        await self.channel_layer.group_add(self.notification_group, self.channel_name)
        await self.channel_layer.group_add(self.session_group, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        for group in (getattr(self, "notification_group", None), getattr(self, "session_group", None)):
            if group:
                await self.channel_layer.group_discard(group, self.channel_name)

    async def notification_created(self, event):
        if not await notification_identity_is_active(self.session_id, self.assignment_id):
            await self.close(code=4403)
            return
        await self.send_json(event["envelope"])

    async def session_revoked(self, event):
        await self.close(code=4403)

    async def assignment_changed(self, event):
        if not await notification_identity_is_active(self.session_id, self.assignment_id):
            await self.close(code=4403)
