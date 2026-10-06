from datetime import timedelta
from unittest.mock import patch
from django.core.cache import caches
from django.test import TestCase, RequestFactory
from django.utils import timezone
from rest_framework.test import APIClient
from boldApp.core.models import Employee, UserAccount, OrganizationalUnit, JobRole, Position, PositionAssignment
from boldApp.autenticacion.services import create_session
from boldApp.autenticacion.presence import heartbeat_snapshot, presence_directory, effective_status, session_key, HEARTBEAT_TTL
from boldApp.calendario.presence import meeting_window, store_windows, refresh_meetings
from boldApp.workspace.models import GoogleConnection
from boldApp.calendario.service import CalendarUnavailable


class PresenceTests(TestCase):
    def setUp(self):
        caches["presence"].clear()
        self.unit = OrganizationalUnit.objects.create(name="IT", unit_type="department", sensitivity_level="normal")
        role = JobRole.objects.create(title="Colaborador")
        self.account = UserAccount.objects.create_user(email="presence@bold.gt", employee=Employee.objects.create(full_name="Persona de prueba"))
        self.other = UserAccount.objects.create_user(email="other@bold.gt", employee=Employee.objects.create(full_name="Otra persona"))
        self.assignment = PositionAssignment.objects.create(employee=self.account.employee, position=Position.objects.create(unit=self.unit, job_role=role))
        _, self.session = create_session(self.account, RequestFactory().get("/"))
        self.client = APIClient()
        self.client.force_authenticate(self.account, self.session)
        self.client.credentials(HTTP_X_ASSIGNMENT_ID=str(self.assignment.pk))

    def tearDown(self):
        caches["presence"].clear()

    def test_session_alone_does_not_mean_connected_and_snapshot_contains_no_private_data(self):
        self.assertEqual(presence_directory()["rows"], [])
        roster = heartbeat_snapshot(self.session.pk)
        self.assertEqual(len(roster["rows"]), 1)
        person = roster["rows"][0]
        self.assertEqual(person["status"], "online")
        self.assertEqual(person["units"][0]["name"], "IT")
        self.assertEqual(set(person), {"employee_id", "name", "units", "status", "title", "description"})
        self.assertNotIn("@bold.gt", str(roster))

    def test_revoked_expired_idle_and_stale_connections_are_excluded(self):
        heartbeat_snapshot(self.session.pk)
        self.session.revoked_at = timezone.now()
        self.session.save(update_fields=["revoked_at"])
        self.assertFalse(presence_directory()["rows"])
        self.session.revoked_at = None
        self.session.expires_at = timezone.now() - timedelta(seconds=1)
        self.session.save(update_fields=["revoked_at", "expires_at"])
        self.assertFalse(presence_directory()["rows"])
        self.session.expires_at = timezone.now() + timedelta(hours=1)
        self.session.idle_expires_at = timezone.now() - timedelta(seconds=1)
        self.session.save(update_fields=["expires_at", "idle_expires_at"])
        self.assertFalse(presence_directory()["rows"])
        self.session.idle_expires_at = None
        self.session.save(update_fields=["idle_expires_at"])
        caches["presence"].set(session_key(self.session.pk), timezone.now().timestamp() - HEARTBEAT_TTL - 1, 90)
        self.assertFalse(presence_directory()["rows"])

    def test_multiple_sessions_are_deduplicated_and_other_session_survives_revocation(self):
        _, second = create_session(self.account, RequestFactory().get("/"))
        heartbeat_snapshot(self.session.pk)
        heartbeat_snapshot(second.pk)
        self.assertEqual(len(presence_directory()["rows"]), 1)
        self.session.revoked_at = timezone.now()
        self.session.save(update_fields=["revoked_at"])
        self.assertEqual(len(presence_directory()["rows"]), 1)
        self.account.credentials_version += 1
        self.account.save(update_fields=["credentials_version"])
        self.assertEqual(presence_directory()["rows"], [])

    def test_self_only_settings_validation_and_invisible_mode(self):
        url = "/api/v2/auth/presence/"
        for data in [{"status": "unknown"}, {"status": "custom", "title": " "}, {"user": str(self.other.pk)}, {"description": "a" * 161}]:
            self.assertEqual(self.client.patch(url, data, format="json").status_code, 400)
        with self.captureOnCommitCallbacks(execute=True), patch("boldApp.autenticacion.presence.announce_presence") as announce:
            response = self.client.patch(url, {"status": "custom", "title": "En una entrega", "description": "Escríbeme luego"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        announce.assert_called_once()
        self.other.refresh_from_db()
        self.assertEqual(self.other.presence_settings, {})
        heartbeat_snapshot(self.session.pk)
        self.assertEqual(presence_directory()["rows"][0]["title"], "En una entrega")
        self.assertEqual(self.client.patch(url, {"status": "offline"}, format="json").status_code, 200)
        self.assertFalse(presence_directory()["rows"])
        self.client.force_authenticate(None)
        self.assertIn(self.client.get(url).status_code, (401, 403))
        self.assertIn(self.client.get(url + "directory/").status_code, (401, 403))

    def calendar_connection(self):
        return GoogleConnection.objects.create(user=self.account, subject="google-person", email="private@example.com", scopes="calendar", refresh_token_encrypted="not-read")

    def test_failed_push_does_not_report_failed_save_after_commit(self):
        with patch("boldApp.autenticacion.presence.get_channel_layer", side_effect=ConnectionError("unavailable")), self.assertLogs("boldApp.autenticacion.presence", level="WARNING"), self.captureOnCommitCallbacks(execute=True):
            response = self.client.patch("/api/v2/auth/presence/", {"status": "away"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.account.refresh_from_db()
        self.assertEqual(self.account.presence_settings["status"], "away")

    def event(self, start, end, **overrides):
        return {"id": "private-id", "summary": "Contenido privado", "start": {"dateTime": start.isoformat()}, "end": {"dateTime": end.isoformat()}, "attendees": [{"self": True}, {"email": "private@example.com"}], **overrides}

    def test_meetings_are_private_time_windows_with_exact_boundaries_and_overrides(self):
        connection = self.calendar_connection()
        now = timezone.now()
        start, end = now - timedelta(minutes=1), now + timedelta(minutes=1)
        event = self.event(start, end)
        store_windows(self.account, [event], start, end)
        stored = caches["presence"].get(f"meetings:{self.account.pk}")
        self.assertNotIn("Contenido privado", str(stored))
        self.assertNotIn("@", str(stored))
        self.assertEqual(effective_status(self.account, connection, start), "meeting")
        self.assertEqual(effective_status(self.account, connection, end), "online")
        for status in ("offline", "vacation"):
            self.account.presence_settings = {"status": status}
            self.assertEqual(effective_status(self.account, connection, now), status)
        self.account.presence_settings = {"calendar_automatic": False}
        self.assertEqual(effective_status(self.account, connection, now), "online")
        self.assertEqual(effective_status(self.account, None, now), "online")
        connection.subject = "another-account"
        self.account.presence_settings = {}
        self.assertEqual(effective_status(self.account, connection, now), "online")

    def test_non_meetings_declined_cancelled_all_day_and_different_timezone(self):
        now = timezone.now()
        event = self.event(now, now + timedelta(hours=1))
        for overrides in ({"attendees": []}, {"status": "cancelled"}, {"transparency": "transparent"}, {"attendees": [{"self": True, "responseStatus": "declined"}, {"email": "other"}]}, {"start": {"date": "2026-10-06"}, "end": {"date": "2026-10-07"}}):
            self.assertIsNone(meeting_window({**event, **overrides}))
        self.assertIsNotNone(meeting_window({**event, "attendees": [], "hangoutLink": "https://meet.google.com/private"}))
        event["start"] = {"dateTime": "2026-10-06T14:00:00-06:00"}
        event["end"] = {"dateTime": "2026-10-06T15:00:00-06:00"}
        self.assertEqual(meeting_window(event)[1] - meeting_window(event)[0], 3600)

    def test_calendar_refresh_is_bounded_and_failure_clears_stale_meeting(self):
        self.calendar_connection()
        now = timezone.now()
        event = self.event(now - timedelta(minutes=1), now + timedelta(hours=1))
        with patch("boldApp.calendario.presence.google_request", return_value={"items": [event]}) as google:
            self.assertTrue(refresh_meetings(self.account))
            google.assert_called_once()
        self.assertEqual(effective_status(self.account, self.account.googleconnection), "meeting")
        with patch("boldApp.calendario.presence.google_request", side_effect=CalendarUnavailable()):
            self.assertFalse(refresh_meetings(self.account))
        self.assertEqual(effective_status(self.account, self.account.googleconnection), "online")
