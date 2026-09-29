import json
import secrets
from datetime import date, datetime, timedelta
from urllib.parse import quote, urlencode, urlparse

import requests
from cryptography.fernet import InvalidToken
from django.conf import settings
from django.core import signing
from django.db import transaction
from django.http import HttpResponse
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from boldApp.administrativo.permissions import IsCompanyOwner
from boldApp.administrativo.services import record_system_event
from boldApp.autenticacion.services import decrypt_secret, encrypt_secret
from boldApp.autenticacion.models import AuthSession

from .models import CalendarDraft, GoogleCalendarConnection
from .service import CalendarReconnect, CalendarUnavailable, configured, event_path, google_request, is_task_mirror, public_event, validate_event

SCOPES = " ".join((
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.calendars.readonly",
    "https://www.googleapis.com/auth/tasks",
    "https://www.googleapis.com/auth/contacts.readonly",
    "https://www.googleapis.com/auth/contacts.other.readonly",
    "https://www.googleapis.com/auth/userinfo.email",
))


class CalendarConnectionView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        connection = GoogleCalendarConnection.objects.first()
        return Response({
            "configured": configured(), "connected": bool(connection),
            "callback_origin": f"{urlparse(settings.GOOGLE_CALENDAR_REDIRECT_URI).scheme}://{urlparse(settings.GOOGLE_CALENDAR_REDIRECT_URI).netloc}" if configured() else "",
            "email": connection.email if connection else "",
            "time_zone": connection.time_zone if connection else "UTC",
            "connected_at": connection.connected_at if connection else None,
            "last_checked_at": connection.last_checked_at if connection else None,
            "owner": bool(request.user.is_superuser),
        })

    def delete(self, request):
        if not request.user.is_superuser:
            raise PermissionDenied("Solo el dueño puede desconectar Google Calendar.")
        connection = GoogleCalendarConnection.objects.first()
        if connection:
            for draft in CalendarDraft.objects.filter(calendar_email=connection.email):
                try:
                    google_request("DELETE", event_path(draft.event_id), params={"sendUpdates": "none"})
                except ValidationError as error:
                    if "ya no existe" not in str(error):
                        raise
                draft.delete()
            try:
                token = decrypt_secret(connection.refresh_token_encrypted)
            except (InvalidToken, ValueError):
                token = None
            connection.delete()
            if token:
                try:
                    requests.post("https://oauth2.googleapis.com/revoke", data={"token": token}, timeout=8)
                except requests.RequestException:
                    pass
            record_system_event("calendar.disconnected", request, module_code="calendar")
        return Response({"connected": False})


class CalendarOAuthStartView(APIView):
    permission_classes = [IsCompanyOwner]

    def post(self, request):
        if not configured():
            raise ValidationError("Google Cloud aún no está configurado en el servidor.")
        if not getattr(request.auth, "id", None):
            raise PermissionDenied("Inicia sesión de nuevo antes de conectar Google.")
        origin = request.headers.get("Origin")
        state = signing.dumps({"user": str(request.user.pk), "session": str(request.auth.pk), "nonce": secrets.token_urlsafe(24), "origin": origin if origin in settings.CORS_ALLOWED_ORIGINS else settings.FRONTEND_URL.rstrip("/")}, salt="bold-calendar-oauth")
        query = urlencode({
            "client_id": settings.GOOGLE_CALENDAR_CLIENT_ID,
            "redirect_uri": settings.GOOGLE_CALENDAR_REDIRECT_URI,
            "response_type": "code", "scope": SCOPES, "access_type": "offline",
            "prompt": "consent", "state": state,
        })
        return Response({"authorization_url": f"https://accounts.google.com/o/oauth2/v2/auth?{query}"})


