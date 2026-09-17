from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer


@database_sync_to_async
def authorize_connection(ticket_key, unit_id):
    from django.db.models import F
    from django.utils import timezone
    from boldApp.autenticacion.models import AuthSession
    from boldApp.autenticacion.services import consume_ws_ticket
    from boldApp.core.authorization import resolve_access
    from boldApp.core.models import OrganizationalUnit, Permission, PositionAssignment

    try:
        ticket = consume_ws_ticket(ticket_key)
        if not ticket or ticket.get("staff") or ticket.get("unit") != str(unit_id):
            return False
        session = AuthSession.objects.select_related("user_account").get(id=ticket["session"], user_account_id=ticket["user"], revoked_at__isnull=True, expires_at__gt=timezone.now(), credentials_version=F("user_account__credentials_version"))
        assignment = PositionAssignment.objects.select_related(
            "employee",
            "position__unit",
            "position__job_role",
        ).get(
            id=ticket["assignment"],
            employee_id=session.user_account.employee_id,
            is_active=True,
            released_at__isnull=True,
        )
        unit = OrganizationalUnit.objects.get(id=unit_id)
        permission = Permission.objects.get(code="tasks.task.read")
    except (AuthSession.DoesNotExist, PositionAssignment.DoesNotExist, OrganizationalUnit.DoesNotExist, Permission.DoesNotExist, ValueError, KeyError):
        return False

    return resolve_access(assignment, permission, unit).allowed


class TaskEventsConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        query = parse_qs(self.scope.get("query_string", b"").decode("utf-8"))
        ticket = query.get("ticket", [None])[0]
        unit_id = self.scope["url_route"]["kwargs"]["unit_id"]

        if not ticket or not await authorize_connection(ticket, unit_id):
            await self.close(code=4403)
            return

        self.unit_group_name = f"unit_{unit_id}"
        await self.channel_layer.group_add(self.unit_group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        if hasattr(self, "unit_group_name"):
            await self.channel_layer.group_discard(self.unit_group_name, self.channel_name)

    async def task_event(self, event):
        await self.send_json(event["envelope"])
