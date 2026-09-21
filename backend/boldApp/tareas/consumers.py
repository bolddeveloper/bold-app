from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer


@database_sync_to_async
def authorize_connection(ticket_key, unit_id):
    from django.db.models import F, Q
    from django.utils import timezone

    from boldApp.autenticacion.models import AuthSession
    from boldApp.autenticacion.services import consume_ws_ticket
    from boldApp.core.authorization import resolve_access
    from boldApp.core.models import OrganizationalUnit, Permission, PositionAssignment

    try:
        ticket = consume_ws_ticket(ticket_key)
        if not ticket or ticket.get("channel") != "tasks" or ticket.get("unit") != str(unit_id):
            return None
        now = timezone.now()
        session = (
            AuthSession.objects.select_related("user_account__employee")
            .filter(
                id=ticket["session"],
                user_account_id=ticket["user"],
                user_account__is_active=True,
                user_account__employee__is_active=True,
                revoked_at__isnull=True,
                expires_at__gt=now,
                credentials_version=F("user_account__credentials_version"),
            )
            .filter(Q(idle_expires_at__isnull=True) | Q(idle_expires_at__gt=now))
            .get()
        )
        assignment = PositionAssignment.objects.select_related(
            "employee__user_account",
            "position__unit",
            "position__job_role",
        ).get(
            id=ticket["assignment"],
            employee_id=session.user_account.employee_id,
            employee__is_active=True,
            is_active=True,
            released_at__isnull=True,
        )
        unit = OrganizationalUnit.objects.get(id=unit_id)
        permission = Permission.objects.get(code="tasks.task.read", is_active=True)
    except (
        AuthSession.DoesNotExist,
        PositionAssignment.DoesNotExist,
        OrganizationalUnit.DoesNotExist,
        Permission.DoesNotExist,
        ValueError,
        KeyError,
    ):
        return None
    if not resolve_access(assignment, permission, unit).allowed:
        return None
    return {
        "session": str(session.id),
        "assignment": str(assignment.id),
        "unit": str(unit.id),
    }


@database_sync_to_async
def connection_still_authorized(session_id, assignment_id, unit_id):
    from django.db.models import F, Q
    from django.utils import timezone

    from boldApp.autenticacion.models import AuthSession
    from boldApp.core.authorization import resolve_access
    from boldApp.core.models import OrganizationalUnit, Permission, PositionAssignment

    now = timezone.now()
    try:
        session = (
            AuthSession.objects.select_related("user_account__employee")
            .filter(
                id=session_id,
                user_account__is_active=True,
                user_account__employee__is_active=True,
                revoked_at__isnull=True,
                expires_at__gt=now,
                credentials_version=F("user_account__credentials_version"),
            )
            .filter(Q(idle_expires_at__isnull=True) | Q(idle_expires_at__gt=now))
            .get()
        )
        assignment = PositionAssignment.objects.select_related(
            "employee__user_account", "position__unit", "position__job_role"
        ).get(
            id=assignment_id,
            employee_id=session.user_account.employee_id,
            employee__is_active=True,
            is_active=True,
            released_at__isnull=True,
        )
        unit = OrganizationalUnit.objects.get(id=unit_id)
        permission = Permission.objects.get(code="tasks.task.read", is_active=True)
    except (
        AuthSession.DoesNotExist,
        PositionAssignment.DoesNotExist,
        OrganizationalUnit.DoesNotExist,
        Permission.DoesNotExist,
        ValueError,
    ):
        return False
    return resolve_access(assignment, permission, unit).allowed


class TaskEventsConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        query = parse_qs(self.scope.get("query_string", b"").decode("utf-8"))
        ticket = query.get("ticket", [None])[0]
        unit_id = self.scope["url_route"]["kwargs"]["unit_id"]
        identity = await authorize_connection(ticket, unit_id) if ticket else None
        if not identity:
            await self.close(code=4403)
            return

        self.session_id = identity["session"]
        self.assignment_id = identity["assignment"]
        self.unit_id = identity["unit"]
        self.unit_group_name = f"unit_{unit_id}"
        self.session_group_name = f"session_{self.session_id}"
        self.assignment_group_name = f"assignment_{self.assignment_id}"
        self.permission_group_name = "permission_watch"
        for group in (
            self.unit_group_name,
            self.session_group_name,
            self.assignment_group_name,
            self.permission_group_name,
        ):
            await self.channel_layer.group_add(group, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        for attribute in (
            "unit_group_name",
            "session_group_name",
            "assignment_group_name",
            "permission_group_name",
        ):
            group = getattr(self, attribute, None)
            if group:
                await self.channel_layer.group_discard(group, self.channel_name)

    async def _revalidate(self):
        allowed = await connection_still_authorized(
            self.session_id,
            self.assignment_id,
            self.unit_id,
        )
        if not allowed:
            await self.close(code=4403)
        return allowed

    async def task_event(self, event):
        if await self._revalidate():
            await self.send_json(event["envelope"])

    async def permission_changed(self, event):
        await self._revalidate()

    async def session_revoked(self, event):
        await self.close(code=4403)

    async def assignment_changed(self, event):
        await self._revalidate()