def _popup(status, origin=None):
    origin = origin if origin in settings.CORS_ALLOWED_ORIGINS else f"{urlparse(settings.FRONTEND_URL).scheme}://{urlparse(settings.FRONTEND_URL).netloc}"
    message = json.dumps({"type": "bold:google-calendar", "status": status})
    labels = {"connected": "Google Calendar quedó conectado.", "cancelled": "Cancelaste el permiso de Google.", "invalid_state": "La solicitud venció. Cierra esta ventana e inicia una conexión nueva.", "invalid_client": "Google rechazó el cliente OAuth. Revisa el ID y el secreto del servidor.", "missing_refresh_token": "Google no entregó acceso sin conexión. Inicia una conexión nueva.", "failed": "No se pudo completar la conexión. Revisa las credenciales y los permisos de Google Calendar."}
    html = f'<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Google Calendar · Bold</title><style>body{{font:16px system-ui,sans-serif;background:#0b1729;color:#edf4ff;min-height:100vh;display:grid;place-content:center;margin:0;padding:24px}}main{{max-width:420px;background:#14243d;border:1px solid #30445f;border-radius:16px;padding:28px}}h1{{font-size:21px;margin:0 0 12px}}p{{line-height:1.5}}a{{color:#ff5268}}</style></head><body><main><h1>Google Calendar</h1><p>{labels[status]}</p><a href="{origin}">Volver a Bold</a></main><script>window.opener?.postMessage({message}, {json.dumps(origin)});{"window.close();" if status == "connected" else ""}</script></body></html>'
    return HttpResponse(html, content_type="text/html; charset=utf-8")


class CalendarOAuthCallbackView(APIView):
    authentication_classes = []
    permission_classes = []

    def get(self, request):
        try:
            state = signing.loads(request.query_params.get("state", ""), salt="bold-calendar-oauth", max_age=600)
        except signing.BadSignature:
            return _popup("invalid_state")
        origin = state.get("origin")
        session = AuthSession.objects.select_related("user_account").filter(pk=state.get("session"), revoked_at__isnull=True).first()
        if not session or str(session.user_account_id) != state.get("user") or not session.user_account.is_active or not session.user_account.is_superuser or session.expires_at <= timezone.now():
            return _popup("invalid_state", origin)
        if request.query_params.get("error"):
            return _popup("cancelled", origin)
        code = request.query_params.get("code")
        if not code or not configured():
            return _popup("failed", origin)
        try:
            response = requests.post("https://oauth2.googleapis.com/token", data={
                "code": code, "client_id": settings.GOOGLE_CALENDAR_CLIENT_ID,
                "client_secret": settings.GOOGLE_CALENDAR_CLIENT_SECRET,
                "redirect_uri": settings.GOOGLE_CALENDAR_REDIRECT_URI,
                "grant_type": "authorization_code",
            }, timeout=12)
            if response.status_code in (400, 401) and response.json().get("error") == "invalid_client":
                return _popup("invalid_client", origin)
            response.raise_for_status()
            token = response.json()
            refresh = token.get("refresh_token")
            if not refresh:
                return _popup("missing_refresh_token", origin)
            identity = requests.get("https://www.googleapis.com/oauth2/v2/userinfo", headers={"Authorization": f"Bearer {token['access_token']}"}, timeout=12)
            identity.raise_for_status()
            calendar = requests.get("https://www.googleapis.com/calendar/v3/calendars/primary", headers={"Authorization": f"Bearer {token['access_token']}"}, timeout=12)
            calendar.raise_for_status()
            old_connection = GoogleCalendarConnection.objects.first()
            if old_connection and old_connection.email != identity.json().get("email", ""):
                for draft in CalendarDraft.objects.filter(calendar_email=old_connection.email):
                    try:
                        google_request("DELETE", event_path(draft.event_id), params={"sendUpdates": "none"})
                    except ValidationError as error:
                        if "ya no existe" not in str(error):
                            return _popup("failed", origin)
                    except (CalendarUnavailable, CalendarReconnect):
                        return _popup("failed", origin)
                    draft.delete()
            GoogleCalendarConnection.objects.update_or_create(pk=1, defaults={"email": identity.json().get("email", ""), "time_zone": calendar.json().get("timeZone", "UTC"), "refresh_token_encrypted": encrypt_secret(refresh), "last_checked_at": timezone.now()})
        except (requests.RequestException, KeyError, ValueError):
            return _popup("failed", origin)
        record_system_event("calendar.connected", request, actor=session.user_account, module_code="calendar")
        return _popup("connected", origin)


def _event_for_write(event_id):
    event = google_request("GET", event_path(event_id))
    if event.get("eventType", "default") != "default" or event.get("locked") or is_task_mirror(event):
        raise ValidationError("Este tipo de evento solo puede verse en Bold. Ábrelo en Google Calendar para editarlo.")
    return event


class CalendarEventsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            start = datetime.fromisoformat(request.query_params["start"].replace("Z", "+00:00"))
            end = datetime.fromisoformat(request.query_params["end"].replace("Z", "+00:00"))
            if not start.tzinfo or not end.tzinfo or not start < end <= start + timedelta(days=93):
                raise ValueError()
        except (KeyError, ValueError):
            raise ValidationError("Selecciona un rango válido de hasta 93 días.")
        items, page = [], None
        for _ in range(30):
            params = {"timeMin": start.isoformat(), "timeMax": end.isoformat(), "singleEvents": "true", "maxResults": 250, "orderBy": "startTime"}
            if page:
                params["pageToken"] = page
            result = google_request("GET", event_path(), params=params)
            drafts = set(CalendarDraft.objects.values_list("event_id", flat=True))
            items.extend(public_event(event) for event in result.get("items", []) if event.get("status") != "cancelled" and event.get("id") not in drafts and not is_task_mirror(event))
            page = result.get("nextPageToken")
            if not page:
                return Response({"events": items})
        raise CalendarUnavailable("Hay demasiados eventos en este rango. Prueba una vista más corta.")

    def post(self, request):
        data = validate_event(request.data)
        if data.pop("addMeet", False):
            data["conferenceData"] = {"createRequest": {"requestId": secrets.token_urlsafe(18), "conferenceSolutionKey": {"type": "hangoutsMeet"}}}
        if not all(data.get(key) for key in ("summary", "start", "end")):
            raise ValidationError("Título, inicio y fin son obligatorios.")
        event = google_request("POST", event_path(), params={"sendUpdates": "all", "conferenceDataVersion": 1}, body=data)
        record_system_event("calendar.event_created", request, module_code="calendar", target_type="google_event", metadata={"google_event_id": event["id"]})
        return Response(public_event(event), status=201)


class CalendarEventView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, event_id):
        return Response(public_event(google_request("GET", event_path(event_id))))

    def patch(self, request, event_id):
        current = _event_for_write(event_id)
        scope = request.query_params.get("scope", "instance")
        if scope not in ("instance", "series"):
            raise ValidationError("Alcance de recurrencia inválido.")
        target = current.get("recurringEventId") if scope == "series" else event_id
        if not target:
            target = event_id
        data = validate_event(request.data)
        if data.pop("removeMeet", False):
            data["conferenceData"] = None
        if data.pop("addMeet", False):
            data["conferenceData"] = {"createRequest": {"requestId": secrets.token_urlsafe(18), "conferenceSolutionKey": {"type": "hangoutsMeet"}}}
        if not data:
            raise ValidationError("No hay cambios en el evento.")
        event = google_request("PATCH", event_path(target), params={"sendUpdates": "all", "conferenceDataVersion": 1}, body=data)
        record_system_event("calendar.event_updated", request, module_code="calendar", target_type="google_event", metadata={"google_event_id": target, "scope": scope})
        return Response(public_event(event))

    def delete(self, request, event_id):
        current = _event_for_write(event_id)
        scope = request.query_params.get("scope", "instance")
        if scope not in ("instance", "series"):
            raise ValidationError("Alcance de recurrencia inválido.")
        target = current.get("recurringEventId") if scope == "series" else event_id
        if not target:
            target = event_id
        google_request("DELETE", event_path(target), params={"sendUpdates": "all"})
        record_system_event("calendar.event_deleted", request, module_code="calendar", target_type="google_event", metadata={"google_event_id": target, "scope": scope})
        return Response(status=204)


class CalendarDraftsView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        data = validate_event(request.data)
        if set(data) != {"start", "end"}:
            raise ValidationError("Selecciona el inicio y fin del evento antes de añadir Meet.")
        connection = GoogleCalendarConnection.objects.first()
        if not connection:
            raise CalendarUnavailable("Conecta Google Calendar primero.")
        data.update(summary="Sin título", conferenceData={"createRequest": {
            "requestId": secrets.token_urlsafe(18), "conferenceSolutionKey": {"type": "hangoutsMeet"}}})
        event = google_request("POST", event_path(), params={"sendUpdates": "none", "conferenceDataVersion": 1}, body=data)
        try:
            draft = CalendarDraft.objects.create(event_id=event["id"], owner=request.user, calendar_email=connection.email)
        except Exception:
            google_request("DELETE", event_path(event["id"]), params={"sendUpdates": "none"})
            raise
        record_system_event("calendar.draft_created", request, module_code="calendar", target_type="google_event", metadata={"google_event_id": event["id"]})
        return Response({"draft_id": draft.id, "event": public_event(event)}, status=201)


