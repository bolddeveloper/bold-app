from datetime import timedelta
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

from django.core.management import call_command
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient, APIRequestFactory

from boldApp.administrativo.models import SystemAuditEvent
from boldApp.autenticacion.services import create_session, encrypt_secret
from boldApp.core.models import UserAccount
from boldApp.calendario.models import CalendarDraft, GoogleCalendarConnection
from boldApp.calendario.service import validate_event
from boldApp.calendario.tasks import cleanup_calendar_drafts


class GoogleResponse:
    def __init__(self, data=None, status=200):
        self.data = data or {}
        self.status_code = status
        self.content = b"{}" if status != 204 else b""

    def json(self):
        return self.data

    def raise_for_status(self):
        if self.status_code >= 400:
            raise __import__("requests").HTTPError()


@override_settings(DEBUG=True, SECURE_SSL_REDIRECT=False, AUTH_ENCRYPTION_KEY="", GOOGLE_CALENDAR_CLIENT_ID="client", GOOGLE_CALENDAR_CLIENT_SECRET="secret", GOOGLE_CALENDAR_REDIRECT_URI="http://testserver/api/v2/calendar/oauth/callback/", FRONTEND_URL="http://localhost:5174")
class CalendarTests(TestCase):
    def setUp(self):
        call_command("seed_demo_data", verbosity=0)
        self.owner = UserAccount.objects.get(email="ana@bold.gt")
        self.owner.is_superuser = True
        self.owner.save(update_fields=["is_superuser", "updated_at"])
        self.member = UserAccount.objects.get(email="samuel@bold.gt")
        _, session = create_session(self.owner, APIRequestFactory().get("/"))
        self.owner_client = APIClient()
        self.owner_client.force_authenticate(self.owner, session)
        self.member_client = APIClient()
        self.member_client.force_authenticate(self.member)

    def test_connection_is_owner_only_and_state_is_bound_to_session(self):
        self.assertEqual(self.member_client.post("/api/v2/calendar/oauth/start/", {}, format="json").status_code, 403)
        start = self.owner_client.post("/api/v2/calendar/oauth/start/", {}, format="json")
        self.assertEqual(start.status_code, 200)
        self.assertIn("https://www.googleapis.com/auth/tasks", parse_qs(urlparse(start.data["authorization_url"]).query)["scope"][0])
        self.assertIn("https://www.googleapis.com/auth/contacts.readonly", parse_qs(urlparse(start.data["authorization_url"]).query)["scope"][0])
        state = parse_qs(urlparse(start.data["authorization_url"]).query)["state"][0]
        self.assertEqual(self.owner_client.get("/api/v2/calendar/oauth/callback/?state=bad&code=one").status_code, 200)
        self.assertFalse(GoogleCalendarConnection.objects.exists())
        with patch("boldApp.calendario.views.requests.post", return_value=GoogleResponse({"access_token": "access", "refresh_token": "refresh"})), patch("boldApp.calendario.views.requests.get", side_effect=[GoogleResponse({"email": "owner@gmail.com"}), GoogleResponse({"timeZone": "America/Tegucigalpa"})]):
            response = APIClient().get("/api/v2/calendar/oauth/callback/", {"state": state, "code": "one"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(GoogleCalendarConnection.objects.get().time_zone, "America/Tegucigalpa")
        self.assertNotIn("refresh", self.member_client.get("/api/v2/calendar/connection/").content.decode())
        self.assertEqual(self.member_client.delete("/api/v2/calendar/connection/").status_code, 403)
        self.assertFalse(GoogleCalendarConnection.objects.filter(email="").exists())
        with override_settings(GOOGLE_CALENDAR_CLIENT_ID=""):
            self.assertEqual(self.owner_client.post("/api/v2/calendar/oauth/start/", {}, format="json").status_code, 400)
            self.assertFalse(self.owner_client.get("/api/v2/calendar/connection/").data["configured"])
        self.assertIn("cancelled", self.owner_client.get("/api/v2/calendar/oauth/callback/", {"state": state, "error": "access_denied"}).content.decode())
        with patch("boldApp.calendario.views.requests.post", return_value=GoogleResponse({"error": "invalid_client"}, 401)):
            response = APIClient().get("/api/v2/calendar/oauth/callback/", {"state": state, "code": "two"})
        self.assertIn("invalid_client", response.content.decode())

    def test_disconnect_when_google_already_deleted_a_draft(self):
        GoogleCalendarConnection.objects.create(email="owner@gmail.com", refresh_token_encrypted=encrypt_secret("refresh"))
        CalendarDraft.objects.create(event_id="deleted-event", owner=self.owner, calendar_email="owner@gmail.com")
        with patch("boldApp.calendario.service.requests.post", side_effect=[GoogleResponse({"access_token": "access"}), GoogleResponse({})]), patch("boldApp.calendario.service.requests.request", return_value=GoogleResponse({"error": {"message": "Resource has been deleted"}}, 410)):
            response = self.owner_client.delete("/api/v2/calendar/connection/")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(GoogleCalendarConnection.objects.exists())
        self.assertFalse(CalendarDraft.objects.exists())

    def test_members_can_manage_events_and_lists_are_paginated(self):
        GoogleCalendarConnection.objects.create(email="owner@gmail.com", refresh_token_encrypted=encrypt_secret("refresh"))
        with patch("boldApp.calendario.service.requests.post", return_value=GoogleResponse({"access_token": "access"})), patch("boldApp.calendario.service.requests.request", side_effect=[GoogleResponse({"items": [{"id": "a", "summary": "Primero"}], "nextPageToken": "page2"}), GoogleResponse({"items": [{"id": "b", "summary": "Segundo"}]})]) as google:
            response = self.member_client.get("/api/v2/calendar/events/", {"start": "2026-09-01T00:00:00Z", "end": "2026-10-01T00:00:00Z"})
        self.assertEqual([event["id"] for event in response.data["events"]], ["a", "b"])
        self.assertEqual(google.call_args_list[1].kwargs["params"]["pageToken"], "page2")
        with patch("boldApp.calendario.service.requests.post", return_value=GoogleResponse({"access_token": "access"})), patch("boldApp.calendario.service.requests.request", return_value=GoogleResponse({"id": "new", "summary": "Reunión"})):
            response = self.member_client.post("/api/v2/calendar/events/", {"summary": "Reunión", "start": {"date": "2026-09-29"}, "end": {"date": "2026-09-30"}}, format="json")
        self.assertEqual(response.status_code, 201)
        self.assertTrue(SystemAuditEvent.objects.filter(event_type="calendar.event_created", actor_account=self.member).exists())
        self.assertEqual(self.member_client.get("/api/v2/calendar/events/", {"start": "bad", "end": "bad"}).status_code, 400)

    def test_google_task_mirror_is_not_shown_or_edited_as_calendar_event(self):
        GoogleCalendarConnection.objects.create(email="owner@gmail.com", refresh_token_encrypted=encrypt_secret("refresh"))
        mirror = {"id": "mirror", "summary": "Tarea", "source": {"url": "https://tasks.google.com/tasks/abc"}}
        with patch("boldApp.calendario.views.google_request", return_value={"items": [mirror, {"id": "meeting", "summary": "Reunión"}]}):
            listed = self.member_client.get("/api/v2/calendar/events/", {"start": "2026-09-01T00:00:00Z", "end": "2026-10-01T00:00:00Z"})
        self.assertEqual([event["id"] for event in listed.data["events"]], ["meeting"])
        with patch("boldApp.calendario.views.google_request", return_value=mirror):
            self.assertEqual(self.member_client.patch("/api/v2/calendar/events/mirror/", {"summary": "Cambio"}, format="json").status_code, 400)

    def test_active_members_can_search_google_contacts(self):
        self.assertIn(APIClient().get("/api/v2/calendar/contacts/", {"q": "pablo"}).status_code, (401, 403))
        with patch("boldApp.calendario.views.google_request", side_effect=[
            {"results": [{"person": {"names": [{"displayName": "Pablo"}], "emailAddresses": [{"value": "pablo@gmail.com"}]}}]},
            {"results": [{"person": {"names": [{"displayName": "Pablo"}], "emailAddresses": [{"value": "pablo@gmail.com"}]}}]},
        ]) as google:
            response = self.member_client.get("/api/v2/calendar/contacts/", {"q": "pablo"})
        self.assertEqual(response.data["contacts"], [{"email": "pablo@gmail.com", "name": "Pablo"}])
        self.assertEqual(google.call_count, 2)
        self.assertEqual(google.call_args.kwargs["base"], "https://people.googleapis.com")

    def test_create_event_requests_google_meet(self):
        GoogleCalendarConnection.objects.create(email="owner@gmail.com", refresh_token_encrypted=encrypt_secret("refresh"))
        with patch("boldApp.calendario.service.requests.post", return_value=GoogleResponse({"access_token": "access"})), patch("boldApp.calendario.service.requests.request", return_value=GoogleResponse({"id": "new", "summary": "Reunión"})) as google:
            response = self.member_client.post("/api/v2/calendar/events/", {"summary": "Reunión", "start": {"dateTime": "2026-09-29T09:00:00", "timeZone": "America/Tegucigalpa"}, "end": {"dateTime": "2026-09-29T10:00:00", "timeZone": "America/Tegucigalpa"}, "addMeet": True}, format="json")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(google.call_args.kwargs["params"]["conferenceDataVersion"], 1)
        self.assertEqual(google.call_args.kwargs["json"]["conferenceData"]["createRequest"]["conferenceSolutionKey"]["type"], "hangoutsMeet")

    def test_meet_draft_commit_cancel_and_expiry(self):
        GoogleCalendarConnection.objects.create(email="owner@gmail.com", refresh_token_encrypted=encrypt_secret("refresh"))
        interval = {"start": {"dateTime": "2026-09-29T09:00:00", "timeZone": "America/Tegucigalpa"}, "end": {"dateTime": "2026-09-29T10:00:00", "timeZone": "America/Tegucigalpa"}}
        with patch("boldApp.calendario.views.google_request", return_value={"id": "preview", "hangoutLink": "https://meet.google.com/example"}) as google:
            created = self.member_client.post("/api/v2/calendar/drafts/", interval, format="json")
            self.assertEqual(created.status_code, 201)
            draft_id = created.data["draft_id"]
            self.assertEqual(self.owner_client.get(f"/api/v2/calendar/drafts/{draft_id}/").status_code, 400)
            self.assertEqual(google.call_args.kwargs["params"]["sendUpdates"], "none")
            self.assertEqual(self.member_client.get(f"/api/v2/calendar/drafts/{draft_id}/").data["hangoutLink"], "https://meet.google.com/example")
            self.assertEqual(self.member_client.patch(f"/api/v2/calendar/drafts/{draft_id}/", {"action": "heartbeat"}, format="json").status_code, 200)
            self.assertEqual(self.member_client.patch(f"/api/v2/calendar/drafts/{draft_id}/", {"action": "remove_meet"}, format="json").status_code, 200)
            self.assertIsNone(google.call_args.kwargs["body"]["conferenceData"])
            self.assertEqual(self.member_client.patch(f"/api/v2/calendar/drafts/{draft_id}/", {"action": "add_meet"}, format="json").status_code, 200)
            self.assertEqual(google.call_args.kwargs["body"]["conferenceData"]["createRequest"]["conferenceSolutionKey"]["type"], "hangoutsMeet")
            committed = self.member_client.patch(f"/api/v2/calendar/drafts/{draft_id}/", {"action": "commit", "event": {**interval, "summary": "Reunión"}}, format="json")
            self.assertEqual(committed.status_code, 200)
            self.assertFalse(CalendarDraft.objects.exists())
            self.assertEqual(self.member_client.delete(f"/api/v2/calendar/drafts/{draft_id}/").status_code, 204)
            self.assertEqual(self.member_client.post("/api/v2/calendar/drafts/", interval, format="json").status_code, 201)
            self.assertEqual(self.member_client.delete(f"/api/v2/calendar/drafts/{CalendarDraft.objects.get().id}/").status_code, 204)
            self.assertFalse(CalendarDraft.objects.exists())
        stale = CalendarDraft.objects.create(event_id="stale", owner=self.member, calendar_email="owner@gmail.com")
        CalendarDraft.objects.filter(pk=stale.pk).update(last_seen_at=timezone.now() - timedelta(minutes=5))
        with patch("boldApp.calendario.tasks.google_request") as google:
            cleanup_calendar_drafts()
            google.assert_called_once()
        self.assertFalse(CalendarDraft.objects.exists())
        active = CalendarDraft.objects.create(event_id="active", owner=self.member, calendar_email="owner@gmail.com")
        with patch("boldApp.calendario.tasks.google_request") as google:
            cleanup_calendar_drafts()
            google.assert_not_called()
        self.assertTrue(CalendarDraft.objects.filter(pk=active.pk).exists())
        CalendarDraft.objects.filter(pk=active.pk).update(last_seen_at=timezone.now() - timedelta(minutes=5))
        with patch("boldApp.calendario.tasks.google_request", side_effect=RuntimeError("Google no disponible")):
            cleanup_calendar_drafts()
        self.assertTrue(CalendarDraft.objects.filter(pk=active.pk).exists())

    def test_google_tasks_are_dated_and_managed_separately_from_events(self):
        GoogleCalendarConnection.objects.create(email="owner@gmail.com", refresh_token_encrypted=encrypt_secret("refresh"))
        with patch("boldApp.calendario.views.google_request", side_effect=[
            {"items": [{"id": "list-1", "title": "Mis tareas"}]},
            {"items": [{"id": "task-1", "title": "Revisar", "due": "2026-09-29T00:00:00.000Z"}, {"id": "task-2", "title": "Fuera", "due": "2026-10-01T00:00:00.000Z"}]},
        ]) as google:
            listed = self.member_client.get("/api/v2/calendar/tasks/", {"start": "2026-09-29", "end": "2026-09-30"})
        self.assertEqual(listed.status_code, 200)
        self.assertEqual([task["id"] for task in listed.data["tasks"]], ["task-1"])
        self.assertIn("tasks.googleapis.com", google.call_args.kwargs["base"])
        with patch("boldApp.calendario.views.google_request", return_value={"id": "task-3"}) as google:
            created = self.member_client.post("/api/v2/calendar/tasks/", {"list_id": "list-1", "title": "Preparar", "due": "2026-09-29"}, format="json")
            self.assertEqual(created.status_code, 201)
            self.assertEqual(google.call_args.kwargs["body"]["due"], "2026-09-29T00:00:00.000Z")
            self.assertEqual(self.member_client.patch("/api/v2/calendar/tasks/list-1/task-3/", {"status": "completed"}, format="json").status_code, 200)
            google.return_value = None
            self.assertEqual(self.member_client.delete("/api/v2/calendar/tasks/list-1/task-3/").status_code, 204)
        self.assertEqual(self.member_client.post("/api/v2/calendar/tasks/", {"list_id": "list-1", "title": "Mal", "due": "2026-02-30"}, format="json").status_code, 400)

    def test_member_updates_and_deletes_one_recurring_instance(self):
        GoogleCalendarConnection.objects.create(email="owner@gmail.com", refresh_token_encrypted=encrypt_secret("refresh"))
        instance = {"id": "occurrence", "eventType": "default", "recurringEventId": "series", "summary": "Reunión"}
        with patch("boldApp.calendario.service.requests.post", return_value=GoogleResponse({"access_token": "access"})), patch("boldApp.calendario.service.requests.request", side_effect=[GoogleResponse(instance), GoogleResponse({**instance, "summary": "Nueva reunión"}), GoogleResponse(instance), GoogleResponse(status=204)]) as google:
            updated = self.member_client.patch("/api/v2/calendar/events/occurrence/?scope=instance", {"summary": "Nueva reunión"}, format="json")
            deleted = self.member_client.delete("/api/v2/calendar/events/occurrence/?scope=series")
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(deleted.status_code, 204)
        self.assertIn("/events/series", google.call_args_list[-1].args[1])
        self.assertTrue(SystemAuditEvent.objects.filter(event_type="calendar.event_deleted", actor_account=self.member).exists())

    def test_event_validation_rejects_invalid_dates_and_fields(self):
        for event in ({"start": {"date": "2026-02-30"}, "end": {"date": "2026-03-01"}}, {"unknown": "secret"}, {"attendees": [{"email": "bad"}]}):
            with self.assertRaises(Exception):
                validate_event(event)

    def test_unauthenticated_and_special_events_are_not_mutable(self):
        self.assertIn(APIClient().get("/api/v2/calendar/connection/").status_code, (401, 403))
        GoogleCalendarConnection.objects.create(email="owner@gmail.com", refresh_token_encrypted=encrypt_secret("refresh"))
        with patch("boldApp.calendario.service.requests.post", return_value=GoogleResponse({"access_token": "access"})), patch("boldApp.calendario.service.requests.request", return_value=GoogleResponse({"id": "birthday", "eventType": "birthday"})):
            response = self.member_client.patch("/api/v2/calendar/events/birthday/", {"summary": "Cambio"}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_expired_google_permission_requires_reconnection(self):
        GoogleCalendarConnection.objects.create(email="owner@gmail.com", refresh_token_encrypted=encrypt_secret("refresh"))
        with patch("boldApp.calendario.service.requests.post", return_value=GoogleResponse({"error": "invalid_grant"}, 400)):
            response = self.member_client.get("/api/v2/calendar/events/", {"start": "2026-09-01T00:00:00Z", "end": "2026-10-01T00:00:00Z"})
        self.assertEqual(response.status_code, 409)
        self.assertIn("venció", str(response.data["detail"]))
