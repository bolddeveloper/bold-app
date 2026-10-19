import io
import json
from pathlib import Path
from unittest.mock import patch

from django.core.management import call_command
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from boldApp.core.models import UserAccount
from boldApp.calendario.models import AppCalendar, CalendarMember


@override_settings(SECURE_SSL_REDIRECT=False)
class LocalCalendarTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("seed_demo_data", verbosity=0, stdout=io.StringIO())
        cls.owner = UserAccount.objects.get(email="luis@bold.gt")
        cls.member = UserAccount.objects.get(email="samuel@bold.gt")

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.owner)
        self.member_client = APIClient()
        self.member_client.force_authenticate(self.member)
        self.calendar = AppCalendar.objects.create(name="Grabaciones", owner=self.owner)
        self.root = f"/api/v2/calendar/local/{self.calendar.pk}/"
        self.event = {"summary": "Grabación", "start": {"dateTime": "2026-10-19T09:00:00-06:00"}, "end": {"dateTime": "2026-10-19T10:00:00-06:00"}}

    def test_private_sharing_roles_revocation_and_no_google_calls(self):
        with patch("boldApp.workspace.service.google") as google:
            self.assertEqual(self.member_client.get("/api/v2/calendar/local/").data, {"calendars": []})
            self.assertEqual(self.member_client.get(self.root + "events/").status_code, 404)
            self.assertEqual(self.client.put(self.root + "members/", {"email": self.member.email, "role": "reader"}, format="json").status_code, 200)
            created = self.client.post(self.root + "events/", self.event, format="json")
            self.assertEqual(created.status_code, 201, created.data)
            event_id = created.data["id"]
            url = self.root + f"events/{event_id}/"
            response = self.member_client.get(self.root + "events/", {"start": "2026-10-19T00:00:00Z", "end": "2026-10-20T00:00:00Z"})
            self.assertTrue(response.data["events"][0]["locked"])
            self.assertEqual(self.member_client.patch(url, {"summary": "Cambio"}, format="json").status_code, 403)
            self.client.put(self.root + "members/", {"email": self.member.email, "role": "editor"}, format="json")
            self.assertEqual(self.member_client.patch(url, {"summary": "Cambio"}, format="json").status_code, 200)
            self.assertEqual(self.member_client.delete(self.root).status_code, 403)
            self.client.put(self.root + "members/", {"email": self.member.email, "role": "remove"}, format="json")
            self.assertEqual(self.member_client.patch(url, {"summary": "Cambio"}, format="json").status_code, 404)
            google.assert_not_called()

    def test_validation_calendar_isolation_and_all_day_boundaries(self):
        other = AppCalendar.objects.create(name="Privado", owner=self.member)
        self.assertEqual(self.client.post(self.root + "events/", {**self.event, "start": {"dateTime": "2026-10-19T09:00:00"}, "end": {"dateTime": "2026-10-19T10:00:00"}}, format="json").status_code, 400)
        self.assertEqual(self.client.post(self.root + "events/", {**self.event, "attendees": [{"email": self.member.email}]}, format="json").status_code, 400)
        self.assertEqual(self.client.post(self.root + "events/", {**self.event, "hangoutLink": "https://evil.example/a"}, format="json").status_code, 400)
        result = self.client.post(self.root + "events/", {"summary": "Todo el día", "start": {"date": "2026-10-19"}, "end": {"date": "2026-10-20"}}, format="json")
        self.assertEqual(result.status_code, 201)
        self.assertEqual(self.member_client.patch(f"/api/v2/calendar/local/{other.pk}/events/{result.data['id']}/", {"summary": "No"}, format="json").status_code, 404)
        rows = self.client.get(self.root + "events/", {"start": "2026-10-20T00:00:00Z", "end": "2026-10-21T00:00:00Z"})
        self.assertEqual(rows.data["events"], [])
        self.assertEqual(self.client.delete(self.root).status_code, 204)
        self.assertTrue(AppCalendar.objects.filter(pk=other.pk).exists())

    def test_new_calendars_start_private_and_reject_empty_names(self):
        self.assertEqual(self.member_client.post("/api/v2/calendar/local/", {"name": "   "}, format="json").status_code, 400)
        result = self.member_client.post("/api/v2/calendar/local/", {"name": "Mi agenda"}, format="json")
        self.assertEqual(result.status_code, 201)
        self.assertFalse(result.data["protected"])
        self.assertTrue(result.data["can_manage"])
        self.assertEqual(len(result.data["members"]), 1)
        self.assertEqual(self.client.get(f"/api/v2/calendar/local/{result.data['id']}/events/").status_code, 404)

    def test_timed_task_can_be_edited_completed_and_reopened(self):
        with patch("boldApp.workspace.service.google") as google:
            result = self.client.post(self.root + "events/", {**self.event, "kind": "task"}, format="json")
            self.assertEqual(result.status_code, 201, result.data)
            self.assertEqual(result.data["kind"], "task")
            self.assertFalse(result.data["completed"])
            self.assertEqual(result.data["start"]["dateTime"], self.event["start"]["dateTime"])
            url = self.root + f"events/{result.data['id']}/"
            self.assertTrue(self.client.patch(url, {"completed": True}, format="json").data["completed"])
            self.assertFalse(self.client.patch(url, {"completed": False}, format="json").data["completed"])
            self.assertEqual(self.client.patch(url, {"kind": "invalid"}, format="json").status_code, 400)
            google.assert_not_called()

    def test_custom_card_color_is_saved_validated_and_kept_when_completing(self):
        result = self.client.post(self.root + "events/", {**self.event, "kind": "task", "color": "#123abc"}, format="json")
        self.assertEqual(result.status_code, 201, result.data)
        self.assertEqual(result.data["color"], "#123abc")
        url = self.root + f"events/{result.data['id']}/"
        self.assertEqual(self.client.patch(url, {"completed": True}, format="json").data["color"], "#123abc")
        self.assertEqual(self.client.patch(url, {"color": "red;display:none"}, format="json").status_code, 400)

    def test_production_import_is_private_protected_and_preserves_edits(self):
        output = io.StringIO()
        call_command("import_production_calendar", owner=self.owner.email, manager=[self.member.email], stdout=output)
        calendar = AppCalendar.objects.get(system_key="production")
        self.assertEqual(calendar.events.count(), 576)
        self.assertEqual(CalendarMember.objects.get(calendar=calendar, user=self.member).role, "manager")
        row = calendar.events.first()
        row.data["summary"] = "Título corregido"
        row.save()
        call_command("import_production_calendar", owner=self.owner.email, manager=[self.member.email], stdout=output)
        row.refresh_from_db()
        self.assertEqual(row.data["summary"], "Título corregido")
        self.assertEqual(calendar.events.count(), 576)
        url = f"/api/v2/calendar/local/{calendar.pk}/"
        self.assertEqual(self.client.delete(url).status_code, 403)
        self.assertEqual(self.member_client.delete(url).status_code, 403)
        self.assertEqual(self.client.patch(url, {"name": "Otro"}, format="json").status_code, 400)
        CalendarMember.objects.filter(calendar=calendar).delete()
        self.assertFalse(any(row["protected"] for row in self.member_client.get("/api/v2/calendar/local/").data["calendars"]))

    @override_settings(GOOGLE_WORKSPACE_CLIENT_ID="client", GOOGLE_WORKSPACE_CLIENT_SECRET="secret", GOOGLE_WORKSPACE_REDIRECT_URI="http://testserver/callback")
    def test_meet_requires_grant_and_never_calls_calendar(self):
        url = self.root + "meet/"
        self.assertEqual(self.client.post(url, {}, format="json").status_code, 409)
        with patch("boldApp.workspace.google_config.public_connection", return_value={"services": {"meet": {"status": "available"}}}), patch("boldApp.workspace.service.google", return_value={"meetingUri": "https://meet.google.com/abc-defg-hij"}) as google:
            result = self.client.post(url, {}, format="json")
            self.assertEqual(result.status_code, 201)
            google.assert_called_once_with(self.owner, "POST", "/spaces", api="meet", body={})
        self.assertEqual(self.member_client.post(url, {}, format="json").status_code, 404)

    def test_dataset_keeps_both_agendas_and_original_text(self):
        data = json.loads((Path(__file__).parents[1] / "data" / "production_calendar.json").read_text(encoding="utf-8"))
        self.assertEqual(len({row["source_key"] for row in data["events"]}), 576)
        self.assertEqual({row["source_agenda"] for row in data["events"]}, {"Calendario José", "Calendario Axel"})
        self.assertTrue(data["warnings"])
        self.assertEqual(next(row for row in data["events"] if row["source_key"] == "Calendario José:B8")["start"], {"date": "2025-01-06"})

    def test_scheduling_preserves_existing_timed_events_and_is_repeatable(self):
        calendar = AppCalendar.objects.create(name="Calendario producción",system_key="production",owner=self.owner)
        data = {"summary":"Empagua 8:30 a 10:30 AM / Cassesa 12:00 a 4:30 PM","start":{"date":"2026-10-19"},"end":{"date":"2026-10-20"},"color":"#123abc"}
        from boldApp.calendario.local import event_times
        start,end = event_times(data)
        row=calendar.events.create(data=data,start_at=start,end_at=end,source_key="test:cell")
        output=io.StringIO()
        call_command("schedule_production_calendar",daytime=True,dry_run=True,stdout=output)
        row.refresh_from_db();self.assertIn("date",row.data["start"])
        call_command("schedule_production_calendar",daytime=True,stdout=output)
        row.refresh_from_db();self.assertIn("T08:30",row.data["start"]["dateTime"])
        self.assertEqual(row.data["color"],"#123abc")
        self.assertEqual(row.data["source_hours"]["original_summary"],data["summary"])
        self.assertEqual(calendar.events.count(),2)
        changed=row.updated_at
        call_command("schedule_production_calendar",daytime=True,stdout=output)
        row.refresh_from_db();self.assertEqual(row.updated_at,changed)
        self.assertEqual(calendar.events.count(),2)
