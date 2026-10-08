from datetime import timedelta
from unittest.mock import patch
from django.core.cache import caches
from django.test import TestCase, RequestFactory
from django.utils import timezone
from rest_framework.test import APIClient
from boldApp.core.models import Employee, UserAccount, OrganizationalUnit, JobRole, Position, PositionAssignment
from boldApp.autenticacion.services import create_session
from boldApp.autenticacion.presence import heartbeat_snapshot, presence_directory, effective_status, session_key, HEARTBEAT_TTL, settings_for
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

    def test_timed_status_expires_on_server_at_exact_boundary_without_browser(self):
        now = timezone.now()
        with patch("boldApp.autenticacion.presence.timezone.now", return_value=now):
            response = self.client.patch("/api/v2/auth/presence/", {"status": "busy", "duration_minutes": 30}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["expires_at"], (now + timedelta(minutes=30)).isoformat())
        self.account.refresh_from_db()
        self.assertEqual(effective_status(self.account, now=now + timedelta(minutes=30, seconds=-1)), "busy")
        self.assertEqual(effective_status(self.account, now=now + timedelta(minutes=30)), "online")
        self.assertIsNone(settings_for(self.account, now + timedelta(hours=2))["expires_at"])
        with patch("boldApp.autenticacion.presence.timezone.now", return_value=now + timedelta(hours=2)):
            self.assertEqual(self.client.get("/api/v2/auth/presence/").data["status"], "online")

    def test_duration_validation_partial_update_and_clear(self):
        url = "/api/v2/auth/presence/"
        for data in [{"status": "busy", "duration_minutes": -1}, {"status": "busy", "duration_minutes": 17}, {"status": "online", "duration_minutes": 30}, {"expires_at": "2099-01-01T00:00:00Z"}]:
            self.assertEqual(self.client.patch(url, data, format="json").status_code, 400)
        first = self.client.patch(url, {"status": "away", "duration_minutes": 15}, format="json").data
        partial = self.client.patch(url, {"calendar_automatic": False}, format="json").data
        self.assertEqual(first["expires_at"], partial["expires_at"])
        always = self.client.patch(url, {"duration_minutes": 0}, format="json").data
        self.assertIsNone(always["expires_at"])
        online = self.client.patch(url, {"status": "online"}, format="json").data
        self.assertEqual(online["duration_minutes"], 0)
        self.assertIsNone(online["expires_at"])

    def test_expired_status_still_allows_automatic_meeting(self):
        connection = self.calendar_connection()
        now = timezone.now()
        self.account.presence_settings = {"status": "busy", "expires_at": now.isoformat(), "duration_minutes": 15}
        schedule = {"subject": connection.subject, "scopes": connection.scopes, "windows": [(now.timestamp(), (now + timedelta(hours=1)).timestamp())]}
        self.assertEqual(effective_status(self.account, connection, now, schedule), "meeting")

    def test_session_alone_does_not_mean_connected_and_snapshot_contains_no_private_data(self):
        self.account.avatar_url = "data:image/webp;base64,test-avatar"
        self.account.save(update_fields=["avatar_url"])
        self.assertEqual(presence_directory()["rows"][0]["status"], "offline")
        roster = heartbeat_snapshot(self.session.pk)
        self.assertEqual(len(roster["rows"]), 1)
        person = roster["rows"][0]
        self.assertEqual(person["status"], "online")
        self.assertEqual(person["units"][0]["name"], "IT")
        self.assertEqual(set(person), {"employee_id", "name", "avatar_url", "units", "status", "title", "description"})
        self.assertEqual(person["avatar_url"], self.account.avatar_url)
        from boldApp.core.serializers import AssignmentDirectorySerializer
        self.assertEqual(AssignmentDirectorySerializer(self.assignment).data["avatar_url"], self.account.avatar_url)
        self.assertNotIn("@bold.gt", str(roster))

    def test_revoked_expired_idle_and_stale_connections_show_offline(self):
        heartbeat_snapshot(self.session.pk)
        self.session.revoked_at = timezone.now()
        self.session.save(update_fields=["revoked_at"])
        self.assertEqual(presence_directory()["rows"][0]["status"], "offline")
        self.session.revoked_at = None
        self.session.expires_at = timezone.now() - timedelta(seconds=1)
        self.session.save(update_fields=["revoked_at", "expires_at"])
        self.assertEqual(presence_directory()["rows"][0]["status"], "offline")
        self.session.expires_at = timezone.now() + timedelta(hours=1)
        self.session.idle_expires_at = timezone.now() - timedelta(seconds=1)
        self.session.save(update_fields=["expires_at", "idle_expires_at"])
        self.assertEqual(presence_directory()["rows"][0]["status"], "offline")
        self.session.idle_expires_at = None
        self.session.save(update_fields=["idle_expires_at"])
        caches["presence"].set(session_key(self.session.pk), timezone.now().timestamp() - HEARTBEAT_TTL - 1, 90)
        self.assertEqual(presence_directory()["rows"][0]["status"], "offline")

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
        self.assertEqual(presence_directory()["rows"][0]["status"], "offline")

    def test_directory_keeps_disconnected_preferences_and_excludes_inactive_people(self):
        other_unit = OrganizationalUnit.objects.create(name="Ventas", unit_type="department", sensitivity_level="normal")
        empty_unit = OrganizationalUnit.objects.create(name="Sin asignaciones", unit_type="department", sensitivity_level="normal")
        placement = PositionAssignment.objects.create(employee=self.other.employee,
            position=Position.objects.create(unit=other_unit, job_role=self.assignment.position.job_role))
        self.other.presence_settings = {"status": "away"}
        self.other.save(update_fields=["presence_settings"])
        roster = presence_directory()
        self.assertEqual({row["employee_id"]: row["status"] for row in roster["rows"]}, {
            str(self.account.employee_id): "offline", str(self.other.employee_id): "away"})
        self.assertIn(str(empty_unit.pk), [unit["id"] for unit in roster["units"]])
        self.other.presence_settings = {"status": "busy"}
        self.other.save(update_fields=["presence_settings"])
        self.assertEqual(next(row for row in presence_directory()["rows"] if row["employee_id"] == str(self.other.employee_id))["status"], "busy")
        self.other.is_active = False
        self.other.save(update_fields=["is_active"])
        self.assertEqual(len(presence_directory()["rows"]), 1)
        self.other.is_active = True
        self.other.save(update_fields=["is_active"])
        placement.is_active = False
        placement.save(update_fields=["is_active"])
        self.assertEqual(len(presence_directory()["rows"]), 1)

    def test_self_only_settings_validation_and_automatic_states(self):
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
        for status in ("offline", "meeting"):
            self.assertEqual(self.client.patch(url, {"status": status}, format="json").status_code, 400)
        self.assertEqual(len(presence_directory()["rows"]), 1)
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
        for status in ("vacation",):
            self.account.presence_settings = {"status": status}
            self.assertEqual(effective_status(self.account, connection, now), status)
        self.account.presence_settings = {"calendar_automatic": False}
        self.assertEqual(effective_status(self.account, connection, now), "online")
        self.assertEqual(effective_status(self.account, None, now), "online")
        connection.subject = "another-account"
        self.account.presence_settings = {}
        self.assertEqual(effective_status(self.account, connection, now), "online")

    def test_legacy_automatic_states_and_removed_durations(self):
        url = "/api/v2/auth/presence/"
        for minutes in (45, 240, 480, 1440):
            self.assertEqual(self.client.patch(url, {"status": "away", "duration_minutes": minutes}, format="json").status_code, 400)
        for status in ("offline", "meeting"):
            self.account.presence_settings = {"status": status}
            self.assertEqual(settings_for(self.account)["status"], "online")
            self.account.save(update_fields=["presence_settings"])
            self.assertEqual(heartbeat_snapshot(self.session.pk)["rows"][0]["status"], "online")
        now = timezone.now()
        self.account.presence_settings = {"status": "away", "duration_minutes": 45, "expires_at": (now + timedelta(minutes=45)).isoformat()}
        self.assertEqual(settings_for(self.account, now)["duration_minutes"], 0)
        self.assertEqual(effective_status(self.account, now=now), "away")
        self.assertEqual(effective_status(self.account, now=now + timedelta(minutes=45)), "online")

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
