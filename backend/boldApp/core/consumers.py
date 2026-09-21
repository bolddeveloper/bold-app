from datetime import timedelta
from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.conf import settings

from .events import CORE_EVENTS_GROUP


@database_sync_to_async
def authorize_owner_ticket(ticket_key):
    from django.db.models import F, Q
    from django.utils import timezone

    from boldApp.autenticacion.models import AuthSession
    from boldApp.autenticacion.services import consume_ws_ticket

    ticket = consume_ws_ticket(ticket_key)
    if not ticket or ticket.get("channel") != "core":
        return None
    now = timezone.now()
    max_age = timedelta(seconds=getattr(settings, "PERMISSIONS_STEP_UP_MFA_SECONDS", 600))
    session = (
        AuthSession.objects.select_related("user_account__employee")
        .filter(
            id=ticket.get("session"),
            user_account_id=ticket.get("user"),
            user_account__is_active=True,
            user_account__is_superuser=True,
            user_account__employee__is_active=True,
            revoked_at__isnull=True,
            expires_at__gt=now,
            credentials_version=F("user_account__credentials_version"),
            mfa_verified_at__gte=now - max_age,
            auth_strength__in=["password_totp", "webauthn"],
        )
        .filter(Q(idle_expires_at__isnull=True) | Q(idle_expires_at__gt=now))
        .first()
    )
    return str(session.id) if session else None


@database_sync_to_async
def owner_session_is_active(session_id):
    from django.db.models import F, Q
    from django.utils import timezone

    from boldApp.autenticacion.models import AuthSession

    now = timezone.now()
    max_age = timedelta(seconds=getattr(settings, "PERMISSIONS_STEP_UP_MFA_SECONDS", 600))
    return AuthSession.objects.filter(
        id=session_id,
        user_account__is_active=True,
        user_account__is_superuser=True,
        user_account__employee__is_active=True,
        revoked_at__isnull=True,
        expires_at__gt=now,
        credentials_version=F("user_account__credentials_version"),
        mfa_verified_at__gte=now - max_age,
        auth_strength__in=["password_totp", "webauthn"],
    ).filter(Q(idle_expires_at__isnull=True) | Q(idle_expires_at__gt=now)).exists()


class CoreEventsConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        query = parse_qs(self.scope.get("query_string", b"").decode("utf-8"))
        ticket = query.get("ticket", [None])[0]
        session_id = await authorize_owner_ticket(ticket) if ticket else None
        if not session_id:
            await self.close(code=4403)
            return

        self.session_id = session_id
        self.session_group_name = f"session_{session_id}"
        await self.channel_layer.group_add(CORE_EVENTS_GROUP, self.channel_name)
        await self.channel_layer.group_add(self.session_group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(CORE_EVENTS_GROUP, self.channel_name)
        if hasattr(self, "session_group_name"):
            await self.channel_layer.group_discard(self.session_group_name, self.channel_name)

    async def core_event(self, event):
        if not await owner_session_is_active(self.session_id):
            await self.close(code=4403)
            return
        await self.send_json(event["envelope"])

    async def session_revoked(self, event):
        await self.close(code=4403)
