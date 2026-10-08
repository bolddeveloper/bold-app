import io
from datetime import timedelta
from unittest.mock import patch

from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone

from boldApp.core.models import UserAccount
from boldApp.workspace.models import GoogleConnection
from boldApp.workspace.google_config import SCOPES
from boldApp.notificaciones.models import Notification
from boldApp.calendario.reminders import send_reminders, refresh_reminders


class MeetingRemindersTests(TestCase):
    def test_personal_reminders_at_30_5_and_start_once_per_occurrence(self):
        call_command("seed_demo_data", verbosity=0, stdout=io.StringIO())
        user = UserAccount.objects.get(email="ana@bold.gt")
        GoogleConnection.objects.create(user=user, email=user.email, subject="reminders", client_id="client", scopes=" ".join(SCOPES["calendar"]))
        start = timezone.now().replace(microsecond=0)
        event = {"id": "meeting" * 200, "summary": "Equipo", "hangoutLink": "https://meet.google.com/example",
            "organizer": {"email": "other@bold.gt"}, "attendees": [{"email": user.email, "responseStatus": "accepted"}],
            "start": {"dateTime": start.isoformat()}, "end": {"dateTime": (start + timedelta(hours=1)).isoformat()}}
        for minutes in (30, 5, 0):
            now = start - timedelta(minutes=minutes)
            self.assertEqual(send_reminders(user, [event], now), 1)
            self.assertEqual(send_reminders(user, [event], now), 0)
        rows = Notification.objects.filter(type="calendar.meeting_reminder")
        self.assertEqual(rows.count(), 3)
        self.assertTrue(all(row.recipient_assignment.employee_id == user.employee_id for row in rows))
        self.assertEqual({row.metadata["minutes"] for row in rows}, {30, 5, 0})
        self.assertEqual(send_reminders(user, [event], start + timedelta(minutes=2)), 0)
        moved = {**event, "start": {"dateTime": (start + timedelta(days=1)).isoformat()}, "end": {"dateTime": (start + timedelta(days=1, hours=1)).isoformat()}}
        self.assertEqual(send_reminders(user, [moved], start + timedelta(days=1)), 1)
        for invalid in ({**moved, "status": "cancelled"}, {**moved, "attendees": [{"email": user.email, "responseStatus": "declined"}]}, {**moved, "attendees": [{"email": "other@bold.gt"}]}, {**moved, "start": {"date": "2026-10-07"}}):
            self.assertEqual(send_reminders(user, [invalid], start + timedelta(days=1)), 0)
        with patch("boldApp.calendario.reminders.caches") as cache:
            cache.__getitem__.return_value.add.side_effect = RuntimeError("Cache unavailable")
            self.assertEqual(refresh_reminders(user), 0)
        UserAccount.objects.filter(pk=user.pk).update(is_active=False)
        future = {**event, "start": {"dateTime": (start + timedelta(days=2)).isoformat()}, "end": {"dateTime": (start + timedelta(days=2, hours=1)).isoformat()}}
        self.assertEqual(send_reminders(user, [future], start + timedelta(days=2)), 0)
