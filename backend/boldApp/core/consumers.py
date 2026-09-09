from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

from .events import CORE_EVENTS_GROUP


@database_sync_to_async
def is_staff_token(token_key):
    from rest_framework.authtoken.models import Token

    return Token.objects.filter(key=token_key, user__is_active=True, user__is_staff=True).exists()


class CoreEventsConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        query = parse_qs(self.scope.get("query_string", b"").decode("utf-8"))
        token = query.get("token", [None])[0]
        if not token or not await is_staff_token(token):
            await self.close(code=4403)
            return

        await self.channel_layer.group_add(CORE_EVENTS_GROUP, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        if self.channel_name:
            await self.channel_layer.group_discard(CORE_EVENTS_GROUP, self.channel_name)

    async def core_event(self, event):
        await self.send_json(event["envelope"])
