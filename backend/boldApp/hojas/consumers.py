from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.db.models import F, Q
from django.utils import timezone

from boldApp.autenticacion.models import AuthSession
from boldApp.autenticacion.services import consume_ws_ticket
from boldApp.core.models import PositionAssignment
from .access import require_file
from .models import Workbook


@database_sync_to_async
def authorized(session_id, assignment_id, workbook_id):
    try:
        now = timezone.now()
        session = AuthSession.objects.filter(pk=session_id, revoked_at__isnull=True, expires_at__gt=now, credentials_version=F("user_account__credentials_version"), user_account__is_active=True, user_account__employee__is_active=True).filter(Q(idle_expires_at__isnull=True) | Q(idle_expires_at__gt=now)).get()
        assignment = PositionAssignment.objects.select_related("employee__user_account", "position__unit", "position__job_role").get(pk=assignment_id, employee_id=session.user_account.employee_id, is_active=True, released_at__isnull=True)
        require_file(assignment, Workbook.objects.get(pk=workbook_id))
        return True
    except Exception:
        return False


@database_sync_to_async
def consume(key):
    return consume_ws_ticket(key)


class SheetConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        ticket = await consume(parse_qs(self.scope.get("query_string", b"").decode()).get("ticket", [""])[0])
        self.workbook_id = str(self.scope["url_route"]["kwargs"]["workbook_id"])
        if not ticket or ticket.get("channel") != "sheets" or ticket.get("unit") != self.workbook_id:
            await self.close(code=4403)
            return
        self.session_id, self.assignment_id = ticket["session"], ticket["assignment"]
        if not await authorized(self.session_id, self.assignment_id, self.workbook_id):
            await self.close(code=4403)
            return
        self.groups_joined = ["sheet_" + self.workbook_id, "session_" + self.session_id, "assignment_" + self.assignment_id, "permission_watch"]
        for group in self.groups_joined:
            await self.channel_layer.group_add(group, self.channel_name)
        await self.accept()

    async def disconnect(self, code):
        for group in getattr(self, "groups_joined", []):
            await self.channel_layer.group_discard(group, self.channel_name)

    async def sheet_changed(self, event):
        if await authorized(self.session_id, self.assignment_id, self.workbook_id):
            await self.send_json(event["data"])
        else:
            await self.send_json({"revoked": True})
            await self.close(code=4403)

    async def permission_changed(self, event):
        if not await authorized(self.session_id, self.assignment_id, self.workbook_id):
            await self.send_json({"revoked": True})
            await self.close(code=4403)
        else:
            await self.send_json({"access_changed": True})

    async def assignment_changed(self, event):
        await self.permission_changed(event)

    async def session_revoked(self, event):
        await self.close(code=4401)
