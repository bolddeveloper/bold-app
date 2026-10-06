import secrets
from datetime import date, datetime, timedelta
from urllib.parse import quote
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import APIException, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from boldApp.administrativo.services import record_system_event
from boldApp.workspace.models import GoogleConnection
from .models import CalendarDraft
from .service import CalendarReconnect, CalendarUnavailable, event_path, google_request, is_task_mirror, public_event, validate_event


def current_subject(user):
    return GoogleConnection.objects.filter(user=user).values_list("subject", flat=True).first() or ""


class CalendarConnectionView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from boldApp.workspace.google_config import public_connection
        result = public_connection(request.user)
        result["connected"] = result["services"]["calendar"]["status"] == "available"
        return Response(result)

    def delete(self, request):
        from boldApp.workspace.oauth import ConnectionView
        return ConnectionView().delete(request)


class CalendarOAuthStartView(APIView):
    def post(self, request):
        from boldApp.workspace.oauth import StartView
        request._full_data = {"service": "calendar"}
        return StartView().post(request)


class CalendarOAuthCallbackView(APIView):
    authentication_classes = []
    permission_classes = []

    def get(self, request):
        from boldApp.workspace.oauth import CallbackView
        return CallbackView().get(request)


def _event_for_write(user, event_id):
    event = google_request(user, "GET", event_path(event_id))
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
            result = google_request(request.user, "GET", event_path(), params=params)
            drafts = set(CalendarDraft.objects.filter(owner=request.user, connection__user=request.user).values_list("event_id", flat=True))
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
        event = google_request(request.user, "POST", event_path(), params={"sendUpdates": "all", "conferenceDataVersion": 1}, body=data)
        record_system_event("calendar.event_created", request, module_code="calendar", target_type="google_event", metadata={"google_event_id": event["id"]})
        return Response(public_event(event), status=201)


class CalendarEventView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, event_id):
        return Response(public_event(google_request(request.user, "GET", event_path(event_id))))

    def patch(self, request, event_id):
        current = _event_for_write(request.user, event_id)
        scope = request.query_params.get("scope", "instance")
        if scope not in ("instance", "series"):
            raise ValidationError("Alcance de recurrencia inválido.")
        target = current.get("recurringEventId") if scope == "series" else event_id
        if not target:
            target = event_id
        data = validate_event(request.data)
        if current.get("recurringEventId") and scope == "instance" and "recurrence" in data:
            raise ValidationError("Cambiar la repetición requiere aplicar los cambios a toda la serie.")
        if data.pop("removeMeet", False):
            data["conferenceData"] = None
        if data.pop("addMeet", False):
            data["conferenceData"] = {"createRequest": {"requestId": secrets.token_urlsafe(18), "conferenceSolutionKey": {"type": "hangoutsMeet"}}}
        if not data:
            raise ValidationError("No hay cambios en el evento.")
        event = google_request(request.user, "PATCH", event_path(target), params={"sendUpdates": "all", "conferenceDataVersion": 1}, body=data)
        record_system_event("calendar.event_updated", request, module_code="calendar", target_type="google_event", metadata={"google_event_id": target, "scope": scope})
        return Response(public_event(event))

    def delete(self, request, event_id):
        current = _event_for_write(request.user, event_id)
        scope = request.query_params.get("scope", "instance")
        if scope not in ("instance", "series"):
            raise ValidationError("Alcance de recurrencia inválido.")
        target = current.get("recurringEventId") if scope == "series" else event_id
        if not target:
            target = event_id
        google_request(request.user, "DELETE", event_path(target), params={"sendUpdates": "all"})
        record_system_event("calendar.event_deleted", request, module_code="calendar", target_type="google_event", metadata={"google_event_id": target, "scope": scope})
        return Response(status=204)


class CalendarDraftsView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        data = validate_event(request.data)
        if set(data) != {"start", "end"}:
            raise ValidationError("Selecciona el inicio y fin del evento antes de añadir Meet.")
        connection = GoogleConnection.objects.filter(user=request.user).first()
        if not connection:
            raise CalendarUnavailable("Conecta Google Calendar primero.")
        data.update(summary="Sin título", conferenceData={"createRequest": {
            "requestId": secrets.token_urlsafe(18), "conferenceSolutionKey": {"type": "hangoutsMeet"}}})
        event = google_request(request.user, "POST", event_path(), params={"sendUpdates": "none", "conferenceDataVersion": 1}, body=data)
        try:
            draft = CalendarDraft.objects.create(event_id=event["id"], owner=request.user, connection=connection, google_subject=connection.subject, calendar_email=connection.email)
        except Exception:
            google_request(request.user, "DELETE", event_path(event["id"]), params={"sendUpdates": "none"})
            raise
        record_system_event("calendar.draft_created", request, module_code="calendar", target_type="google_event", metadata={"google_event_id": event["id"]})
        return Response({"draft_id": draft.id, "event": public_event(event)}, status=201)


