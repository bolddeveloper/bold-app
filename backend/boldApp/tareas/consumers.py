from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer


@database_sync_to_async
def authorize_connection(token_key, assignment_id, unit_id):
    from rest_framework.authtoken.models import Token

    from boldApp.core.authorization import resolve_access
    from boldApp.core.models import OrganizationalUnit, Permission, PositionAssignment

    try:
        token = Token.objects.select_related("user__employee").get(key=token_key)
        assignment = PositionAssignment.objects.select_related(
            "employee",
            "position__unit",
            "position__job_role",
        ).get(
            id=assignment_id,
            employee_id=token.user.employee_id,
            is_active=True,
            released_at__isnull=True,
        )
        unit = OrganizationalUnit.objects.get(id=unit_id)
        permission = Permission.objects.get(code="tasks.task.read")
    except (Token.DoesNotExist, PositionAssignment.DoesNotExist, OrganizationalUnit.DoesNotExist, Permission.DoesNotExist, ValueError):
        return False

    return resolve_access(assignment, permission, unit).allowed


class TaskEventsConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        query = parse_qs(self.scope.get("query_string", b"").decode("utf-8"))
        token = query.get("token", [None])[0]
        assignment = query.get("assignment", [None])[0]
        unit_id = self.scope["url_route"]["kwargs"]["unit_id"]

        if not token or not assignment or not await authorize_connection(token, assignment, unit_id):
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
