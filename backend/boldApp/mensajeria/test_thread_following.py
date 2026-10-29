import uuid
from unittest.mock import patch

from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from boldApp.notificaciones.models import Notification
from boldApp.notificaciones.consumers import notification_resource_is_readable
from . import test_channels as base
from .models import ChannelAccessRule, ChannelReadState, ChannelSubscription, ChannelThreadReadState, ChannelThreadSubscription, DepartmentChannel
from .thread_following import thread_states

resource_is_readable = notification_resource_is_readable.__wrapped__


@override_settings(MESSAGING_PILOT_ENABLED=False)
class ThreadFollowingTests(TestCase):
    root = base.DepartmentChannelTests.root
    setUp = base.DepartmentChannelTests.setUp
    identity = base.DepartmentChannelTests.identity
    as_person = base.DepartmentChannelTests.as_person
    send = base.DepartmentChannelTests.send

    def endpoint(self, parent):
        return self.url + f"messages/{parent['id']}/following/"

    def follow(self, client, parent, following=True):
        return client.put(self.endpoint(parent), {"following": following}, format="json")

    def test_explicit_personal_idempotent_opt_in_and_no_read_side_effect(self):
        parent = self.send("Raíz del hilo").data["message"]
        bob = self.as_person(self.bob)
        self.assertFalse(bob.get(self.endpoint(parent)).data["following"])
        self.assertEqual(self.follow(bob, parent, False).data["state_version"], 0)
        self.assertFalse(ChannelThreadSubscription.objects.exists())
        for _ in range(2):
            response = self.follow(bob, parent)
            self.assertEqual(response.status_code, 200, response.data)
            self.assertEqual(response.data["state_version"], 1)
            self.assertIn("no-store", response["Cache-Control"])
        self.assertFalse(self.client.get(self.endpoint(parent)).data["following"])
        self.assertFalse(ChannelReadState.objects.exists())
        self.assertFalse(ChannelThreadReadState.objects.exists())
        self.assertFalse(ChannelSubscription.objects.exists())
        other_assignment = self.identity("alternate", self.it)
        other_assignment.employee = self.bob.employee
        other_assignment.save()
        self.assertTrue(self.as_person(other_assignment).get(self.endpoint(parent)).data["following"])

    def test_only_that_thread_notifies_without_duplicate_channel_notices(self):
        parent = self.send("Reservado raíz").data["message"]
        bob = self.as_person(self.bob)
        self.follow(bob, parent)
        other = self.send("Otro hilo").data["message"]
        self.send("Otra respuesta", parent_id=other["id"])
        self.assertFalse(Notification.objects.exists())
        token = str(uuid.uuid4())
        self.send("Contenido confidencial", parent_id=parent["id"], client_id=token)
        notice = Notification.objects.get()
        self.assertEqual(notice.recipient_assignment_id, self.bob.pk)
        self.assertNotIn("confidencial", notice.title + notice.body)
        self.assertEqual(notice.route["parent_id"], parent["id"])
        self.assertTrue(resource_is_readable(str(self.bob.pk), str(notice.pk)))
        self.send("Contenido confidencial", parent_id=parent["id"], client_id=token)
        self.assertEqual(Notification.objects.count(), 1)
        bob.put(self.url + "following/", {"following": True}, format="json")
        self.send("Seguido de dos formas", parent_id=parent["id"])
        self.assertEqual(Notification.objects.count(), 2)
        self.client = bob
        self.send("Mi respuesta", parent_id=parent["id"])
        self.assertEqual(Notification.objects.count(), 2)
        self.assertEqual(ChannelThreadSubscription.objects.count(), 1)

    def test_unfollowing_each_scope_preserves_the_other_and_unread(self):
        parent = self.send().data["message"]
        bob = self.as_person(self.bob)
        self.follow(bob, parent)
        bob.put(self.url + "following/", {"following": True}, format="json")
        self.send("Respuesta seguida", parent_id=parent["id"])
        reply_notice = Notification.objects.get()
        self.send("Raíz solo por canal")
        bob.put(self.url + "following/", {"following": False}, format="json")
        reply_notice.refresh_from_db()
        self.assertFalse(reply_notice.is_read)
        self.assertEqual(Notification.objects.filter(is_read=False).count(), 1)
        self.assertTrue(resource_is_readable(str(self.bob.pk), str(reply_notice.pk)))
        count = bob.get(self.root + "unread/").data["total"]
        self.follow(bob, parent, False)
        reply_notice.refresh_from_db()
        self.assertTrue(reply_notice.is_read)
        self.assertFalse(resource_is_readable(str(self.bob.pk), str(reply_notice.pk)))
        self.assertEqual(bob.get(self.root + "unread/").data["total"], count)
        self.send("No debe avisar", parent_id=parent["id"])
        self.assertEqual(Notification.objects.count(), 2)
        # A channel follow still opts in when the thread is unfollowed separately.
        self.follow(bob, parent)
        bob.put(self.url + "following/", {"following": True}, format="json")
        self.send("Canal todavía seguido", parent_id=parent["id"])
        active = Notification.objects.order_by("-created_at").first()
        self.follow(bob, parent, False)
        active.refresh_from_db()
        self.assertFalse(active.is_read)
        self.assertTrue(resource_is_readable(str(self.bob.pk), str(active.pk)))

    def test_private_invitation_revocation_and_no_owner_override(self):
        parent = self.send().data["message"]
        DepartmentChannel.objects.filter(pk=self.channel_id).update(visibility="private")
        ChannelAccessRule.objects.create(channel_id=self.channel_id, employee=self.alice.employee, access="write")
        bob = self.as_person(self.bob)
        self.assertEqual(self.follow(bob, parent).status_code, 404)
        self.assertEqual(self.follow(self.as_person(self.owner), parent).status_code, 404)
        rule = ChannelAccessRule.objects.create(channel_id=self.channel_id, employee=self.bob.employee, access="read")
        self.assertEqual(self.follow(bob, parent).status_code, 200)
        self.assertEqual(self.send("Invitación vigente", parent_id=parent["id"]).status_code, 201)
        notice = Notification.objects.get()
        self.assertTrue(resource_is_readable(str(self.bob.pk), str(notice.pk)))
        rule.access = "blocked"
        rule.save()
        self.assertEqual(bob.get(self.endpoint(parent)).status_code, 404)
        self.assertFalse(resource_is_readable(str(self.bob.pk), str(notice.pk)))
        self.assertEqual(bob.get("/api/v2/notifications/").data["results"], [])
        self.assertEqual(self.send("Invitación revocada", parent_id=parent["id"]).status_code, 201)
        self.assertEqual(Notification.objects.count(), 1)

    def test_preferences_still_mute_an_explicit_thread(self):
        parent = self.send().data["message"]
        self.follow(self.as_person(self.bob), parent)
        account = self.bob.employee.user_account
        account.notification_settings = {"events": {"slack.message_created": False}}
        account.save()
        self.send(parent_id=parent["id"])
        self.assertFalse(Notification.objects.exists())

    def test_only_roots_in_that_channel_strict_inputs_and_pilot(self):
        parent = self.send().data["message"]
        reply = self.send(parent_id=parent["id"]).data["message"]
        self.assertEqual(self.follow(self.client, reply).status_code, 404)
        other = DepartmentChannel.objects.create(unit=self.it, name="Otro", creator=self.alice)
        self.assertEqual(self.client.put(self.root + f"{other.pk}/messages/{parent['id']}/following/", {"following": True}, format="json").status_code, 404)
        self.assertEqual(self.client.put(self.endpoint(parent), {"following": True, "employee_id": str(self.bob.employee_id)}, format="json").status_code, 400)
        self.assertEqual(APIClient().get(self.endpoint(parent)).status_code, 401)
        with self.settings(MESSAGING_PILOT_ENABLED=True, MESSAGING_PILOT_UNIT_IDS=(str(self.it.pk),)):
            self.assertEqual(self.follow(self.as_person(self.owner), parent).status_code, 403)
        from boldApp.core.models import Permission
        permission = Permission.objects.get(code="slack.channel.read")
        permission.requires_step_up_mfa = True
        permission.save()
        self.assertEqual(self.client.get(self.endpoint(parent)).status_code, 404)
        self.assertEqual(self.follow(self.client, parent).status_code, 404)

    def test_limit_monotonic_revisions_and_batched_personal_projection(self):
        first = self.send().data["message"]
        second = self.send().data["message"]
        bob = self.as_person(self.bob)
        with patch("boldApp.mensajeria.thread_views.MAX_FOLLOWED_THREADS", 1):
            self.assertEqual(self.follow(bob, first).status_code, 200)
            self.assertEqual(self.follow(bob, first).data["state_version"], 1)
            self.assertEqual(self.follow(bob, second).status_code, 400)
            self.assertEqual(self.follow(bob, first, False).data["state_version"], 2)
            self.assertEqual(self.follow(bob, second).status_code, 200)
        own = bob.get(self.url + "messages/").data["results"]
        self.assertTrue(next(row for row in own if row["id"] == second["id"])["thread_following"])
        peer = self.client.get(self.url + "messages/").data["results"]
        self.assertFalse(any(row["thread_following"] for row in peer))
        thread = bob.get(self.url + "messages/", {"parent": second["id"]}).data["thread"]
        self.assertTrue(thread["following"])
        with self.assertNumQueries(1):
            states = thread_states([first["id"], second["id"]], self.bob.employee_id)
        self.assertFalse(states[first["id"]]["following"])
        self.assertTrue(states[second["id"]]["following"])

    def test_personal_hint_is_only_sent_to_the_own_employee_group(self):
        parent = self.send().data["message"]
        with patch("boldApp.mensajeria.channel_events.get_channel_layer") as layer, self.captureOnCommitCallbacks(execute=True):
            async def send(group, event):
                self.assertEqual(group, f"messaging_employee_{self.bob.employee_id}")
                self.assertEqual(event["kind"], "thread.state.changed")
                self.assertNotIn("body", event)
            layer.return_value.group_send = send
            self.assertEqual(self.follow(self.as_person(self.bob), parent).status_code, 200)

    def test_followed_thread_search_is_full_history_personal_and_acl_filtered(self):
        from .test_history_search import HistorySearchTests
        self.channel_message = HistorySearchTests.channel_message.__get__(self)
        parent = self.send("Aurora: hilo inicial").data["message"]
        self.send("Texto distinto de una respuesta", parent_id=parent["id"])
        for index in range(60):
            self.channel_message(f"Mensaje posterior {index}")
        bob = self.as_person(self.bob)
        endpoint = "/api/v2/messaging/search/"
        filters = {"scope": "slack", "threads": "true"}
        self.assertEqual(bob.get(endpoint, filters).data["results"], [])
        self.follow(bob, parent)
        result = bob.get(endpoint, filters)
        self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual([row["source_id"] for row in result.data["results"]], [parent["id"]])
        self.assertEqual(self.client.get(endpoint, filters).data["results"], [])
        self.assertEqual(bob.get(endpoint, {**filters, "q": "respuesta"}).data["results"], [], "the list searches roots, not hidden reply bodies")
        self.assertEqual(bob.get(endpoint, {**filters, "q": "aurora"}).data["results"][0]["source_id"], parent["id"])
        self.assertEqual(bob.get(endpoint, {**filters, "scope": "chat"}).status_code, 400)
        self.assertEqual(bob.get(endpoint, {**filters, "kind": "page"}).status_code, 400)
        DepartmentChannel.objects.filter(pk=self.channel_id).update(visibility="private")
        rule = ChannelAccessRule.objects.create(channel_id=self.channel_id, employee=self.bob.employee, access="read")
        self.assertEqual(len(bob.get(endpoint, filters).data["results"]), 1)
        rule.access = "blocked"
        rule.save()
        self.assertEqual(bob.get(endpoint, filters).data["results"], [])

    def test_followed_search_paginates_and_binds_the_personal_filter(self):
        from .test_history_search import HistorySearchTests
        self.channel_message = HistorySearchTests.channel_message.__get__(self)
        bob = self.as_person(self.bob)
        for index in range(26):
            parent = self.channel_message(f"Hilo seguido {index}")
            self.assertEqual(self.follow(bob, {"id": str(parent.pk)}).status_code, 200)
        endpoint = "/api/v2/messaging/search/"
        values = {"scope": "slack", "threads": "true"}
        first = bob.get(endpoint, values).data
        second = bob.get(endpoint, {**values, "cursor": first["next_cursor"]}).data
        self.assertEqual((len(first["results"]), len(second["results"])), (20, 6))
        self.assertFalse({row["id"] for row in first["results"]} & {row["id"] for row in second["results"]})
        self.assertEqual(bob.get(endpoint, {**values, "threads": "false", "cursor": first["next_cursor"]}).status_code, 400)
