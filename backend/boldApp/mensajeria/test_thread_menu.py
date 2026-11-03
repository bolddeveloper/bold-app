import uuid
from datetime import timedelta

from django.test import TestCase, override_settings
from django.utils import timezone
from boldApp.notificaciones.models import Notification
from . import test_channels as base
from .models import ChannelAccessRule, ChannelMessage, ChannelReadState, ChannelThreadReadState, ChannelThreadSubscription, DepartmentChannel, ReadingReminder
from .channel_notifications import notification_channel_readable


@override_settings(MESSAGING_PILOT_ENABLED=False)
class ThreadMenuTests(TestCase):
    root = base.DepartmentChannelTests.root
    setUp = base.DepartmentChannelTests.setUp
    identity = base.DepartmentChannelTests.identity
    as_person = base.DepartmentChannelTests.as_person
    send = base.DepartmentChannelTests.send
    deny = base.DepartmentChannelTests.deny

    def source(self):
        return self.send("Plan del equipo", thread_title="Plan del equipo").data["message"]

    def endpoint(self, message, suffix):
        return self.url + f"messages/{message['id']}/{suffix}/"

    def manage(self, message, action, client=None, **values):
        return (client or self.client).patch(self.endpoint(message, "thread-settings"), {"action": action, "version": message["version"], **values}, format="json")

    def preference(self, message, client=None, version=0, **values):
        return (client or self.client).put(self.endpoint(message, "thread-preferences"), {"version": version, "client_id": str(uuid.uuid4()), **values}, format="json")

    def test_lifecycle_preserves_history_blocks_replies_and_reconciles_old_send(self):
        parent = self.source()
        token = str(uuid.uuid4())
        reply = self.send("Respuesta confirmada", parent_id=parent["id"], client_id=token).data["message"]
        closed = self.manage(parent, "close")
        self.assertEqual(closed.status_code, 200, closed.data)
        self.assertFalse(closed.data["message"]["can_reply_thread"])
        self.assertEqual(self.manage(parent, "close").data["message"]["version"], closed.data["message"]["version"])
        self.assertEqual(self.send("Respuesta confirmada", parent_id=parent["id"], client_id=token).status_code, 200)
        self.assertEqual(self.send("Otra respuesta", parent_id=parent["id"]).status_code, 409)
        edit = self.client.patch(self.endpoint(reply, "").rstrip("/") + "/", {"body": "Cambio", "version": reply["version"]}, format="json")
        self.assertEqual(edit.status_code, 409)
        reactions = self.endpoint(reply, "reactions")
        self.assertFalse(self.client.get(reactions).data["can_change"])
        self.assertEqual(self.client.put(reactions, {"key": "thumbs_up", "active": True, "version": 0, "client_id": str(uuid.uuid4())}, format="json").status_code, 403)
        locked = self.manage(closed.data["message"], "lock").data["message"]
        self.assertEqual(self.manage(locked, "open").status_code, 409)
        unlocked = self.manage(locked, "unlock").data["message"]
        opened = self.manage(unlocked, "open").data["message"]
        self.assertTrue(opened["can_reply_thread"])
        deleted = self.manage(opened, "delete").data["message"]
        self.assertTrue(deleted["thread_deleted_at"])
        self.assertEqual(self.manage(opened, "delete").data["message"]["version"], deleted["version"])
        self.assertEqual(self.client.get(self.url + "threads/").data["results"], [])
        self.assertEqual(self.client.get(self.url + "threads/?state=deleted").data["results"][0]["id"], parent["id"])
        self.assertEqual(len(self.client.get(self.url + f"messages/?parent={parent['id']}").data["results"]), 1)
        self.assertEqual(ChannelMessage.objects.count(), 2)
        restored = self.manage(deleted, "restore").data["message"]
        self.assertTrue(restored["thread_closed_at"])
        self.assertEqual(self.client.get(self.url + "threads/?state=closed").data["results"][0]["id"], parent["id"])

    def test_version_conflict_title_validation_and_source_unchanged(self):
        source = self.source()
        result = self.manage(source, "rename", title="Nuevo nombre")
        self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual(result.data["message"]["body"], source["body"])
        self.assertEqual(self.manage(source, "rename", title="Versión antigua").status_code, 409)
        for title in ("", "x" * 121):
            self.assertEqual(self.manage(result.data["message"], "rename", title=title).status_code, 400)

    def test_manage_permissions_read_only_private_and_archived(self):
        source = self.source()
        self.deny("slack.channel.manage")
        bob = self.as_person(self.bob)
        for action in ("lock", "delete", "restore"):
            self.assertEqual(self.manage(source, action, bob).status_code, 403)
        self.assertEqual(self.manage(source, "rename", bob, title="No autorizado").status_code, 403)
        self.assertEqual(self.manage(source, "close", bob).status_code, 200)
        DepartmentChannel.objects.filter(pk=self.channel_id).update(visibility="private")
        self.assertEqual(self.preference(source, bob, favorite=True).status_code, 404)
        ChannelAccessRule.objects.create(channel_id=self.channel_id, employee=self.bob.employee, access="read")
        self.assertEqual(self.manage(source, "close", bob).status_code, 403)
        self.assertEqual(self.preference(source, bob, favorite=True).status_code, 200)
        DepartmentChannel.objects.filter(pk=self.channel_id).update(archived_at=timezone.now())
        self.assertEqual(self.manage(source, "rename", bob, title="Archivado").status_code, 403)

    def test_personal_preferences_nonce_conflict_and_catalog(self):
        source = self.source()
        bob = self.as_person(self.bob)
        body = {"version": 0, "client_id": str(uuid.uuid4()), "favorite": True, "mute": "1h"}
        first = bob.put(self.endpoint(source, "thread-preferences"), body, format="json")
        self.assertEqual(first.status_code, 200, first.data)
        again = bob.put(self.endpoint(source, "thread-preferences"), body, format="json")
        self.assertEqual(first.data, again.data)
        altered = bob.put(self.endpoint(source, "thread-preferences"), {**body, "favorite": False}, format="json")
        self.assertEqual(altered.status_code, 409)
        self.assertEqual(self.preference(source, bob, favorite=False).status_code, 409)
        self.assertEqual(len(bob.get(self.url + "threads/?favorite=true").data["results"]), 1)
        self.assertEqual(self.client.get(self.url + "threads/?favorite=true").data["results"], [])
        self.assertFalse(self.client.get(self.endpoint(source, "following")).data["favorite"])
        self.assertEqual(self.client.get(self.url + "threads/?state=bad").status_code, 400)

    def test_notifications_modes_mute_expiry_leave_and_rejoin(self):
        source = self.source()
        bob = self.as_person(self.bob)
        bob.put(self.url + "following/", {"following": True}, format="json")
        state = self.preference(source, bob, notifications="none").data
        self.send("Sin aviso", parent_id=source["id"])
        self.assertFalse(Notification.objects.exists())
        state = self.preference(source, bob, version=state["state_version"], notifications="all").data
        self.send("Aviso normal", parent_id=source["id"])
        notice = Notification.objects.get()
        self.assertTrue(notification_channel_readable(self.bob, notice, push=True))
        state = self.preference(source, bob, version=state["state_version"], mute="15m").data
        self.assertFalse(notification_channel_readable(self.bob, notice, push=True))
        self.send("Silenciado", parent_id=source["id"])
        self.assertEqual(Notification.objects.count(), 1)
        ChannelThreadSubscription.objects.filter(parent_id=source["id"], employee=self.bob.employee).update(muted_until=timezone.now()-timedelta(seconds=1))
        self.assertTrue(notification_channel_readable(self.bob, notice, push=True))
        state = self.preference(source, bob, version=state["state_version"], left=True).data
        self.assertFalse(state["following"])
        self.assertFalse(notification_channel_readable(self.bob, notice, push=True))
        self.send("Abandonado", parent_id=source["id"])
        self.assertEqual(Notification.objects.count(), 1)
        bob.put(self.endpoint(source, "following"), {"following": True}, format="json")
        self.assertFalse(bob.get(self.endpoint(source, "following")).data["left"])
        state = bob.get(self.endpoint(source, "following")).data
        self.preference(source, bob, version=state["state_version"], notifications="mentions")
        self.send("Solo menciones", parent_id=source["id"])
        self.assertEqual(Notification.objects.count(), 1)

    def test_mark_thread_read_never_reads_root_or_another_thread(self):
        source, other = self.source(), self.source()
        self.send("Primera respuesta", parent_id=source["id"])
        self.send("Otro hilo pendiente", parent_id=other["id"])
        bob = self.as_person(self.bob)
        response = bob.post(self.endpoint(source, "thread-read"), {}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["message"]["unread_reply_count"], 0)
        self.assertFalse(ChannelReadState.objects.exists())
        self.assertEqual(ChannelThreadReadState.objects.filter(employee=self.bob.employee).count(), 1)
        catalog = bob.get(self.url + "threads/").data["results"]
        self.assertEqual(next(row for row in catalog if row["id"] == other["id"])["unread_reply_count"], 1)
        reply = self.send("Nueva respuesta", parent_id=source["id"]).data["message"]
        self.assertEqual(bob.post(self.endpoint(reply, "thread-read"), {}, format="json").status_code, 404)

    def test_thread_read_clears_only_its_manual_reminder(self):
        source = self.source()
        reply = self.send("Para revisar", parent_id=source["id"]).data["message"]
        bob = self.as_person(self.bob)
        endpoint = "/api/v2/messaging/reading-reminders/"
        marked = bob.put(endpoint, {"kind": "channel", "source_id": reply["id"], "version": 0, "client_id": str(uuid.uuid4())}, format="json")
        self.assertEqual(marked.status_code, 200, marked.data)
        self.assertTrue(ReadingReminder.objects.get(pk=marked.data["id"]).document_id)
        response = bob.post(self.endpoint(source, "thread-read"), {}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIsNone(ReadingReminder.objects.get(pk=marked.data["id"]).document_id)

    def test_thread_preferences_control_mentions_without_muting_root_channel(self):
        source = self.source()
        bob = self.as_person(self.bob)
        token = "@" + self.bob.employee.user_account.email
        state = self.preference(source, bob, notifications="mentions").data
        self.send("Mención " + token, parent_id=source["id"])
        self.assertEqual(Notification.objects.get().type, "slack.mentioned")
        state = self.preference(source, bob, version=state["state_version"], mute="forever").data
        self.send("Mención silenciada " + token, parent_id=source["id"])
        self.assertEqual(Notification.objects.count(), 1)
        state = self.preference(source, bob, version=state["state_version"], mute="off", notifications="none").data
        self.send("Mención desactivada " + token, parent_id=source["id"])
        self.assertEqual(Notification.objects.count(), 1)
        self.send("Mención del canal " + token)
        self.assertEqual(Notification.objects.count(), 2)
        state = self.preference(source, bob, version=state["state_version"], left=True).data
        joined = self.preference(source, bob, version=state["state_version"], left=False).data
        self.assertTrue(joined["following"])
        self.assertFalse(joined["left"])

    def test_closing_a_prepared_thread_keeps_it_discoverable(self):
        source = self.send("Mensaje sin respuestas").data["message"]
        closed = self.manage(source, "close")
        self.assertEqual(closed.status_code, 200, closed.data)
        self.assertTrue(closed.data["message"]["thread_started_at"])
        self.assertEqual(self.client.get(self.url + "threads/?state=closed").data["results"][0]["id"], source["id"])