class CalendarDraftView(APIView):
    permission_classes = [IsAuthenticated]

    def _draft(self, request, draft_id):
        draft = CalendarDraft.objects.filter(pk=draft_id, owner=request.user).first()
        if not draft:
            raise ValidationError("El borrador ya no está disponible.")
        return draft

    def get(self, request, draft_id):
        draft = self._draft(request, draft_id)
        draft.last_seen_at = timezone.now()
        draft.save(update_fields=["last_seen_at"])
        return Response(public_event(google_request("GET", event_path(draft.event_id))))

    def patch(self, request, draft_id):
        action = request.data.get("action")
        if action not in ("heartbeat", "remove_meet", "add_meet", "commit"):
            raise ValidationError("Acción inválida.")
        with transaction.atomic():
            draft = CalendarDraft.objects.select_for_update().filter(pk=draft_id, owner=request.user).first()
            if not draft:
                raise ValidationError("El borrador ya no está disponible.")
            if action == "heartbeat":
                draft.last_seen_at = timezone.now()
                draft.save(update_fields=["last_seen_at"])
                return Response({"active": True})
            if action == "remove_meet":
                event = google_request("PATCH", event_path(draft.event_id), params={"sendUpdates": "none", "conferenceDataVersion": 1}, body={"conferenceData": None})
                draft.last_seen_at = timezone.now()
                draft.save(update_fields=["last_seen_at"])
                return Response(public_event(event))
            if action == "add_meet":
                event = google_request("PATCH", event_path(draft.event_id), params={"sendUpdates": "none", "conferenceDataVersion": 1}, body={"conferenceData": {"createRequest": {
                    "requestId": secrets.token_urlsafe(18), "conferenceSolutionKey": {"type": "hangoutsMeet"}}}})
                draft.last_seen_at = timezone.now()
                draft.save(update_fields=["last_seen_at"])
                return Response(public_event(event))
            data = validate_event(request.data.get("event"))
            data.pop("addMeet", None)
            if not all(data.get(key) for key in ("summary", "start", "end")):
                raise ValidationError("Título, inicio y fin son obligatorios.")
            event = google_request("PATCH", event_path(draft.event_id), params={"sendUpdates": "all", "conferenceDataVersion": 1}, body=data)
            draft.delete()
        record_system_event("calendar.event_created", request, module_code="calendar", target_type="google_event", metadata={"google_event_id": event["id"]})
        return Response(public_event(event))

    def delete(self, request, draft_id):
        with transaction.atomic():
            draft = CalendarDraft.objects.select_for_update().filter(pk=draft_id, owner=request.user).first()
            if not draft:
                return Response(status=204)
            google_request("DELETE", event_path(draft.event_id), params={"sendUpdates": "none"})
            draft.delete()
        record_system_event("calendar.draft_cancelled", request, module_code="calendar", target_type="google_event")
        return Response(status=204)


TASKS_API = "https://tasks.googleapis.com"
PEOPLE_API = "https://people.googleapis.com"


class CalendarContactSearchView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "calendar_contacts"

    def get(self, request):
        query = request.query_params.get("q", "").strip()
        if len(query) > 100:
            raise ValidationError("La búsqueda es demasiado larga.")
        paths = ("/v1/people:searchContacts", "/v1/otherContacts:search")
        contacts = {}
        for path in paths:
            result = google_request("GET", path, params={"query": query, "readMask": "names,emailAddresses", "pageSize": 20}, base=PEOPLE_API)
            for row in result.get("results", []) if query else []:
                person = row.get("person") or {}
                name = next((item.get("displayName", "") for item in person.get("names", []) if item.get("displayName")), "")
                for item in person.get("emailAddresses", []):
                    email = item.get("value", "").strip()
                    if email:
                        contacts[email.lower()] = {"email": email, "name": name}
        return Response({"contacts": list(contacts.values())[:20]})


def _task_path(list_id, task_id=""):
    return f"/tasks/v1/lists/{quote(list_id, safe='')}/tasks" + (f"/{quote(task_id, safe='')}" if task_id else "")


