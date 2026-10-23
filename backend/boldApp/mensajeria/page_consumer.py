"""Page-scoped coediting on existing ASGI/Redis infrastructure."""
import asyncio
import json
import time
import uuid
from collections import deque
from urllib.parse import parse_qs
from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.core.serializers.json import DjangoJSONEncoder
from rest_framework.exceptions import APIException, PermissionDenied
from boldApp.autenticacion.services import consume_ws_ticket
from .page_collaboration import authorized_event, commit_update, initial_state, synchronize, page_group

db_initial = database_sync_to_async(initial_state)
db_commit = database_sync_to_async(commit_update)
db_event = database_sync_to_async(authorized_event)
db_ticket = database_sync_to_async(consume_ws_ticket)
db_sync = database_sync_to_async(synchronize)


class PageConsumer(AsyncJsonWebsocketConsumer):
    @classmethod
    async def encode_json(cls, content):
        return json.dumps(content, cls=DjangoJSONEncoder, separators=(",", ":"))

    async def connect(self):
        self.joined, self.activity = [], deque()
        self.connection_id = uuid.uuid4().hex
        self.presence = None
        try:
            token = parse_qs(self.scope.get("query_string", b"").decode("ascii")).get("ticket", [""])[0]
            ticket = await db_ticket(token)
            self.page_id = str(self.scope["url_route"]["kwargs"]["page_id"])
            if not ticket or ticket.get("channel") != "slack_pages" or ticket.get("unit") != self.page_id:
                raise PermissionDenied()
            self.session_id, self.assignment_id = ticket["session"], ticket["assignment"]
            snapshot = await db_initial(self.session_id, self.assignment_id, self.page_id)
            self.channel_id = snapshot["page"]["channel_id"]
            self.actor = snapshot["self"]
            self.joined = [page_group(self.page_id), "session_"+self.session_id, "assignment_"+self.assignment_id, "permission_watch", "slack_watch"]
            for group in self.joined:
                await self.channel_layer.group_add(group, self.channel_name)
            # Close the check/join race before releasing document content.
            snapshot = await db_initial(self.session_id, self.assignment_id, self.page_id)
        except Exception:
            await self.close(code=4403)
            return
        await self.accept()
        await self.send_packet({**snapshot, "connection": self.connection_id})
        await self.channel_layer.group_send(page_group(self.page_id), {"type": "page.hello", "requester": self.channel_name})
        await self.publish_presence(None)

    async def disconnect(self, code):
        if getattr(self, "channel_id", None):
            await self.channel_layer.group_send(page_group(self.page_id), {"type": "page.presence", "connection": self.connection_id, "left": True})
        for group in getattr(self, "joined", []):
            await self.channel_layer.group_discard(group, self.channel_name)

    async def send_packet(self, packet):
        # Chunk CRDT snapshots so neither the proxy nor Channels needs giant frames.
        update = packet.get("update", "")
        if len(update) <= 60000:
            await self.send_json(packet)
            return
        identity = uuid.uuid4().hex
        chunks = [update[i:i+60000] for i in range(0, len(update), 60000)]
        await self.send_json({"type": "transfer.start", "id": identity, "parts": len(chunks), "packet": {key: value for key, value in packet.items() if key != "update"}})
        for index, value in enumerate(chunks):
            await self.send_json({"type": "transfer.chunk", "id": identity, "index": index, "data": value})
        await self.send_json({"type": "transfer.end", "id": identity})

    async def receive(self, text_data=None, bytes_data=None, **kwargs):
        if bytes_data is not None or text_data is None or len(text_data.encode()) > 131072:
            await self.close(code=4400)
            return
        try:
            value = json.loads(text_data)
        except (ValueError, TypeError):
            await self.close(code=4400)
            return
        await self.receive_json(value)

    async def receive_json(self, content, **kwargs):
        now = time.monotonic()
        self.activity.append(now)
        while self.activity and now-self.activity[0] >= 1:
            self.activity.popleft()
        if len(self.activity) > 30:
            await self.close(code=4429)
            return
        try:
            if not isinstance(content, dict):
                raise ValueError()
            kind = content.get("type")
            if kind == "transfer.start":
                if not isinstance(content.get("packet"),dict) or content["packet"].get("type") != "update" or type(content.get("parts")) is not int or not 1 <= content["parts"] <= 6:
                    raise ValueError()
                self.incoming = {"id":content.get("id"),"packet":content["packet"],"parts":content["parts"],"chunks":[],"until":time.monotonic()+15}
                return
            if kind in {"transfer.chunk","transfer.end"}:
                incoming=getattr(self,"incoming",None)
                if not incoming or incoming["id"] != content.get("id") or time.monotonic()>incoming["until"]:
                    raise ValueError()
                if kind == "transfer.chunk":
                    if content.get("index") != len(incoming["chunks"]) or len(incoming["chunks"]) >= incoming["parts"] or not isinstance(content.get("data"),str) or len(content["data"])>60000:
                        raise ValueError()
                    incoming["chunks"].append(content["data"])
                    return
                if len(incoming["chunks"]) != incoming["parts"]:
                    raise ValueError()
                self.incoming=None
                await self.receive_json({**incoming["packet"],"update":"".join(incoming["chunks"])})
                return
            if kind == "update":
                result = await db_commit(self.session_id, self.assignment_id, self.page_id, content, self.connection_id)
                if result["type"] == "reset_required":
                    result = await db_initial(self.session_id, self.assignment_id, self.page_id)
                await self.send_packet(result)
            elif kind in {"sync", "ping"}:
                # A live socket heartbeat recovers missed events, not HTTP polling.
                await self.send_packet(await db_sync(self.session_id, self.assignment_id, self.page_id, content))
                await self.publish_presence(self.presence)
            elif kind == "presence":
                selection = content.get("selection")
                if selection is not None:
                    if not isinstance(selection, dict) or set(selection) - {"field", "anchor", "head"}:
                        raise ValueError()
                    if not all(isinstance(selection.get(key), str) and len(selection[key]) <= 768 for key in ("field", "anchor", "head")):
                        raise ValueError()
                    if selection["field"] != "title":
                        uuid.UUID(selection["field"])
                self.presence = selection
                # Revalidate before even broadcasting identity/presence.
                await database_sync_to_async(self.check_access)()
                await self.publish_presence(selection)
            else:
                raise ValueError()
        except APIException as error:
            if error.status_code in (401, 403, 404):
                try:
                    snapshot=await db_initial(self.session_id,self.assignment_id,self.page_id)
                except APIException:
                    await self.send_json({"type":"revoked"})
                    await self.close(code=4403)
                    return
                if not snapshot["page"]["can_edit"]:
                    await self.send_packet(snapshot)
                else:
                    await self.send_json({"type":"error","status":400,"detail":"No se pudo aplicar la referencia o el cambio solicitado. Tu borrador se conserva."})
                return
            await self.send_json({"type": "error", "status": error.status_code, "detail": str(error.detail)[:500]})
        except (ValueError, TypeError, KeyError):
            await self.send_json({"type": "error", "status": 400, "detail": "Mensaje de colaboración no válido."})

    def check_access(self):
        from .page_collaboration import context
        return context(self.session_id, self.assignment_id, self.page_id)

    async def publish_presence(self, selection):
        await self.channel_layer.group_send(page_group(self.page_id), {"type": "page.presence", "connection": self.connection_id,
            "person": self.actor, "selection": selection, "left": False})

    async def page_hello(self, event):
        try:
            await database_sync_to_async(self.check_access)()
            await self.channel_layer.send(event["requester"], {"type": "page.presence", "connection": self.connection_id,
                "person": self.actor, "selection": self.presence, "left": False})
        except APIException:
            await self.permission_changed({})

    async def page_presence(self, event):
        if event.get("connection") == self.connection_id:
            return
        try:
            await database_sync_to_async(self.check_access)()
            await self.send_json({key: value for key, value in event.items() if key != "type"} | {"type": "presence"})
        except APIException:
            await self.permission_changed({})

    async def page_update(self, event):
        if event.get("connection") == self.connection_id:
            return
        try:
            packet = await db_event(self.session_id, self.assignment_id, self.page_id, event)
            if packet["type"] == "reset_required":
                packet = await db_initial(self.session_id, self.assignment_id, self.page_id)
            await self.send_packet(packet)
        except APIException:
            await self.permission_changed({})

    async def page_reset(self, event):
        await self.permission_changed(event)

    async def permission_changed(self, event):
        try:
            await self.send_packet(await db_initial(self.session_id, self.assignment_id, self.page_id))
        except APIException:
            await self.send_json({"type": "revoked"})
            await self.close(code=4403)

    async def assignment_changed(self, event):
        await self.permission_changed(event)

    async def session_revoked(self, event):
        await self.send_json({"type": "revoked"})
        await self.close(code=4401)

    async def slack_changed(self, event):
        if event.get("channel_id") == self.channel_id and event.get("kind", "").startswith("channel."):
            await self.permission_changed(event)
