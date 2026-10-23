import uuid
from django.test import TestCase, override_settings
from django.utils import timezone
from boldApp.core.models import Permission, JobRolePermission
from boldApp.tareas.models import Task, TaskStatus
from . import test_channels as base
from .models import ChannelPage, PageRevision, ChannelAccessRule, DepartmentChannel, ChannelMessage


@override_settings(MESSAGING_PILOT_ENABLED=False)
class ChannelPageTests(TestCase):
    root = base.DepartmentChannelTests.root
    identity = base.DepartmentChannelTests.identity
    as_person = base.DepartmentChannelTests.as_person
    deny = base.DepartmentChannelTests.deny
    send = base.DepartmentChannelTests.send

    def setUp(self):
        base.DepartmentChannelTests.setUp(self)
        self.collection = self.url + "pages/"
        self.input = {"client_id": str(uuid.uuid4()), "title": "Acuerdos del equipo", "icon": "note", "blocks": self.blocks("Primer acuerdo")}
        response = self.client.post(self.collection, self.input, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.page = response.data
        self.detail = self.collection + self.page["id"] + "/"

    def blocks(self, text):
        return [{"id": str(uuid.uuid4()), "type": "paragraph", "text": text}]

    def save(self, client=None, **extra):
        return (client or self.client).put(self.detail, {"client_id": str(uuid.uuid4()), "version": self.page["version"],
            "title": self.page["title"], "icon": self.page["icon"], "blocks": self.page["blocks"], **extra}, format="json")

    def test_create_retry_and_noop_do_not_duplicate_history(self):
        result = self.client.post(self.collection, self.input, format="json")
        self.assertEqual(result.status_code, 200)
        self.assertEqual(ChannelPage.objects.count(), 1)
        self.assertEqual(self.save().status_code, 200)
        self.assertEqual(PageRevision.objects.count(), 1)
        mismatch = self.client.post(self.collection, {**self.input, "title": "Otro contenido"}, format="json")
        self.assertEqual(mismatch.status_code, 409)

    def test_two_accounts_conflict_and_restore_as_new_revision(self):
        bob = self.as_person(self.bob)
        result = self.save(blocks=self.blocks("Guardado por Alicia"))
        self.assertEqual(result.status_code, 200, result.data)
        stale = self.save(bob, blocks=self.blocks("Borrador de Roberto"))
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(stale.data["current"]["version"], 2)
        self.assertIn("Alicia", str(stale.data["current"]["blocks"]))
        self.assertEqual(PageRevision.objects.count(), 2)
        restored = bob.patch(self.detail, {"version": 2, "client_id": str(uuid.uuid4()), "restore_version": 1}, format="json")
        self.assertEqual(restored.status_code, 200, restored.data)
        self.assertEqual(restored.data["version"], 3)
        self.assertEqual(restored.data["blocks"], self.page["blocks"])
        self.assertEqual(PageRevision.objects.count(), 3)
        history = bob.get(self.detail + "history/")
        self.assertEqual([r["version"] for r in history.data["results"]], [3, 2, 1])
        self.assertNotIn("blocks", history.data["results"][0])
        self.assertEqual(bob.get(self.detail + "history/2/").data["blocks"], result.data["blocks"])

    def test_save_retry_after_other_writer_returns_current_and_receipt_version(self):
        operation = {"client_id": str(uuid.uuid4()), "title": "Uno", "blocks": [], "icon": "book", "version": 1}
        self.assertEqual(self.client.put(self.detail, operation, format="json").status_code, 200)
        self.assertEqual(self.save(self.as_person(self.bob), title="Dos", version=2).status_code, 200)
        result = self.client.put(self.detail, operation, format="json")
        self.assertEqual(result.status_code, 200)
        self.assertEqual((result.data["version"], result.data["accepted_version"]), (3, 2))
        self.assertEqual(PageRevision.objects.count(), 3)
        self.assertEqual(self.client.put(self.detail, {**operation, "title": "Manipulado"}, format="json").status_code, 409)

    def test_archive_preserves_history_requires_manage_and_prevents_edit(self):
        action = {"version": 1, "client_id": str(uuid.uuid4()), "archived": True}
        self.assertEqual(self.client.patch(self.detail, action, format="json").status_code, 200)
        self.assertEqual(self.client.patch(self.detail, action, format="json").status_code, 200)
        self.assertEqual(self.client.get(self.collection).data["results"], [])
        self.assertEqual(len(self.client.get(self.collection + "?archived=true").data["results"]), 1)
        self.assertEqual(self.save(version=2, title="No").status_code, 409)
        self.assertEqual(self.client.delete(self.detail).status_code, 405)
        self.assertEqual(PageRevision.objects.count(), 2)
        self.deny("slack.page.manage")
        self.assertEqual(self.client.patch(self.detail, {**action, "client_id": str(uuid.uuid4()), "version": 2, "archived": False}, format="json").status_code, 403)

    def test_private_boundary_hides_pages_history_and_cards_even_from_owner(self):
        channel = DepartmentChannel.objects.get(pk=self.channel_id)
        channel.visibility = "private"
        channel.save()
        for assignment in (self.bob, self.owner):
            client = self.as_person(assignment)
            for endpoint in (self.collection, self.detail, self.detail+"history/", self.detail+"history/1/"):
                self.assertEqual(client.get(endpoint).status_code, 404)
            self.assertEqual(self.save(client, title="No autorizado").status_code, 404)
        rule = ChannelAccessRule.objects.create(channel=channel, employee=self.bob.employee, access="read")
        client = self.as_person(self.bob)
        self.assertEqual(client.get(self.detail).status_code, 200)
        self.assertFalse(client.get(self.detail).data["can_edit"])
        self.assertEqual(self.save(client, title="No puede escribir").status_code, 403)
        self.assertEqual(client.post(self.collection, {**self.input, "client_id": str(uuid.uuid4())}, format="json").status_code, 403)
        rule.delete()
        self.assertEqual(client.get(self.detail).status_code, 404)

    def test_configurable_page_permissions_do_not_change_channel_permissions(self):
        self.deny("slack.page.update")
        self.assertEqual(self.save(title="No").status_code, 403)
        self.assertEqual(self.client.get(self.url).status_code, 200)
        self.assertFalse(self.client.get(self.detail).data["can_edit"])
        self.deny("slack.page.read")
        self.assertEqual(self.client.get(self.detail).status_code, 403)
        self.assertEqual(self.client.get(self.url).status_code, 200)

    def test_bounded_blocks_strict_schema_and_plain_text(self):
        bad = [[{"id": str(uuid.uuid4()), "type": "html", "text": "<script>"}], self.blocks("x"*4001),
               self.blocks("x")*2, self.blocks("x")*201, [{"id": "bad", "type": "paragraph"}],
               [{"id": str(uuid.uuid4()), "type": "paragraph", "html": "<script>"}],
               [{"id": str(uuid.uuid4()), "type": "check", "checked": "true"}]]
        for blocks in bad:
            self.assertEqual(self.save(blocks=blocks).status_code, 400, blocks)
        safe = self.save(blocks=self.blocks("<img src=x onerror=alert(1)> https://bold.gt"))
        self.assertEqual(safe.status_code, 200)
        self.assertIn("<img", safe.data["blocks"][0]["text"])

    def test_task_references_are_dynamic_not_a_permission_grant_even_in_history(self):
        JobRolePermission.objects.create(job_role=self.role, permission=Permission.objects.get(code="tasks.task.read"), effect="allow", scope_type="own_unit")
        status = TaskStatus.objects.create(unit=self.it, name="Pendiente", category="todo", position=1)
        task = Task.objects.create(unit=self.it, title="Detalle secreto", status=status, created_by_assignment=self.alice)
        block = {"id": str(uuid.uuid4()), "type": "task", "task_id": str(task.pk)}
        self.assertEqual(self.save(blocks=[block]).status_code, 200)
        bob = self.as_person(self.bob)
        hidden = bob.get(self.detail).data
        self.assertEqual(hidden["blocks"], [{"id": block["id"], "type": "task", "task": {"available": False}}])
        self.assertNotIn(task.title, str(bob.get(self.detail+"history/2/").data))
        preserved = self.save(bob, title="Notas generales", version=2, blocks=[{"id":block["id"], "type":"task"}])
        self.assertEqual(preserved.status_code, 200, preserved.data)
        self.assertEqual(ChannelPage.objects.get(pk=self.page["id"]).blocks, [block])
        self.assertEqual(self.save(bob, version=3, title="Otro acuerdo", blocks=[block]).status_code, 200)
        self.assertEqual(self.save(bob, version=4, blocks=[{**block, "id": str(uuid.uuid4())}]).status_code, 404)

    def test_page_task_picker_uses_page_permission_not_message_write(self):
        self.deny("slack.message.create")
        self.assertEqual(self.client.get(self.url+"tasks/?q=ab").status_code, 403)
        self.assertEqual(self.client.get(self.url+"tasks/?q=ab&purpose=page").status_code, 200)
        self.deny("slack.page.update")
        self.assertEqual(self.client.get(self.url+"tasks/?q=ab&purpose=page").status_code, 403)

    def test_share_same_channel_only_dynamic_title_and_no_unread_on_page_save(self):
        self.save(title="Título nuevo")
        channel = DepartmentChannel.objects.get(pk=self.channel_id)
        self.assertEqual(channel.activity_version, 0)
        shared = self.send("", page_id=self.page["id"])
        self.assertEqual(shared.status_code, 201, shared.data)
        self.assertEqual(shared.data["message"]["page"]["title"], "Título nuevo")
        second = self.client.post(self.root, {"unit_id":str(self.it.pk), "name":"Otro"}, format="json").data["id"]
        result = self.client.post(self.root+second+"/messages/", {"client_id":str(uuid.uuid4()), "body":"", "page_id":self.page["id"]}, format="json")
        self.assertEqual(result.status_code, 404)
        self.assertEqual(ChannelMessage.objects.count(), 1)
        self.deny("slack.page.read")
        card = self.client.get(self.url+"messages/").data["results"][0]["page"]
        self.assertEqual(card, {"available":False})

    def test_archived_channel_and_mfa_and_pilot_are_not_bypassed(self):
        permission = Permission.objects.get(code="slack.page.update")
        permission.requires_step_up_mfa = True
        permission.save()
        self.assertEqual(self.save(title="No").status_code, 403)
        permission.requires_step_up_mfa = False
        permission.save()
        DepartmentChannel.objects.filter(pk=self.channel_id).update(archived_at=timezone.now())
        self.assertEqual(self.save(title="No").status_code, 409)
        with override_settings(MESSAGING_PILOT_ENABLED=True):
            self.assertEqual(self.as_person(self.bob).get(self.detail).status_code, 403)

    def test_pages_responses_are_private_no_store(self):
        response = self.client.get(self.detail)
        self.assertIn("no-store", response["Cache-Control"])
        self.assertNotIn("blocks", self.client.get(self.collection).data["results"][0])
