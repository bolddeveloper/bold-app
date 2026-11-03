import uuid

from django.test import TestCase, override_settings

from . import test_channels as base
from .models import ChannelAccessRule, ChannelMessage, ChannelReadState, ChannelThreadReadState, DepartmentChannel


@override_settings(MESSAGING_PILOT_ENABLED=False)
class ChannelCollectionsTests(TestCase):
    root = base.DepartmentChannelTests.root
    setUp = base.DepartmentChannelTests.setUp
    identity = base.DepartmentChannelTests.identity
    as_person = base.DepartmentChannelTests.as_person
    send = base.DepartmentChannelTests.send
    deny = base.DepartmentChannelTests.deny

    def start(self, message, title="Revisión"):
        return self.client.put(self.url + f"messages/{message['id']}/thread/", {"title": title}, format="json")

    def pin(self, message, pinned=True):
        return self.client.put(self.url + f"messages/{message['id']}/pin/", {"pinned": pinned}, format="json")

    def test_thread_creation_retries_legacy_threads_and_channel_scoping(self):
        source = self.send("Mensaje original").data["message"]
        self.assertEqual(self.client.get(self.url + "threads/").data["results"], [])
        started = self.start(source)
        self.assertEqual(started.status_code, 200, started.data)
        self.assertEqual(started.data["message"]["thread_title"], "Revisión")
        self.assertEqual(started.data["message"]["thread_starter_name"], self.alice.employee.full_name)
        again = self.start(source, "Otro nombre")
        self.assertEqual(again.data["message"]["thread_title"], "Revisión")
        self.assertEqual(again.data["message"]["version"], started.data["message"]["version"])
        reply = self.send("Respuesta", parent_id=source["id"]).data["message"]
        self.assertEqual(self.start(reply).status_code, 404)
        self.assertEqual(len(self.client.get(self.url + "threads/?q=Revi").data["results"]), 1)
        self.assertEqual(self.client.get(self.url + "threads/?q=inexistente").data["results"], [])
        # Existing threads remain discoverable without a data rewrite.
        ChannelMessage.objects.filter(pk=source["id"]).update(thread_started_at=None, thread_starter=None, thread_title="")
        self.assertEqual(len(self.client.get(self.url + "threads/").data["results"]), 1)
        other = self.client.post(self.root, {"name": "Otro canal"}, format="json").data["id"]
        self.assertEqual(self.client.get(self.root + other + "/threads/").data["results"], [])
        self.assertEqual(self.client.put(self.root + other + f"/messages/{source['id']}/thread/", {}, format="json").status_code, 404)
        self.assertFalse(ChannelReadState.objects.exists())
        self.assertFalse(ChannelThreadReadState.objects.exists())

    def test_named_new_thread_uses_existing_send_idempotency(self):
        token = str(uuid.uuid4())
        first = self.send("Plan semanal", thread_title="Plan semanal", client_id=token)
        again = self.send("Plan semanal", thread_title="Plan semanal", client_id=token)
        self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual(again.data["message"]["id"], first.data["message"]["id"])
        self.assertEqual(ChannelMessage.objects.count(), 1)
        self.assertTrue(first.data["message"]["thread_started_at"])
        self.assertEqual(self.send("Plan semanal", thread_title="Cambio", client_id=token).status_code, 409)
        self.assertEqual(self.send("Respuesta", thread_title="No anidado", parent_id=first.data["message"]["id"]).status_code, 400)
        self.assertEqual(self.send("Nombre largo", thread_title="x" * 121).status_code, 400)

    def test_channel_pins_are_shared_idempotent_and_support_replies(self):
        source = self.send().data["message"]
        reply = self.send("Dentro del hilo", parent_id=source["id"]).data["message"]
        pinned = self.pin(reply)
        self.assertEqual(pinned.status_code, 200, pinned.data)
        self.assertTrue(pinned.data["message"]["pinned_at"])
        self.assertEqual(self.pin(reply).data["message"]["version"], pinned.data["message"]["version"])
        bob = self.as_person(self.bob)
        result = bob.get(self.url + "pins/")
        self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual(result.data["results"][0]["id"], reply["id"])
        self.assertEqual(result.data["results"][0]["parent_id"], source["id"])
        self.assertIn("no-store", result["Cache-Control"])
        self.pin(reply, False)
        self.assertEqual(bob.get(self.url + "pins/").data["results"], [])

    def test_pins_belong_to_each_channel_and_all_its_readers_see_them(self):
        first = self.send("Fijado del primer canal").data["message"]
        self.assertEqual(self.pin(first).status_code, 200)
        other = self.client.post(self.root, {"name": "Segundo canal", "unit_id": str(self.it.pk)}, format="json").data["id"]
        other_url = self.root + other + "/"
        second = self.client.post(other_url + "messages/", {"body": "Fijado del segundo canal", "client_id": str(uuid.uuid4())}, format="json").data["message"]
        self.assertEqual(self.client.put(other_url + f"messages/{second['id']}/pin/", {"pinned": True}, format="json").status_code, 200)
        ChannelAccessRule.objects.create(channel_id=self.channel_id, employee=self.bob.employee, access="read")
        for assignment in (self.alice, self.bob, self.owner):
            client = self.as_person(assignment)
            for url, expected in ((self.url, first), (other_url, second)):
                result = client.get(url + "pins/")
                self.assertEqual(result.status_code, 200, result.data)
                self.assertEqual([row["id"] for row in result.data["results"]], [expected["id"]])
        self.assertEqual(self.client.put(other_url + f"messages/{first['id']}/pin/", {"pinned": False}, format="json").status_code, 404)
        self.assertEqual(self.client.put(self.url + f"messages/{second['id']}/pin/", {"pinned": False}, format="json").status_code, 404)
        self.assertEqual(ChannelMessage.objects.filter(pinned_at__isnull=False).count(), 2)

    def test_privacy_revocation_read_only_and_archived_guards(self):
        source = self.send().data["message"]
        self.start(source)
        self.pin(source)
        DepartmentChannel.objects.filter(pk=self.channel_id).update(visibility="private")
        ChannelAccessRule.objects.create(channel_id=self.channel_id, employee=self.alice.employee, access="write")
        for assignment in (self.bob, self.owner):
            client = self.as_person(assignment)
            for endpoint in ("threads/", "pins/"):
                self.assertEqual(client.get(self.url + endpoint).status_code, 404)
        rule = ChannelAccessRule.objects.create(channel_id=self.channel_id, employee=self.bob.employee, access="read")
        self.client = self.as_person(self.bob)
        self.assertEqual(self.client.get(self.url + "pins/").status_code, 200)
        self.assertEqual(self.pin(source, False).status_code, 403)
        self.assertEqual(self.start(source).status_code, 403)
        rule.delete()
        self.assertEqual(self.client.get(self.url + "threads/").status_code, 404)
        self.client = self.as_person(self.alice)
        DepartmentChannel.objects.filter(pk=self.channel_id).update(archived_at=source["created_at"])
        self.assertEqual(self.client.get(self.url + "threads/").status_code, 200)
        self.assertEqual(self.pin(source, False).status_code, 409)
        self.assertEqual(self.start(source).status_code, 409)

    def test_pin_permission_and_limit_preserve_existing_data(self):
        source = self.send().data["message"]
        self.deny("slack.channel.manage")
        self.assertEqual(self.pin(source).status_code, 403)
        from boldApp.core.models import JobRolePermission
        JobRolePermission.objects.filter(job_role=self.role).delete()
        original = ChannelMessage.objects.get(pk=source["id"])
        from django.utils import timezone
        for sequence in range(2, 52):
            ChannelMessage.objects.create(channel=original.channel, author=original.author, author_assignment=original.author_assignment,
                department_name=original.department_name, department_color=original.department_color,
                body="Conservar", client_id=uuid.uuid4(), sequence=sequence, payload_digest="x" * 64, pinned_at=timezone.now(), pinned_by=original.author)
        self.assertEqual(self.pin(source).status_code, 400)
        self.assertEqual(ChannelMessage.objects.count(), 51)
        self.assertEqual(len(self.client.get(self.url + "pins/").data["results"]), 50)
