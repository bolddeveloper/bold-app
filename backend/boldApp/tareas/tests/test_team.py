import base64
import io
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from boldApp.core.models import JobRolePermission, Position, PositionAssignment
from boldApp.tareas.models import Attachment, Comment, PersonalTaskBoard, Task, TaskFollower, TaskStatus, TeamProfile, TeamTaskShare
from boldApp.tareas.team import can_read_shared_task
from boldApp.workspace.models import GoogleConnection


@override_settings(SECURE_SSL_REDIRECT=False)
class TeamTests(TestCase):
    root = "/api/v2/my-team/"

    @classmethod
    def setUpTestData(cls):
        call_command("seed_demo_data", verbosity=0, stdout=io.StringIO())
        cls.owner = PositionAssignment.objects.select_related("employee__user_account", "position__unit").get(employee__user_account__email="ana@bold.gt", is_active=True)
        cls.reader = PositionAssignment.objects.select_related("employee__user_account", "position__unit").get(employee__user_account__email="carla@bold.gt", is_active=True)
        cls.status = TaskStatus.objects.filter(unit=cls.owner.position.unit, is_final=False).first()

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.login(self.owner)
        self.task = Task.objects.create(unit=self.owner.position.unit, status=self.status, title="Trabajo compartible",
            created_by_assignment=self.owner, assignee_assignment=self.owner, priority="high")
        self.profile_url = f"{self.root}{self.owner.employee_id}/"

    def login(self, assignment):
        self.client.force_authenticate(assignment.employee.user_account)
        self.client.credentials(HTTP_X_ASSIGNMENT_ID=str(assignment.pk))

    def test_native_agenda_opt_in_independent_from_google_and_revoked_access(self):
        from boldApp.calendario.models import AppCalendar, CalendarMember
        user = self.owner.employee.user_account
        calendar = AppCalendar.objects.create(name="Producción", owner=user)
        root = f"/api/v2/calendar/local/{calendar.pk}/"
        self.client.post(root + "events/", {"summary": "Grabación", "description": "No publicar", "start": {"dateTime": "2026-10-19T09:00:00-06:00"}, "end": {"dateTime": "2026-10-19T10:00:00-06:00"}}, format="json")
        self.client.post(root + "events/", {"summary": "Privado", "visibility": "private", "start": {"date": "2026-10-19"}, "end": {"date": "2026-10-20"}}, format="json")
        meetings_url = self.profile_url + "meetings/?date=2026-10-19"
        self.assertEqual(self.client.get(meetings_url).data["state"], "hidden")
        self.assertEqual(self.client.put(root + "team-share/", {"share_team": "true"}, format="json").status_code, 400)
        self.assertTrue(self.client.put(root + "team-share/", {"share_team": True}, format="json").data["share_team"])
        self.login(self.reader)
        with patch("boldApp.calendario.service.google_request") as google:
            result = self.client.get(meetings_url)
            google.assert_not_called()
        self.assertEqual(result.data["state"], "shared")
        self.assertEqual({row["title"] for row in result.data["meetings"]}, {"Grabación", "Ocupado"})
        self.assertTrue(any(row["all_day"] for row in result.data["meetings"]))
        self.assertNotIn("description", result.data["meetings"][0])
        self.assertEqual(self.client.get(root + "events/").status_code, 404)
        self.assertEqual(self.client.put(root + "team-share/", {"share_team": True}, format="json").status_code, 404)
        member = CalendarMember.objects.create(calendar=calendar, user=self.reader.employee.user_account, role="reader")
        self.assertEqual(self.client.put(root + "team-share/", {"share_team": True}, format="json").status_code, 403)
        member.role = "manager"
        member.save()
        self.assertEqual(self.client.put(root + "team-share/", {"share_team": True}, format="json").status_code, 200)
        reader_url = f"{self.root}{self.reader.employee_id}/meetings/?date=2026-10-19"
        self.assertEqual(self.client.get(reader_url).data["state"], "shared")
        member.delete()
        self.assertEqual(self.client.get(reader_url).data["state"], "hidden")
        self.login(self.owner)
        self.client.put(root + "team-share/", {"share_team": False}, format="json")
        self.assertEqual(self.client.get(meetings_url).data["state"], "hidden")

    def publish(self, tasks=None, visible=True):
        return self.client.put(self.root + "self/", {"task_ids": [str(task.pk) for task in (tasks or [self.task])], "visible": visible}, format="json")

    def test_default_hidden_and_persistent_independent_publications(self):
        settings = self.client.get(self.root + "self/")
        self.assertIn("no-store", settings["Cache-Control"])
        self.assertFalse(settings.data["share_calendar"])
        self.assertEqual(self.client.get(self.profile_url + "board/").data["tasks"], [])
        self.assertEqual(self.publish().status_code, 200)
        self.assertEqual(self.publish().status_code, 200)
        self.assertEqual(TeamTaskShare.objects.filter(task=self.task).count(), 1)
        TaskFollower.objects.create(task=self.task, assignment=self.reader, added_by_assignment=self.owner)
        self.login(self.reader)
        self.assertEqual(self.publish().status_code, 200)
        self.assertEqual(TeamTaskShare.objects.filter(task=self.task).count(), 2)
        self.login(self.owner)
        self.assertEqual(self.publish(visible=False).status_code, 200)
        self.assertEqual(self.client.get(self.profile_url + "board/").data["tasks"], [])
        self.assertEqual(len(self.client.get(f"{self.root}{self.reader.employee_id}/board/").data["tasks"]), 1)
        self.assertTrue(Task.objects.filter(pk=self.task.pk).exists())

    def test_bulk_is_atomic_and_checks_participation_and_own_identity(self):
        other = Task.objects.create(unit=self.owner.position.unit, status=self.status, title="Ajena", created_by_assignment=self.reader)
        result = self.publish([self.task, other])
        self.assertEqual(result.status_code, 400, result.data)
        self.assertFalse(TeamTaskShare.objects.exists())
        self.assertEqual(self.publish().status_code, 200)
        self.login(self.reader)
        self.assertEqual(self.publish().status_code, 400)
        self.assertEqual(self.client.put(self.root + "self/", {"task_ids": [str(self.task.pk)], "visible": False, "employee_id": str(self.owner.employee_id)}, format="json").status_code, 200)
        self.assertTrue(TeamTaskShare.objects.filter(employee=self.owner.employee, task=self.task).exists())

    def test_assignee_can_publish_and_losing_participation_revokes_read(self):
        self.task.created_by_assignment = self.reader
        self.task.save()
        self.assertEqual(self.publish().status_code, 200)
        self.task.assignee_assignment = self.reader
        self.task.save()
        self.assertEqual(self.client.get(self.profile_url + "board/").data["tasks"], [])
        self.assertEqual(self.client.get(self.profile_url + f"tasks/{self.task.pk}/").status_code, 404)

    def test_permission_loss_and_inactive_publisher_revoke_publication(self):
        self.publish()
        JobRolePermission.objects.filter(job_role=self.owner.position.job_role, permission__code="tasks.task.read").delete()
        self.assertEqual(self.client.get(self.profile_url + "board/").data["tasks"], [])
        PositionAssignment.objects.filter(pk=self.owner.pk).update(is_active=False)
        self.login(self.reader)
        self.assertEqual(self.client.get(self.profile_url + "board/").status_code, 404)

    def test_read_projection_subtasks_files_and_no_comments(self):
        child = Task.objects.create(unit=self.owner.position.unit, status=self.status, title="Subtarea", parent_task=self.task, created_by_assignment=self.owner)
        grandchild = Task.objects.create(unit=self.owner.position.unit, status=self.status, title="Descendiente", parent_task=child, created_by_assignment=self.owner)
        Comment.objects.create(task=self.task, author_assignment=self.owner, body="Comentario privado")
        Attachment.objects.create(task=self.task, uploaded_by_assignment=self.owner, file_name="Brief", file_url="https://example.com/brief", mime_type="text/plain", size_bytes=10)
        self.publish()
        self.login(self.reader)
        detail_url = self.profile_url + f"tasks/{self.task.pk}/"
        result = self.client.get(detail_url)
        self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual({row["id"] for row in result.data["subtasks"]}, {str(child.pk), str(grandchild.pk)})
        self.assertEqual(result.data["attachments"][0]["file_name"], "Brief")
        self.assertNotIn("comments", result.data)
        self.assertNotIn("Comentario privado", str(result.data))
        self.assertEqual(self.client.patch(detail_url, {"title": "Cambio"}, format="json").status_code, 405)
        self.assertEqual(self.client.delete(detail_url).status_code, 405)
        self.assertEqual(self.client.get(self.profile_url + f"tasks/{child.pk}/").status_code, 200)
        child.deleted_at = timezone.now()
        child.save()
        self.assertEqual(self.client.get(self.profile_url + f"tasks/{grandchild.pk}/").status_code, 404)

    def test_read_sharing_does_not_expand_normal_write_permissions(self):
        self.login(self.reader)
        url = f"/api/v2/tasks/{self.task.pk}/"
        before = self.client.patch(url, {"title": "No autorizado"}, format="json").status_code
        self.login(self.owner)
        self.publish()
        self.login(self.reader)
        self.assertEqual(self.client.patch(url, {"title": "No autorizado"}, format="json").status_code, before)
        self.assertIn(before, (403, 404))

    @patch("boldApp.core.permissions.HasActiveAssignment.has_permission", return_value=True)
    def test_media_grant_never_includes_comment_images(self, active):
        from boldApp.workspace.image_storage import can_read
        comment = Comment.objects.create(task=self.task, author_assignment=self.owner, body="Privado")
        attachment = Attachment.objects.create(task=self.task, uploaded_by_assignment=self.owner, file_name="Imagen", file_url="https://example.com/image", mime_type="image/png", size_bytes=10)
        request = SimpleNamespace(assignment=self.reader)
        with patch("boldApp.tareas.views.AssignmentScopedViewSetMixin.visible_tasks") as visible, patch("boldApp.tareas.team.can_read_shared_task", return_value=True) as grant:
            visible.return_value.exists.return_value = False
            self.assertTrue(can_read(request, "task", self.task))
            self.assertTrue(can_read(request, "attachment", attachment))
            self.assertFalse(can_read(request, "comment", comment))
            self.assertEqual(grant.call_count, 2)

    def test_personal_stages_replace_old_sections_and_keep_unshared_tasks_hidden(self):
        section = str(uuid4())
        PersonalTaskBoard.objects.create(assignment=self.owner, sections=[{"id": section, "label": "Hoy"}], task_sections={str(self.task.pk): section}, unsectioned_index=0)
        hidden = Task.objects.create(unit=self.owner.position.unit, status=self.status, title="Oculta", created_by_assignment=self.owner)
        self.publish()
        response = self.client.get(self.profile_url + "board/")
        from boldApp.tareas.pipelines import personal_pipeline
        from boldApp.tareas.models import PersonalPipelineTask
        pipeline = personal_pipeline(self.owner.employee)
        stage = pipeline.stages[0]
        self.assertEqual(response.data["grouping"], "stages")
        self.assertEqual(response.data["board_name"], pipeline.name)
        self.assertEqual(response.data["stages"], [{"id":stage["id"],"label":stage["name"],"color":stage["color"],"probability":stage["probability"]}])
        self.assertEqual(response.data["tasks"][0]["stage"], stage["id"])
        self.assertEqual(response.data["tasks"][0]["stage_name"], stage["name"])
        PersonalPipelineTask.objects.create(pipeline=pipeline,task=self.task,stage_id=pipeline.stages[2]["id"])
        changed = self.client.get(self.profile_url + "board/")
        self.assertEqual(changed.data["stages"][0]["label"], pipeline.stages[2]["name"])
        self.assertEqual(changed.data["tasks"][0]["stage"], pipeline.stages[2]["id"])
        self.assertNotIn("Sin sección",str(changed.data))
        pipeline.stages[2]["name"] = "En aprobación"
        pipeline.name = "Seguimiento personal"
        pipeline.save(update_fields=["stages","name"])
        renamed = self.client.get(self.profile_url + "board/")
        self.assertEqual(renamed.data["board_name"],"Seguimiento personal")
        self.assertEqual(renamed.data["stages"][0]["label"],"En aprobación")
        self.assertEqual(renamed.data["tasks"][0]["stage_name"],"En aprobación")
        self.assertNotIn(str(hidden.pk), str(response.data))
        self.task.deleted_at = timezone.now()
        self.task.save()
        self.assertFalse(can_read_shared_task(SimpleNamespace(assignment=self.reader), self.task.pk))

    def test_directory_deduplicates_people_but_keeps_departments(self):
        position = Position.objects.create(unit=self.reader.position.unit, job_role=self.owner.position.job_role, display_order=90)
        extra = PositionAssignment.objects.create(position=position, employee=self.owner.employee)
        response = self.client.get(self.root + "directory/")
        for department in response.data["departments"]:
            ids = [person["id"] for person in department["people"]]
            self.assertEqual(len(ids), len(set(ids)))
        self.publish()
        self.login(extra)
        self.assertIn(str(self.task.pk), self.client.get(self.root + "self/").data["task_ids"])
        self.assertEqual(self.client.post(self.root + "directory/", {"name": "Nuevo"}).status_code, 405)

    @patch("boldApp.calendario.service.google_request")
    def test_calendar_consent_minimal_projection_and_revocation(self, google):
        self.assertEqual(self.client.get(self.profile_url + "meetings/?date=2026-10-17").data["state"], "hidden")
        google.assert_not_called()
        self.assertEqual(self.client.patch(self.root + "self/", {"share_calendar": True}, format="json").status_code, 200)
        self.assertEqual(self.client.get(self.profile_url + "meetings/?date=2026-10-17").data["state"], "disconnected")
        GoogleConnection.objects.create(user=self.owner.employee.user_account, email="ana@bold.gt", subject="test", time_zone="America/Tegucigalpa")
        event = {"id": "public", "summary": "Planificación", "start": {"dateTime": "2026-10-17T09:00:00-06:00"}, "end": {"dateTime": "2026-10-17T10:00:00-06:00"}, "attendees": [{"email": "secret@example.com"}], "description": "Privado", "hangoutLink": "https://meet.google.com/secret"}
        google.return_value = {"items": [event, {**event, "id": "private", "visibility": "private"}, {**event, "id": "cancelled", "status": "cancelled"}, {**event, "id": "declined", "attendees": [{"self": True, "responseStatus": "declined"}]}]}
        result = self.client.get(self.profile_url + "meetings/?date=2026-10-17")
        self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual([row["title"] for row in result.data["meetings"]], ["Planificación", "Ocupado"])
        self.assertEqual(set(result.data["meetings"][0]), {"id", "title", "start", "end"})
        self.assertNotIn("secret", str(result.data))
        self.assertEqual(google.call_args.kwargs["params"]["singleEvents"], "true")
        self.client.patch(self.root + "self/", {"share_calendar": False}, format="json")
        self.assertEqual(self.client.get(self.profile_url + "meetings/?date=2026-10-17").data["state"], "hidden")

    def test_shared_audio_and_media_grant_revoked_with_publication(self):
        raw = b"RIFF" + b"\x00" * 4 + b"WAVE"
        note_id = str(uuid4())
        self.task.voice_notes = [{"id": note_id, "name": "Nota", "duration": 1, "mime_type": "audio/wav", "size_bytes": len(raw), "data_url": "data:audio/wav;base64," + base64.b64encode(raw).decode()}]
        self.task.save()
        self.publish()
        self.login(self.reader)
        url = self.profile_url + f"tasks/{self.task.pk}/voice-note/?note={note_id}"
        self.assertEqual(self.client.get(url).content, raw)
        self.assertTrue(can_read_shared_task(SimpleNamespace(assignment=self.reader), self.task.pk))
        self.login(self.owner)
        self.publish(visible=False)
        self.login(self.reader)
        self.assertEqual(self.client.get(url).status_code, 404)
        self.assertFalse(can_read_shared_task(SimpleNamespace(assignment=self.reader), self.task.pk))

    def test_authentication_and_dates(self):
        self.client.force_authenticate(None)
        self.assertIn(self.client.get(self.root + "directory/").status_code, (401, 403))
        self.login(self.owner)
        TeamProfile.objects.create(employee=self.owner.employee, share_calendar=True)
        GoogleConnection.objects.create(user=self.owner.employee.user_account, email="ana@bold.gt", subject="test")
        self.assertEqual(self.client.get(self.profile_url + "meetings/?date=invalid").status_code, 400)
