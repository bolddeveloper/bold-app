import uuid

from django.test import TestCase, override_settings
from django.utils import timezone

from boldApp.core.models import JobRolePermission, Permission, Position, PositionAssignment
from boldApp.tareas.models import Task, TaskFollower, TaskStatus
from . import test_channels as base
from .models import ChannelMessage


@override_settings(MESSAGING_PILOT_ENABLED=False)
class ChannelTaskReferenceTests(TestCase):
    root = base.DepartmentChannelTests.root
    identity = base.DepartmentChannelTests.identity
    as_person = base.DepartmentChannelTests.as_person
    send = base.DepartmentChannelTests.send
    deny = base.DepartmentChannelTests.deny

    def setUp(self):
        base.DepartmentChannelTests.setUp(self)
        self.permission = Permission.objects.get(code="tasks.task.read")
        JobRolePermission.objects.create(job_role=self.role, permission=self.permission, effect="allow", scope_type="own_unit")
        status = TaskStatus.objects.create(unit=self.it, name="Pendiente", category="todo", position=1)
        self.task = Task.objects.create(unit=self.it, title="Revisión reservada del proyecto", status=status, created_by_assignment=self.alice)

    def history(self, assignment):
        return self.as_person(assignment).get(self.url + "messages/").data["results"][0]

    def test_reference_is_not_a_share_and_reader_without_access_sees_no_metadata(self):
        response = self.send("", task_id=str(self.task.pk))
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["message"]["task"], {"available":True, "id":str(self.task.pk), "title":self.task.title, "status":"Pendiente", "completed":False})
        hidden = self.history(self.bob)
        self.assertEqual(hidden["task"], {"available":False})
        self.assertNotIn(self.task.title, str(hidden))
        self.assertNotIn(str(self.task.pk), str(hidden))
        self.assertFalse(TaskFollower.objects.filter(task=self.task, assignment=self.bob).exists())
        self.assertEqual(self.as_person(self.bob).get(f"/api/v2/tasks/{self.task.pk}/").status_code, 404)

    def test_cross_department_task_participant_sees_current_card_and_revocation_hides_it_again(self):
        self.send("Referencia", task_id=str(self.task.pk))
        follower = TaskFollower.objects.create(task=self.task, assignment=self.bob, notification_level="all", added_by_assignment=self.alice)
        self.assertTrue(self.history(self.bob)["task"]["available"])
        self.task.title = "Título actualizado, no una copia del anterior"
        self.task.save()
        self.assertEqual(self.history(self.bob)["task"]["title"], self.task.title)
        follower.delete()
        self.assertEqual(self.history(self.bob)["task"], {"available":False})

    def test_explicit_task_deny_and_mfa_override_shared_membership(self):
        self.send(task_id=str(self.task.pk))
        TaskFollower.objects.create(task=self.task, assignment=self.bob, notification_level="all", added_by_assignment=self.alice)
        rule = JobRolePermission.objects.create(job_role=self.role, permission=self.permission, effect="deny", scope_type="specific_unit", target_unit=self.it)
        self.assertEqual(self.history(self.bob)["task"], {"available":False})
        rule.delete()
        self.permission.requires_step_up_mfa = True
        self.permission.save()
        self.assertEqual(self.history(self.bob)["task"], {"available":False})

    def test_sender_must_read_task_and_cannot_submit_unknown_or_deleted_references(self):
        self.client = self.as_person(self.bob)
        self.assertEqual(self.send(task_id=str(self.task.pk)).status_code, 404)
        self.assertEqual(self.send(task_id=str(uuid.uuid4())).status_code, 404)
        self.assertEqual(ChannelMessage.objects.count(), 0)
        self.client = self.as_person(self.alice)
        self.task.deleted_at = timezone.now()
        self.task.save()
        self.assertEqual(self.send(task_id=str(self.task.pk)).status_code, 404)

    def test_deleted_task_preserves_message_but_never_its_protected_details(self):
        response = self.send("", task_id=str(self.task.pk))
        self.assertEqual(response.status_code, 201)
        self.task.deleted_at = timezone.now()
        self.task.save()
        self.assertEqual(self.history(self.alice)["task"], {"available":False})
        self.assertEqual(ChannelMessage.objects.count(), 1)

    def test_retry_is_immutable_and_does_not_revalidate_or_disclose_a_revoked_reference(self):
        token = str(uuid.uuid4())
        first = self.send("", client_id=token, task_id=str(self.task.pk))
        self.assertEqual(first.status_code, 201)
        self.task.deleted_at = timezone.now()
        self.task.save()
        retry = self.send("", client_id=token, task_id=str(self.task.pk))
        self.assertEqual(retry.status_code, 200)
        self.assertEqual(retry.data["message"]["id"], first.data["message"]["id"])
        self.assertEqual(retry.data["message"]["task"], {"available":False})
        self.assertEqual(self.send("", client_id=token, task_id=str(uuid.uuid4())).status_code, 409)

    def test_body_can_be_empty_only_when_message_keeps_a_task_reference(self):
        message = self.send("Comentario", task_id=str(self.task.pk)).data["message"]
        url = self.url + "messages/" + message["id"] + "/"
        self.assertEqual(self.client.patch(url, {"body":"", "version":1}, format="json").status_code, 200)
        self.assertEqual(self.client.patch(url, {"body":"Cambio", "version":2, "task_id":str(uuid.uuid4())}, format="json").status_code, 400)

    def test_task_search_uses_task_visibility_not_channel_membership(self):
        url = self.url + "tasks/?q=reservada"
        first = self.client.get(url)
        self.assertEqual(first.status_code, 200, first.data)
        self.assertEqual([row["id"] for row in first.data["results"]], [str(self.task.pk)])
        self.assertEqual(self.as_person(self.bob).get(url).data["results"], [])
        TaskFollower.objects.create(task=self.task, assignment=self.bob, notification_level="all", added_by_assignment=self.alice)
        self.assertEqual(self.as_person(self.bob).get(url).data["results"][0]["id"], str(self.task.pk))
        self.assertEqual(self.client.get(self.url + "tasks/?q=a").status_code, 400)

    def test_task_search_requires_channel_read_and_write_even_when_task_is_visible(self):
        self.deny("slack.message.create")
        self.assertEqual(self.client.get(self.url + "tasks/?q=reservada").status_code, 403)

    def test_task_reference_never_unions_the_authors_other_active_assignments(self):
        self.send("", task_id=str(self.task.pk))
        other_assignment = PositionAssignment.objects.create(employee=self.alice.employee,
            position=Position.objects.create(unit=self.marketing, job_role=self.role))
        self.assertEqual(self.history(other_assignment)["task"], {"available":False})
        self.client = self.as_person(other_assignment)
        self.assertEqual(self.send(task_id=str(self.task.pk)).status_code, 404)
