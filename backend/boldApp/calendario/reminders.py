"""Personal meeting reminders use the existing notification inbox and deduplication."""
from datetime import timedelta
from hashlib import sha256
import logging

from django.core.cache import caches
from django.utils import timezone

from boldApp.core.models import PositionAssignment
from boldApp.notificaciones.services import create_notification
from boldApp.workspace.google_config import SCOPES
from boldApp.workspace.models import GoogleConnection
from .models import CalendarDraft
from .presence import meeting_window
from .service import event_path, google_request

log = logging.getLogger(__name__)


def send_reminders(user, events, now=None):
    now = now or timezone.now()
    connection = GoogleConnection.objects.filter(user=user).first()
    if not connection:
        return 0
    recipients = list(PositionAssignment.objects.select_related("employee__user_account").filter(
        employee=user.employee, employee__is_active=True, employee__user_account__is_active=True, is_active=True, released_at__isnull=True))
    drafts = set(CalendarDraft.objects.filter(owner=user).values_list("event_id", flat=True))
    count = 0
    for event in events:
        window = meeting_window(event)
        if not window or event.get("id") in drafts or not event.get("id") or window[1] <= now.timestamp():
            continue
        email = connection.email.lower()
        if any(person.get("responseStatus") == "declined" and (person.get("self") or person.get("email", "").lower() == email) for person in event.get("attendees", [])):
            continue
        organizer = event.get("organizer", {})
        participates = organizer.get("self") or organizer.get("email", "").lower() == email or any(
            person.get("self") or person.get("email", "").lower() == email for person in event.get("attendees", []))
        if not participates:
            continue
        for minutes in (30, 5, 0):
            due = window[0] - minutes * 60
            if not now.timestamp() - 75 < due <= now.timestamp():
                continue
            title = "Tu reunión empieza ahora" if minutes == 0 else f"Tu reunión empieza en {minutes} minutos"
            for recipient in recipients:
                notification = create_notification(recipient=recipient, event_type="calendar.meeting_reminder", title=title,
                    body=event.get("summary", "Reunión"), route={"module": "calendar", "target": "calendar", "event_id": event["id"], "date": event["start"]["dateTime"]},
                    metadata={"minutes": minutes}, dedupe_key="calendar:" + sha256(f"{connection.pk}:{event['id']}:{int(window[0])}:{minutes}".encode()).hexdigest())
                count += bool(notification)
    return count


def refresh_reminders(user):
    connection = GoogleConnection.objects.filter(user=user).first()
    if not connection or not SCOPES["calendar"] <= set(connection.scopes.split()):
        return 0
    now = timezone.now()
    events, page = [], None
    try:
        if not caches["presence"].add(f"calendar-reminders:{user.pk}", True, 55):
            return 0
        for _ in range(4):
            params = {"timeMin": (now - timedelta(minutes=1)).isoformat(), "timeMax": (now + timedelta(minutes=31)).isoformat(), "singleEvents": "true", "maxResults": 250, "orderBy": "startTime"}
            if page:
                params["pageToken"] = page
            result = google_request(user, "GET", event_path(), params=params)
            events.extend(result.get("items", []))
            page = result.get("nextPageToken")
            if not page:
                return send_reminders(user, events, timezone.now())
    except Exception:
        log.warning("Calendar reminder refresh unavailable for account %s", user.pk)
    return 0
