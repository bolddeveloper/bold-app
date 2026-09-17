from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

from .events import CORE_EVENTS_GROUP


@database_sync_to_async
def is_staff_ticket(ticket_key):
    from django.db.models import F
    from django.utils import timezone
    from boldApp.autenticacion.models import AuthSession
    from boldApp.autenticacion.services import consume_ws_ticket
    ticket = consume_ws_ticket(ticket_key)
    return bool(ticket and ticket.get("staff") and AuthSession.objects.filter(id=ticket.get("session"), user_account_id=ticket.get("user"), user_account__is_active=True, user_account__is_staff=True, revoked_at__isnull=True, expires_at__gt=timezone.now(), credentials_version=F("user_account__credentials_version")).exists())


class CoreEventsConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        query = parse_qs(self.scope.get("query_string", b"").decode("utf-8"))
        ticket = query.get("ticket", [None])[0]
        if not ticket or not await is_staff_ticket(ticket):
            await self.close(code=4403)
            return

        await self.channel_layer.group_add(CORE_EVENTS_GROUP, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        if self.channel_name:
            await self.channel_layer.group_discard(CORE_EVENTS_GROUP, self.channel_name)

    async def core_event(self, event):
        await self.send_json(event["envelope"])
