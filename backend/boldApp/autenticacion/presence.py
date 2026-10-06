"""Authenticated connection presence, independent of login/session lifetime.

Heartbeats ride the existing security WebSocket. No HTTP polling, passwords,
emails, tokens, event titles, attendees or meeting URLs in the public projection.
"""
import logging
from datetime import timedelta
from django.core.cache import caches
from django.db import transaction
from django.db.models import F, Q, Prefetch
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from rest_framework import serializers
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from boldApp.core.models import UserAccount, PositionAssignment
from boldApp.core.permissions import HasActiveAssignment
from .models import AuthSession

log = logging.getLogger(__name__)
HEARTBEAT_TTL = 90
DEFAULTS = {"status": "online", "title": "", "description": "", "calendar_automatic": True, "duration_minutes": 0, "expires_at": None}
DURATIONS = (0, 15, 30, 60, 120)
STATUSES = ("online", "away", "busy", "vacation", "custom")


def settings_for(account, now=None):
    value = {**DEFAULTS, **account.presence_settings}
    # Previously selectable offline/meeting are now automatic, never persisted
    # overrides. Old preferences must not hide a connected person indefinitely.
    if value["status"] not in STATUSES:
        value.update(status="online", duration_minutes=0, expires_at=None)
    if value["duration_minutes"] not in DURATIONS:
        value["duration_minutes"] = 0  # Keep an existing expiry until it elapses.
    # Resolve expiry on reads, even when the browser has closed.
    if value["status"] in ("away", "busy") and value["expires_at"]:
        try:
            expiry = parse_datetime(value["expires_at"])
            expired = not expiry or timezone.is_naive(expiry) or expiry <= (now or timezone.now())
        except (ValueError, TypeError):
            expired = True
        if expired:
            value.update(status="online", duration_minutes=0, expires_at=None)
    return value


def session_key(session_id):
    return f"session:{session_id}"


def valid_sessions():
    now = timezone.now()
    return AuthSession.objects.filter(
        revoked_at__isnull=True, expires_at__gt=now, user_account__is_active=True,
        user_account__employee__is_active=True, credentials_version=F("user_account__credentials_version"),
    ).filter(Q(idle_expires_at__isnull=True) | Q(idle_expires_at__gt=now))


def connected_account_ids():
    sessions = list(valid_sessions().values_list("id", "user_account_id"))
    beacons = caches["presence"].get_many([session_key(pk) for pk, _ in sessions])
    now = timezone.now().timestamp()
    return {account_id for pk, account_id in sessions if 0 <= now - beacons.get(session_key(pk), 0) < HEARTBEAT_TTL}


def effective_status(account, connection=None, now=None, schedule=None):
    value = settings_for(account, now)
    # Vacation is a deliberate override, not undone by a calendar event.
    if value["status"] != "vacation" and value["calendar_automatic"] and connection:
        cached = schedule if schedule is not None else caches["presence"].get(f"meetings:{account.pk}", {})
        stamp = (now or timezone.now()).timestamp()
        if cached.get("subject") == connection.subject and cached.get("scopes") == connection.scopes and any(start <= stamp < end for start, end in cached.get("windows", [])):
            return "meeting"
    return value["status"]


def presence_directory():
    from boldApp.workspace.models import GoogleConnection
    ids = connected_account_ids()
    assignments = PositionAssignment.objects.filter(is_active=True, released_at__isnull=True).select_related("position__unit")
    accounts = UserAccount.objects.filter(pk__in=ids).select_related("employee").only(
        "id", "employee_id", "presence_settings", "employee__id", "employee__full_name").prefetch_related(
        Prefetch("employee__position_assignments", queryset=assignments, to_attr="presence_assignments"))
    connections = {row.user_id: row for row in GoogleConnection.objects.filter(user_id__in=ids).only("user_id", "subject", "scopes")}
    schedules = caches["presence"].get_many([f"meetings:{pk}" for pk in connections])
    rows = []
    for account in accounts:
        placements = account.employee.presence_assignments
        if not placements:
            continue
        status = effective_status(account, connections.get(account.pk), schedule=schedules.get(f"meetings:{account.pk}", {}))
        if status == "offline":
            continue
        units = {str(a.position.unit_id): {"id": str(a.position.unit_id), "name": a.position.unit.name} for a in placements}
        preferences = settings_for(account)
        rows.append({"employee_id": str(account.employee_id), "name": account.employee.full_name,
                     "units": sorted(units.values(), key=lambda unit: unit["name"]), "status": status,
                     "title": preferences["title"] if status == "custom" else "",
                     "description": preferences["description"] if status == "custom" else ""})
    return {"rows": sorted(rows, key=lambda row: (row["name"].casefold(), row["employee_id"])),
            "updated_at": timezone.now().isoformat(), "grace_seconds": HEARTBEAT_TTL}


def heartbeat_snapshot(session_id):
    # Caller already verified session + active assignment in security_snapshot.
    try:
        caches["presence"].set(session_key(session_id), timezone.now().timestamp(), HEARTBEAT_TTL)
        return presence_directory()
    except Exception:
        # Cache outages must not invalidate authentication or fake an online roster.
        log.warning("Presence directory unavailable", exc_info=True)
        return None


def announce_presence():
    try:
        layer = get_channel_layer()
        if layer:
            async_to_sync(layer.group_send)("presence_watch", {"type": "presence.changed"})
    except Exception:
        # Preference is already committed; a failed push must not report a failed save.
        # The next existing control heartbeat reconciles the state.
        log.warning("Presence update broadcast unavailable", exc_info=True)


class PresenceSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=STATUSES, required=False)
    title = serializers.CharField(max_length=60, allow_blank=True, required=False)
    description = serializers.CharField(max_length=160, allow_blank=True, required=False)
    calendar_automatic = serializers.BooleanField(required=False)
    duration_minutes = serializers.ChoiceField(choices=DURATIONS, required=False)

    def validate(self, attrs):
        if set(self.initial_data) - set(self.fields):
            raise serializers.ValidationError("Solo puedes modificar tu propio estado.")
        result = {**self.context["existing"], **attrs}
        if result["status"] not in ("away", "busy"):
            if attrs.get("duration_minutes"):
                raise serializers.ValidationError({"duration_minutes": "La duración solo corresponde a Ausente u Ocupado."})
            result.update(duration_minutes=0, expires_at=None)
        elif "duration_minutes" in attrs or "status" in attrs:
            minutes = attrs.get("duration_minutes", 0)
            result.update(duration_minutes=minutes, expires_at=(timezone.now() + timedelta(minutes=minutes)).isoformat() if minutes else None)
        if result["status"] == "custom" and not result["title"].strip():
            raise serializers.ValidationError({"title": "Escribe un título para el estado personalizado."})
        return result


class PresenceSettingsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(settings_for(request.user))

    def patch(self, request):
        from boldApp.administrativo.services import record_system_event
        with transaction.atomic():
            account = UserAccount.objects.select_for_update().get(pk=request.user.pk)
            serializer = PresenceSerializer(data=request.data, context={"existing": settings_for(account)})
            serializer.is_valid(raise_exception=True)
            account.presence_settings = serializer.validated_data
            account.save(update_fields=["presence_settings", "updated_at"])
            record_system_event("profile.presence_updated", request, module_code="profile", metadata={"status": account.presence_settings["status"]})
            transaction.on_commit(announce_presence)
        return Response(account.presence_settings)


class PresenceDirectoryView(APIView):
    permission_classes = [HasActiveAssignment]

    def get(self, request):
        # Explicit refresh only. Regular updates arrive on the existing socket.
        return Response(presence_directory())
