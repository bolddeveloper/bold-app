"""Private BOLD calendars. These operations never write to Google Calendar."""
import re
from datetime import date, datetime, time, timedelta, timezone as tz

from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from boldApp.core.models import UserAccount
from .models import AppCalendar, AppCalendarEvent, CalendarMember, CalendarTeamShare
from .service import validate_event


def accessible(user):
    return AppCalendar.objects.filter(Q(owner=user) | Q(members__user=user)).distinct()


def calendar_for(user, identity, *, write=False, manage=False):
    calendar = get_object_or_404(accessible(user), pk=identity)
    role = "manager" if calendar.owner_id == user.pk else calendar.members.filter(user=user).values_list("role", flat=True).first()
    if (manage and role != "manager") or (write and role not in ("manager", "editor")):
        raise PermissionDenied("No tienes permiso para modificar este calendario.")
    return calendar


def people(calendar):
    rows = [{"email": calendar.owner.email, "name": str(calendar.owner.employee), "role": "owner"}]
    rows.extend({"email": row.user.email, "name": str(row.user.employee), "role": row.role} for row in calendar.members.select_related("user__employee").filter(user__is_active=True))
    return rows


def public_calendar(calendar, user):
    role = "manager" if calendar.owner_id == user.pk else calendar.members.filter(user=user).values_list("role", flat=True).first()
    return {"id": str(calendar.pk), "name": calendar.name, "protected": bool(calendar.system_key), "can_edit": role in ("manager", "editor"), "can_manage": role == "manager", "can_delete": calendar.owner_id == user.pk and not calendar.system_key, "members": people(calendar), "share_team": role == "manager" and calendar.team_shares.filter(user=user).exists()}


def name_value(data):
    name = data.get("name")
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= 120:
        raise ValidationError("Escribe un nombre de hasta 120 caracteres.")
    return name.strip()


class LocalCalendarsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({"calendars": [public_calendar(row, request.user) for row in accessible(request.user).select_related("owner__employee").order_by("created_at")]})

    def post(self, request):
        calendar = AppCalendar.objects.create(name=name_value(request.data), owner=request.user)
        return Response(public_calendar(calendar, request.user), status=201)


class LocalCalendarView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, calendar_id):
        calendar = calendar_for(request.user, calendar_id, manage=True)
        calendar.name = name_value(request.data)
        if calendar.system_key:
            raise ValidationError("El nombre de Calendario producción es permanente.")
        calendar.save(update_fields=["name"])
        return Response(public_calendar(calendar, request.user))

    def delete(self, request, calendar_id):
        calendar = calendar_for(request.user, calendar_id, manage=True)
        if calendar.system_key or calendar.owner_id != request.user.pk:
            raise PermissionDenied("Calendario producción no se puede eliminar. Los demás solo puede eliminarlos su propietario.")
        calendar.delete()
        return Response(status=204)


class LocalTeamShareView(APIView):
    permission_classes = [IsAuthenticated]

    def put(self, request, calendar_id):
        calendar = calendar_for(request.user, calendar_id, manage=True)
        enabled = request.data.get("share_team")
        if not isinstance(enabled, bool):
            raise ValidationError("Indica si quieres compartir la agenda con Equipo.")
        if enabled:
            CalendarTeamShare.objects.get_or_create(calendar=calendar, user=request.user)
        else:
            calendar.team_shares.filter(user=request.user).delete()
        return Response(public_calendar(calendar, request.user))


class LocalMembersView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def put(self, request, calendar_id):
        calendar = calendar_for(request.user, calendar_id, manage=True)
        email, role = request.data.get("email"), request.data.get("role")
        if not isinstance(email, str) or role not in ("reader", "editor", "manager", "remove"):
            raise ValidationError("Selecciona una persona de BOLD y un permiso válido.")
        user = get_object_or_404(UserAccount, email__iexact=email.strip(), is_active=True)
        if user.pk == calendar.owner_id:
            raise ValidationError("El propietario conserva su acceso de administración.")
        if role == "remove":
            calendar.members.filter(user=user).delete()
        else:
            CalendarMember.objects.update_or_create(calendar=calendar, user=user, defaults={"role": role})
        if role != "manager":
            calendar.team_shares.filter(user=user).delete()
        return Response(public_calendar(calendar, request.user))