def _task_data(data):
    if not isinstance(data, dict) or set(data) - {"title", "notes", "due", "list_id", "status"}:
        raise ValidationError("La tarea contiene campos no permitidos.")
    result = {}
    if "title" in data:
        if not isinstance(data["title"], str) or not data["title"].strip() or len(data["title"]) > 1024:
            raise ValidationError("Escribe un título válido.")
        result["title"] = data["title"].strip()
    if "notes" in data:
        if not isinstance(data["notes"], str) or len(data["notes"]) > 8192:
            raise ValidationError("Las notas son demasiado largas.")
        result["notes"] = data["notes"]
    if "due" in data:
        try:
            result["due"] = f"{date.fromisoformat(data['due']).isoformat()}T00:00:00.000Z"
        except (TypeError, ValueError):
            raise ValidationError("Selecciona una fecha válida.")
    if "status" in data:
        if data["status"] not in ("needsAction", "completed"):
            raise ValidationError("Estado de tarea inválido.")
        result["status"] = data["status"]
    return result


class CalendarTaskListsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        lists, page = [], None
        for _ in range(10):
            params = {"maxResults": 1000}
            if page:
                params["pageToken"] = page
            result = google_request("GET", "/tasks/v1/users/@me/lists", params=params, base=TASKS_API)
            lists.extend({"id": item["id"], "title": item.get("title", "Tareas")} for item in result.get("items", []))
            page = result.get("nextPageToken")
            if not page:
                return Response({"lists": lists})
        raise CalendarUnavailable("Hay demasiadas listas de Google Tasks.")


class CalendarTasksView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            start, end = date.fromisoformat(request.query_params["start"]), date.fromisoformat(request.query_params["end"])
            if not start <= end <= start + timedelta(days=93):
                raise ValueError()
        except (KeyError, ValueError):
            raise ValidationError("Selecciona un rango de hasta 93 días.")
        tasklists = CalendarTaskListsView().get(request).data["lists"]
        tasks = []
        for tasklist in tasklists:
            page = None
            for _ in range(30):
                params = {"dueMin": f"{start}T00:00:00Z", "dueMax": f"{end + timedelta(days=1)}T00:00:00Z", "showCompleted": "false", "maxResults": 100}
                if page:
                    params["pageToken"] = page
                result = google_request("GET", _task_path(tasklist["id"]), params=params, base=TASKS_API)
                tasks.extend({"id": item["id"], "list_id": tasklist["id"], "list_title": tasklist["title"], "title": item.get("title", "Sin título"), "notes": item.get("notes", ""), "due": item["due"][:10], "status": item.get("status", "needsAction"), "webViewLink": item.get("webViewLink", "")} for item in result.get("items", []) if item.get("due") and not item.get("deleted") and start.isoformat() <= item["due"][:10] <= end.isoformat())
                page = result.get("nextPageToken")
                if not page:
                    break
            else:
                raise CalendarUnavailable("Hay demasiadas tareas en este rango.")
        return Response({"tasks": tasks, "lists": tasklists})

    def post(self, request):
        list_id = request.data.get("list_id")
        if not isinstance(list_id, str) or not list_id or len(list_id) > 255:
            raise ValidationError("Selecciona una lista de tareas.")
        data = _task_data(request.data)
        if not data.get("title") or not data.get("due"):
            raise ValidationError("Título y fecha son obligatorios.")
        task = google_request("POST", _task_path(list_id), body=data, base=TASKS_API)
        record_system_event("calendar.task_created", request, module_code="calendar", target_type="google_task", metadata={"google_task_id": task["id"]})
        return Response({"id": task["id"]}, status=201)


class CalendarTaskView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, list_id, task_id):
        data = _task_data(request.data)
        if not data:
            raise ValidationError("No hay cambios en la tarea.")
        task = google_request("PATCH", _task_path(list_id, task_id), body=data, base=TASKS_API)
        record_system_event("calendar.task_updated", request, module_code="calendar", target_type="google_task", metadata={"google_task_id": task_id})
        return Response({"id": task["id"]})

    def delete(self, request, list_id, task_id):
        google_request("DELETE", _task_path(list_id, task_id), base=TASKS_API)
        record_system_event("calendar.task_deleted", request, module_code="calendar", target_type="google_task", metadata={"google_task_id": task_id})
        return Response(status=204)
