from datetime import date, datetime
from urllib.parse import quote

import requests
from cryptography.fernet import InvalidToken
from django.conf import settings
from django.utils import timezone
from rest_framework.exceptions import APIException, ValidationError

from boldApp.autenticacion.services import decrypt_secret

from .models import GoogleCalendarConnection

GOOGLE_API = "https://www.googleapis.com/calendar/v3"
GOOGLE_TOKEN = "https://oauth2.googleapis.com/token"


class CalendarUnavailable(APIException):
    status_code = 503
    default_detail = "Google Calendar no está disponible. Inténtalo de nuevo."


class CalendarReconnect(APIException):
    status_code = 409
    default_detail = "La conexión con Google venció. Pide al dueño que vuelva a conectarla."


def configured():
    return all((settings.GOOGLE_CALENDAR_CLIENT_ID, settings.GOOGLE_CALENDAR_CLIENT_SECRET, settings.GOOGLE_CALENDAR_REDIRECT_URI))


def _token(connection):
    # ponytail: refresh per request avoids sharing access-token state; cache it if Google latency becomes noticeable.
    try:
        refresh = decrypt_secret(connection.refresh_token_encrypted)
    except (InvalidToken, ValueError) as exc:
        raise CalendarReconnect() from exc
    try:
        response = requests.post(GOOGLE_TOKEN, data={
            "client_id": settings.GOOGLE_CALENDAR_CLIENT_ID,
            "client_secret": settings.GOOGLE_CALENDAR_CLIENT_SECRET,
            "refresh_token": refresh,
            "grant_type": "refresh_token",
        }, timeout=12)
    except requests.RequestException as exc:
        raise CalendarUnavailable() from exc
    if response.status_code != 200:
        if response.status_code in (400, 401):
            raise CalendarReconnect()
        raise CalendarUnavailable()
    return response.json()["access_token"]


def google_request(method, path, *, params=None, body=None, base=None):
    connection = GoogleCalendarConnection.objects.first()
    if not connection:
        raise CalendarReconnect("Todavía no se ha conectado Google Calendar.")
    token = _token(connection)
    try:
        response = requests.request(method, f"{base or GOOGLE_API}{path}", params=params, json=body,
                                    headers={"Authorization": f"Bearer {token}"}, timeout=15)
    except requests.RequestException as exc:
        raise CalendarUnavailable() from exc
    if response.status_code == 401:
        raise CalendarReconnect()
    if response.status_code == 403:
        if base == "https://people.googleapis.com":
            raise ValidationError("Google Contacts no autorizó la búsqueda. Activa People API en Cloud y reconecta la cuenta en Conectores.")
        if base:
            raise ValidationError("Google Tasks no autorizó la operación. Activa Google Tasks API en Cloud y reconecta la cuenta en Conectores.")
        raise ValidationError("Google no permite esta acción en el calendario principal.")
    if response.status_code == 404:
        raise ValidationError("El evento ya no existe en Google Calendar.")
    if response.status_code == 410 and method == "DELETE":
        return None
    if response.status_code >= 500 or response.status_code == 429:
        raise CalendarUnavailable()
    if response.status_code >= 400:
        raise ValidationError(response.json().get("error", {}).get("message", "Google rechazó el evento."))
    connection.last_checked_at = timezone.now()
    connection.save(update_fields=["last_checked_at"])
    return response.json() if response.content else None


def event_path(event_id=""):
    return "/calendars/primary/events" + (f"/{quote(event_id, safe='')}" if event_id else "")


def validate_event(data):
    allowed = {"summary", "description", "location", "start", "end", "attendees", "reminders", "recurrence", "colorId", "addMeet", "removeMeet"}
    if not isinstance(data, dict) or set(data) - allowed:
        raise ValidationError("El evento contiene campos no permitidos.")
    result = {key: data[key] for key in allowed if key in data}
    for key in ("addMeet", "removeMeet"):
        if key in result and not isinstance(result[key], bool):
            raise ValidationError({key: "Valor inválido."})
    for key in ("summary", "description", "location"):
        if key in result and (not isinstance(result[key], str) or len(result[key]) > (200 if key == "summary" else 8000)):
            raise ValidationError({key: "Texto inválido o demasiado largo."})
    for key in ("start", "end"):
        if key in result:
            value = result[key]
            if not isinstance(value, dict) or set(value) - {"date", "dateTime", "timeZone"} or ("date" in value) == ("dateTime" in value):
                raise ValidationError({key: "Usa date o dateTime."})
            try:
                date.fromisoformat(value["date"]) if "date" in value else datetime.fromisoformat(value["dateTime"].replace("Z", "+00:00"))
            except (TypeError, ValueError) as exc:
                raise ValidationError({key: "Fecha inválida."}) from exc
    if ("start" in result) != ("end" in result):
        raise ValidationError("Inicio y fin deben enviarse juntos.")
    if "start" in result:
        start, end = result["start"], result["end"]
        if ("date" in start) != ("date" in end):
            raise ValidationError("Inicio y fin deben ser del mismo tipo.")
        field = "date" if "date" in start else "dateTime"
        first = date.fromisoformat(start[field]) if field == "date" else datetime.fromisoformat(start[field].replace("Z", "+00:00"))
        last = date.fromisoformat(end[field]) if field == "date" else datetime.fromisoformat(end[field].replace("Z", "+00:00"))
        if field == "dateTime" and (first.tzinfo is None) != (last.tzinfo is None):
            raise ValidationError("Inicio y fin deben usar la misma zona horaria.")
        if last <= first:
            raise ValidationError("El fin debe ser posterior al inicio.")
    if "attendees" in result:
        if not isinstance(result["attendees"], list) or len(result["attendees"]) > 100 or any(not isinstance(row, dict) or set(row) != {"email"} or not isinstance(row["email"], str) or "@" not in row["email"] for row in result["attendees"]):
            raise ValidationError({"attendees": "Lista de invitados inválida."})
    if "recurrence" in result and (not isinstance(result["recurrence"], list) or len(result["recurrence"]) > 2 or any(not isinstance(rule, str) or not rule.startswith(("RRULE:", "EXDATE:")) for rule in result["recurrence"])):
        raise ValidationError({"recurrence": "Recurrencia inválida."})
    if "reminders" in result:
        reminders = result["reminders"]
        if not isinstance(reminders, dict) or set(reminders) - {"useDefault", "overrides"}:
            raise ValidationError({"reminders": "Recordatorios inválidos."})
        overrides = reminders.get("overrides", [])
        if not isinstance(overrides, list) or len(overrides) > 5 or any(not isinstance(row, dict) or row.get("method") not in ("email", "popup") or not isinstance(row.get("minutes"), int) or not 0 <= row["minutes"] <= 40320 for row in overrides):
            raise ValidationError({"reminders": "Recordatorios inválidos."})
    if "colorId" in result and result["colorId"] is not None and result["colorId"] not in {str(number) for number in range(1, 12)}:
        raise ValidationError({"colorId": "Color inválido."})
    return result


def public_event(event):
    fields = ("id", "summary", "description", "location", "start", "end", "attendees", "reminders", "recurrence", "recurringEventId", "originalStartTime", "eventType", "status", "colorId", "htmlLink", "etag", "organizer", "hangoutLink", "conferenceData", "locked", "source")
    return {key: event[key] for key in fields if key in event}


def is_task_mirror(event):
    source = event.get("source") or {}
    return "tasks.google.com" in source.get("url", "") or (
        "tasks.google.com/tasks/" in event.get("description", "")
        and "Changes made to the title, description, or attachments will not be saved." in event.get("description", "")
    )