class CalendarDraftView(APIView):
    permission_classes = [IsAuthenticated]

    def _draft(self, request, draft_id):
        draft = CalendarDraft.objects.filter(pk=draft_id, owner=request.user, connection__user=request.user, google_subject=current_subject(request.user)).first()
        if not draft:
            raise ValidationError("El borrador ya no está disponible.")
        return draft

    def get(self, request, draft_id):
        draft = self._draft(request, draft_id)
        draft.last_seen_at = timezone.now()
        draft.save(update_fields=["last_seen_at"])
        return Response(public_event(google_request(request.user, "GET", event_path(draft.event_id))))

    def patch(self, request, draft_id):
        action = request.data.get("action")
        if action not in ("heartbeat", "remove_meet", "add_meet", "commit"):
            raise ValidationError("Acción inválida.")
        with transaction.atomic():
            draft = CalendarDraft.objects.select_for_update().filter(pk=draft_id, owner=request.user, connection__user=request.user, google_subject=current_subject(request.user)).first()
            if not draft:
                raise ValidationError("El borrador ya no está disponible.")
            if action == "heartbeat":
                draft.last_seen_at = timezone.now()
                draft.save(update_fields=["last_seen_at"])
                return Response({"active": True})
            if action == "remove_meet":
                event = google_request(request.user, "PATCH", event_path(draft.event_id), params={"sendUpdates": "none", "conferenceDataVersion": 1}, body={"conferenceData": None})
                draft.last_seen_at = timezone.now()
                draft.save(update_fields=["last_seen_at"])
                return Response(public_event(event))
            if action == "add_meet":
                event = google_request(request.user, "PATCH", event_path(draft.event_id), params={"sendUpdates": "none", "conferenceDataVersion": 1}, body={"conferenceData": {"createRequest": {
                    "requestId": secrets.token_urlsafe(18), "conferenceSolutionKey": {"type": "hangoutsMeet"}}}})
                draft.last_seen_at = timezone.now()
                draft.save(update_fields=["last_seen_at"])
                return Response(public_event(event))
            data = validate_event(request.data.get("event"))
            data.pop("addMeet", None)
            if not all(data.get(key) for key in ("summary", "start", "end")):
                raise ValidationError("Título, inicio y fin son obligatorios.")
            event = google_request(request.user, "PATCH", event_path(draft.event_id), params={"sendUpdates": "all", "conferenceDataVersion": 1}, body=data)
            draft.delete()
        record_system_event("calendar.event_created", request, module_code="calendar", target_type="google_event", metadata={"google_event_id": event["id"]})
        return Response(public_event(event))

    def delete(self, request, draft_id):
        with transaction.atomic():
            draft = CalendarDraft.objects.select_for_update().filter(pk=draft_id, owner=request.user, connection__user=request.user, google_subject=current_subject(request.user)).first()
            if not draft:
                return Response(status=204)
            google_request(request.user, "DELETE", event_path(draft.event_id), params={"sendUpdates": "none"})
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
        calls = [("/v1/people:searchContacts", {"query": query, "readMask": "names,emailAddresses", "pageSize": 20}, "results"),
                 ("/v1/otherContacts:search", {"query": query, "readMask": "names,emailAddresses", "pageSize": 20}, "results")]
        # Search's empty warmup returns no people: preload a bounded pool for immediate suggestions.
        if not query:
            calls += [("/v1/people/me/connections", {"personFields": "names,emailAddresses", "pageSize": 200, "sortOrder": "LAST_MODIFIED_DESCENDING"}, "connections"),
                      ("/v1/otherContacts", {"readMask": "names,emailAddresses", "pageSize": 200}, "otherContacts")]
        contacts, failures, completed = {}, [], 0
        for path, params, field in calls:
            try:
                result = google_request(request.user, "GET", path, params=params, base=PEOPLE_API)
            except CalendarReconnect:
                raise
            except APIException as error:
                failures.append(error)
                continue
            completed += 1
            for row in result.get(field, []):
                person = row.get("person", {}) if field == "results" else row
                name = next((item.get("displayName", "") for item in person.get("names", []) if item.get("displayName")), "")
                for item in person.get("emailAddresses", []):
                    email = item.get("value", "").strip()
                    if email:
                        contacts[email.lower()] = {"email": email, "name": name}
        if not completed and failures:
            raise failures[0]
        return Response({"contacts": list(contacts.values())[:400 if not query else 40],
                         "warning": "Una fuente de contactos de Google no respondió. Mostrando los disponibles." if failures else ""})



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
            result = google_request(request.user, "GET", "/tasks/v1/users/@me/lists", params=params, base=TASKS_API)
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
                result = google_request(request.user, "GET", _task_path(tasklist["id"]), params=params, base=TASKS_API)
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
        task = google_request(request.user, "POST", _task_path(list_id), body=data, base=TASKS_API)
        record_system_event("calendar.task_created", request, module_code="calendar", target_type="google_task", metadata={"google_task_id": task["id"]})
        return Response({"id": task["id"]}, status=201)


class CalendarTaskView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, list_id, task_id):
        data = _task_data(request.data)
        if not data:
            raise ValidationError("No hay cambios en la tarea.")
        task = google_request(request.user, "PATCH", _task_path(list_id, task_id), body=data, base=TASKS_API)
        record_system_event("calendar.task_updated", request, module_code="calendar", target_type="google_task", metadata={"google_task_id": task_id})
        return Response({"id": task["id"]})

    def delete(self, request, list_id, task_id):
        google_request(request.user, "DELETE", _task_path(list_id, task_id), base=TASKS_API)
        record_system_event("calendar.task_deleted", request, module_code="calendar", target_type="google_task", metadata={"google_task_id": task_id})
        return Response(status=204)
