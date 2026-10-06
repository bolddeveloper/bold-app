"""Only time windows leave Calendar; never event content or participant details."""
from datetime import timedelta
import logging
from django.core.cache import caches
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.exceptions import APIException
from boldApp.workspace.models import GoogleConnection
from .models import CalendarDraft
from .service import event_path, google_request, is_task_mirror

SCHEDULE_TTL = 300
log = logging.getLogger(__name__)


def meeting_window(event):
    if event.get("status") == "cancelled" or event.get("transparency") == "transparent" or is_task_mirror(event):
        return None
    attendees = event.get("attendees", [])
    if any(person.get("self") and person.get("responseStatus") == "declined" for person in attendees):
        return None
    has_company = any(not person.get("self") and person.get("responseStatus") != "declined" for person in attendees)
    if not (has_company or event.get("hangoutLink") or (event.get("conferenceData") or {}).get("entryPoints")):
        return None
    try:
        start = parse_datetime(event.get("start", {}).get("dateTime", ""))
        end = parse_datetime(event.get("end", {}).get("dateTime", ""))
        if not start or not end or timezone.is_naive(start) or timezone.is_naive(end) or end <= start:
            return None
        return [start.timestamp(), end.timestamp()]
    except (ValueError, TypeError):
        return None


def store_windows(user, events, start, end):
    now = timezone.now()
    if not start <= now < end:
        return  # A historical/future calendar view must not replace the current schedule.
    connection = GoogleConnection.objects.filter(user=user).first()
    if not connection:
        return
    drafts = set(CalendarDraft.objects.filter(owner=user).values_list("event_id", flat=True))
    windows = [window for event in events if event.get("id") not in drafts and (window := meeting_window(event))]
    try:
        caches["presence"].set(f"meetings:{user.pk}", {"subject": connection.subject, "scopes": connection.scopes, "windows": windows}, SCHEDULE_TTL)
    except Exception:
        log.warning("Calendar presence cache unavailable", exc_info=True)


def refresh_meetings(user):
    # Short horizon with expanded recurrence. No Google call in security WebSockets.
    start, end = timezone.now(), timezone.now() + timedelta(hours=24)
    items, page = [], None
    try:
        for _ in range(4):
            params = {"timeMin": start.isoformat(), "timeMax": end.isoformat(), "singleEvents": "true", "maxResults": 250, "orderBy": "startTime"}
            if page:
                params["pageToken"] = page
            result = google_request(user, "GET", event_path(), params=params)
            items.extend(result.get("items", []))
            page = result.get("nextPageToken")
            if not page:
                store_windows(user, items, start, end)
                return True
    except APIException:
        pass
    # Permission/Google failures must not leave a false meeting status.
    caches["presence"].delete(f"meetings:{user.pk}")
    return False
