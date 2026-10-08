import base64
import io
from datetime import date

from django.core.management import call_command
from django.test import TestCase, RequestFactory, override_settings
from rest_framework.test import APIClient

from boldApp.autenticacion.services import create_session
from boldApp.core.models import UserAccount, PositionAssignment, JobRolePermission
from boldApp.tareas.models import Attachment, Task, TaskStatus, TaskProject, TaskFollower, TaskTag, Tag, Project, Comment
from boldApp.tareas.recurrence import generate_recurring_tasks, next_date


@override_settings(DEBUG=True, SECURE_SSL_REDIRECT=False)
class TaskFeaturesTests(TestCase):
    def setUp(self):
        call_command("seed_demo_data", verbosity=0, stdout=io.StringIO())
        self.user = UserAccount.objects.get(email="ana@bold.gt")
        self.assignment = PositionAssignment.objects.get(employee=self.user.employee, is_active=True)
        self.unit = self.assignment.position.unit
        self.status = TaskStatus.objects.filter(unit=self.unit, is_final=False).order_by("position").first()
        _, session = create_session(self.user, RequestFactory().get("/"))
        self.client = APIClient()
        self.client.force_authenticate(self.user, session)
        self.client.credentials(HTTP_X_ASSIGNMENT_ID=str(self.assignment.pk))
        self.task = Task.objects.create(unit=self.unit, status=self.status, title="Plantilla",
            created_by_assignment=self.assignment, assignee_assignment=self.assignment)

    def test_repeat_generates_dated_copies_with_subtasks_and_stops_at_end(self):
        rule = {"frequency": "monthly", "interval": 1, "until": "2026-04-30"}
        response = self.client.patch(f"/api/v2/tasks/{self.task.pk}/", {"start_date": "2026-01-31", "due_date": "2026-02-02", "recurrence": rule}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["recurrence_next_date"], "2026-02-28")
        child = Task.objects.create(unit=self.unit, status=self.status, title="Subtarea", parent_task=self.task,
            created_by_assignment=self.assignment, start_date=date(2026, 2, 1), due_date=date(2026, 2, 2))
        project = Project.objects.create(unit=self.unit, name="Repetición", created_by_assignment=self.assignment, owner_assignment=self.assignment)
        TaskProject.objects.create(task=self.task, project=project, position=1, added_by_assignment=self.assignment)
        TaskFollower.objects.create(task=self.task, assignment=self.assignment, added_by_assignment=self.assignment)
        tag = Tag.objects.create(unit=self.unit, name="Recurrente")
        TaskTag.objects.create(task=self.task, tag=tag, added_by_assignment=self.assignment)
        Attachment.objects.create(task=self.task, uploaded_by_assignment=self.assignment, file_name="Brief", file_url="https://example.com/brief", mime_type="text/plain", size_bytes=20)
        self.assertEqual(generate_recurring_tasks(date(2026, 3, 31)), 2)
        copies = list(Task.objects.filter(recurrence_source=self.task).order_by("recurrence_date"))
        self.assertEqual([item.start_date for item in copies], [date(2026, 2, 28), date(2026, 3, 31)])
        self.assertEqual(copies[0].due_date, date(2026, 3, 2))
        self.assertEqual(copies[0].followers.count(), 1)
        self.assertTrue(copies[0].task_projects.filter(project=project).exists())
        self.assertTrue(copies[0].task_tags.filter(tag=tag).exists())
        self.assertEqual(copies[0].attachments.get().file_url, "https://example.com/brief")
        self.assertEqual(copies[0].subtasks.get().due_date, date(2026, 3, 2))
        self.assertIsNone(copies[0].subtasks.get().recurrence_source)
        self.assertEqual(generate_recurring_tasks(date(2026, 3, 31)), 0)
        # Saving an unchanged form must not rewind the schedule.
        self.client.patch(f"/api/v2/tasks/{self.task.pk}/", {"recurrence": rule, "due_date": "2026-02-02", "title": "Nuevo"}, format="json")
        self.task.refresh_from_db()
        self.assertEqual(self.task.recurrence_next_date, date(2026, 4, 30))
        self.assertEqual(generate_recurring_tasks(date(2026, 5, 31)), 1)
        self.task.refresh_from_db()
        self.assertIsNone(self.task.recurrence_next_date)
        self.assertEqual(generate_recurring_tasks(date(2026, 6, 30)), 0)
        self.assertEqual(next_date(date(2026, 1, 31), {**rule, "frequency": "weekly", "interval": 2}), date(2026, 2, 14))
        self.assertIsNone(next_date(date(9998, 1, 1), {**rule, "interval": 365, "until": "9998-12-31"}))
        for invalid in ({"frequency": "daily"}, {**rule, "interval": 0}, {**rule, "until": "2026-01-01"}):
            self.assertEqual(self.client.patch(f"/api/v2/tasks/{self.task.pk}/", {"recurrence": invalid}, format="json").status_code, 400)
        JobRolePermission.objects.filter(job_role=self.assignment.position.job_role, permission__code="tasks.task.create").delete()
        self.task.recurrence_next_date = date(2026, 2, 28)
        self.task.save()
        self.assertEqual(generate_recurring_tasks(date(2026, 3, 31)), 0)

    def test_voice_comments_persist_edit_delete_and_require_task_access(self):
        raw = b"RIFF" + b"\x00" * 4 + b"WAVE" + b"\x00" * 40
        note = {"name": "Contexto", "duration": 1, "data_url": "data:audio/wav;base64," + base64.b64encode(raw).decode()}
        response = self.client.patch(f"/api/v2/tasks/{self.task.pk}/", {"voice_notes": [note]}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        metadata = response.data["voice_notes"]
        self.assertNotIn("data_url", metadata[0])
        task_audio = f"/api/v2/tasks/{self.task.pk}/voice-note/?note={metadata[0]['id']}"
        self.assertEqual(self.client.get(task_audio).content, raw)
        response = self.client.post("/api/v2/comments/", {"task": str(self.task.pk), "body": "", "voice_notes": [note]}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        comment_id = response.data["id"]
        notes = response.data["voice_notes"]
        url = f"/api/v2/comments/{comment_id}/"
        response = self.client.patch(url, {"body": "Editado", "voice_notes": notes}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["voice_notes"], notes)
        self.assertEqual(self.client.get(url + f"voice-note/?note={notes[0]['id']}").content, raw)
        self.assertEqual(self.client.patch(url, {"body": "", "voice_notes": []}, format="json").status_code, 400)
        self.assertEqual(self.client.patch(url, {"voice_notes": metadata}, format="json").status_code, 400)
        self.assertEqual(self.client.patch(url, {"voice_notes": [{"id": []}]}, format="json").status_code, 400)
        self.assertEqual(self.client.post("/api/v2/comments/", {"task": str(self.task.pk), "voice_notes": [{**note, "duration": 121}]}, format="json").status_code, 400)
        self.assertEqual(self.client.patch(f"/api/v2/tasks/{self.task.pk}/", {"voice_notes": [{**note, "data_url": "data:audio/wav;base64,aGVsbG8="}]}, format="json").status_code, 400)
        self.assertEqual(self.client.delete(url).status_code, 204)
        self.assertFalse(Comment.objects.filter(pk=comment_id).exists())
        self.assertEqual(self.client.get(url + f"voice-note/?note={notes[0]['id']}").status_code, 404)
        JobRolePermission.objects.filter(job_role=self.assignment.position.job_role, permission__code="tasks.task.read").delete()
        self.assertIn(self.client.get(task_audio).status_code, (403, 404))