def event_times(data):
    try:
        if "date" in data["start"]:
            start = datetime.combine(date.fromisoformat(data["start"]["date"]), time(), tz.utc)
            end = datetime.combine(date.fromisoformat(data["end"]["date"]), time(), tz.utc)
        else:
            start = datetime.fromisoformat(data["start"]["dateTime"].replace("Z", "+00:00"))
            end = datetime.fromisoformat(data["end"]["dateTime"].replace("Z", "+00:00"))
            if not start.tzinfo or not end.tzinfo:
                raise ValueError()
        if end <= start:
            raise ValueError()
        return start, end
    except (KeyError, TypeError, ValueError):
        raise ValidationError("Indica inicio y fin válidos; las horas deben incluir zona horaria.")


def event_data(payload, calendar, current=None):
    if not isinstance(payload, dict):
        raise ValidationError("Evento inválido.")
    link = payload.get("hangoutLink", (current or {}).get("hangoutLink", ""))
    if not isinstance(link, str) or link and not re.fullmatch(r"https://meet\.google\.com/[a-z]{3}-[a-z]{4}-[a-z]{3}", link):
        raise ValidationError("Usa un enlace de Google Meet válido.")
    kind = payload.get("kind", (current or {}).get("kind", "event"))
    completed = payload.get("completed", (current or {}).get("completed", False))
    if kind not in ("event", "task") or not isinstance(completed, bool):
        raise ValidationError("Tipo o finalización de tarea inválidos.")
    visibility = payload.get("visibility", (current or {}).get("visibility", "default"))
    if visibility not in ("default", "private", "confidential"):
        raise ValidationError("Visibilidad inválida.")
    changes = validate_event({key: value for key, value in payload.items() if key not in {"hangoutLink", "kind", "completed", "visibility"}})
    if set(changes) & {"recurrence", "reminders", "addMeet", "removeMeet"}:
        raise ValidationError("Este calendario utiliza eventos individuales sin recordatorios de Google.")
    data = {**(current or {}), **changes, "hangoutLink": link, "kind": kind, "completed": completed if kind == "task" else False, "visibility": visibility}
    if not isinstance(data.get("summary"), str) or not data["summary"].strip():
        raise ValidationError("Escribe el título del evento.")
    allowed = {row["email"].lower() for row in people(calendar)}
    if any(person["email"].strip().lower() not in allowed for person in data.get("attendees", [])):
        raise ValidationError("Añade primero a esas personas al calendario para que puedan ver el evento.")
    event_times(data)
    return data


def public_event(row, *, editable):
    return {**row.data, "id": str(row.pk), "locked": not editable, "etag": row.updated_at.isoformat()}


class LocalEventsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, calendar_id):
        calendar = calendar_for(request.user, calendar_id)
        try:
            start = datetime.fromisoformat(request.query_params["start"].replace("Z", "+00:00"))
            end = datetime.fromisoformat(request.query_params["end"].replace("Z", "+00:00"))
            if not start.tzinfo or not end.tzinfo or not start < end <= start + timedelta(days=93):
                raise ValueError()
        except (KeyError, ValueError):
            raise ValidationError("Selecciona un rango de hasta 93 días.")
        rows = calendar.events.filter(start_at__lt=end, end_at__gt=start).order_by("start_at", "id")
        editable = public_calendar(calendar, request.user)["can_edit"]
        return Response({"events": [public_event(row, editable=editable) for row in rows]})

    def post(self, request, calendar_id):
        calendar = calendar_for(request.user, calendar_id, write=True)
        data = event_data(request.data, calendar)
        start, end = event_times(data)
        row = calendar.events.create(data=data, start_at=start, end_at=end)
        return Response(public_event(row, editable=True), status=201)


class LocalEventView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def patch(self, request, calendar_id, event_id):
        calendar = calendar_for(request.user, calendar_id, write=True)
        row = get_object_or_404(calendar.events.select_for_update(), pk=event_id)
        data = event_data(request.data, calendar, row.data)
        row.data = data
        row.start_at, row.end_at = event_times(data)
        row.save(update_fields=["data", "start_at", "end_at", "updated_at"])
        return Response(public_event(row, editable=True))

    def delete(self, request, calendar_id, event_id):
        calendar = calendar_for(request.user, calendar_id, write=True)
        get_object_or_404(calendar.events, pk=event_id).delete()
        return Response(status=204)


class LocalMeetView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, calendar_id):
        calendar_for(request.user, calendar_id, write=True)
        from boldApp.workspace.google_config import public_connection
        from boldApp.workspace.service import google, Reconnect
        if public_connection(request.user)["services"]["meet"]["status"] != "available":
            raise Reconnect("Autoriza Google Meet para crear enlaces sin añadir eventos a Google Calendar.")
        result = google(request.user, "POST", "/spaces", api="meet", body={})
        return Response({"hangoutLink": result["meetingUri"]}, status=201)
