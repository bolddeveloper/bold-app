from datetime import date, datetime
from urllib.parse import quote

from rest_framework.exceptions import APIException, ValidationError, NotFound


class CalendarUnavailable(APIException):
    status_code = 503
    default_detail = "Google Calendar no está disponible. Inténtalo de nuevo."


class CalendarReconnect(APIException):
    status_code = 409
    default_detail = "La conexión con Google venció. Vuelve a conectar tu cuenta."


def configured():
    from boldApp.workspace.service import configured as common
    return common()


def google_request(user, method, path, *, params=None, body=None, base=None):
    from boldApp.workspace.google_config import public_connection
    from boldApp.workspace.service import google, Reconnect, GoogleUnavailable
    service = "people" if base == "https://people.googleapis.com" else "tasks" if base == "https://tasks.googleapis.com" else "calendar"
    grant = "contacts" if service == "people" else service
    status = public_connection(user)["services"][grant]["status"]
    if status != "available":
        raise CalendarReconnect("Conecta tu cuenta y autoriza " + grant + " en Conectores.")
    resource = path.removeprefix("/v1") if service == "people" else path.removeprefix("/tasks/v1") if service == "tasks" else path
    try:
        return google(user, method, resource, api=service, params=params, body=body)
    except NotFound as error:
        raise ValidationError("El evento ya no existe en Google Calendar.") from error
    except Reconnect as error:
        raise CalendarReconnect(str(error.detail)) from error
    except GoogleUnavailable as error:
        raise CalendarUnavailable() from error


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
