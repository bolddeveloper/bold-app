import uuid
from unittest.mock import patch

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from . import test_history_search as history
from . import test_pages as fixtures
from .models import ChannelAccessRule, ChannelPage, DepartmentChannel, DirectConversation, SavedItem, SearchDocument


@override_settings(MESSAGING_PILOT_ENABLED=False)
class SavedItemTests(TestCase):
    root = fixtures.ChannelPageTests.root
    identity = fixtures.ChannelPageTests.identity
    as_person = fixtures.ChannelPageTests.as_person
    blocks = fixtures.ChannelPageTests.blocks
    deny = fixtures.ChannelPageTests.deny
    direct = history.HistorySearchTests.direct
    channel_message = history.HistorySearchTests.channel_message
    endpoint = "/api/v2/messaging/saved-items/"

    def setUp(self):
        fixtures.ChannelPageTests.setUp(self)
        self.chat = DirectConversation.objects.create(**dict(zip(("first_employee_id", "second_employee_id"), sorted([self.alice.employee_id, self.bob.employee_id]))))

    def save_item(self, kind, source, client=None):
        return (client or self.client).put(self.endpoint, {"kind": kind, "source_id": str(source)}, format="json")

    def saved(self, client=None, **filters):
        result = (client or self.client).get("/api/v2/messaging/search/", {"saved": "true", **filters})
        self.assertEqual(result.status_code, 200, result.data)
        self.assertIn("no-store", result["Cache-Control"])
        return result.data["results"]

    def test_idempotent_personal_and_receipts_untouched(self):
        message = self.direct("Pendiente personal", author=self.bob.employee_id)
        for _ in range(2):
            result = self.save_item("chat", message.pk)
            self.assertEqual(result.status_code, 200, result.data)
            self.assertTrue(result.data["saved"])
        self.assertEqual(SavedItem.objects.count(), 1)
        rows = self.saved()
        self.assertEqual([row["source_id"] for row in rows], [str(message.pk)])
        self.assertTrue(rows[0]["saved"])
        self.assertEqual(self.saved(self.as_person(self.bob)), [])
        message.refresh_from_db()
        self.assertIsNone(message.read_at)
        self.assertIsNone(message.delivered_at)
        self.chat.refresh_from_db()
        self.assertEqual(self.chat.activity_version, 0)

    def test_owner_cannot_save_private_dm_or_guess_another_bookmark(self):
        message = self.direct("Solo dos participantes")
        self.assertEqual(self.save_item("chat", message.pk, self.as_person(self.owner)).status_code, 404)
        self.save_item("chat", message.pk)
        identity = message.search_document.pk
        owner = self.as_person(self.owner)
        self.assertEqual(owner.delete(self.endpoint + str(identity) + "/").status_code, 204)
        self.assertEqual(owner.delete(self.endpoint + str(uuid.uuid4()) + "/").status_code, 204)
        self.assertEqual(SavedItem.objects.count(), 1)
        self.assertEqual(self.client.delete(self.endpoint + str(identity) + "/").status_code, 204)
        self.assertEqual(self.client.delete(self.endpoint + str(identity) + "/").status_code, 204)
        self.assertEqual(self.saved(), [])

    def test_invitation_and_revocation_filter_before_snippet_or_cursor(self):
        message = self.channel_message("Reservado de la invitación")
        DepartmentChannel.objects.filter(pk=self.channel_id).update(visibility="private")
        bob = self.as_person(self.bob)
        self.assertEqual(self.save_item("channel", message.pk, bob).status_code, 404)
        rule = ChannelAccessRule.objects.create(channel_id=self.channel_id, employee=self.bob.employee, access="read")
        self.assertEqual(self.save_item("channel", message.pk, bob).status_code, 200)
        self.assertEqual(len(self.saved(bob)), 1)
        rule.access = "blocked"
        rule.save()
        self.assertEqual(self.saved(bob), [])
        self.assertEqual(self.save_item("channel", message.pk, bob).status_code, 404)
        # Hidden bookmark is not a copied private text or an implicit access grant.
        item = SavedItem.objects.get(employee=self.bob.employee)
        self.assertEqual(item.document_id, message.search_document.pk)
        self.assertEqual(bob.delete(self.endpoint + str(item.document_id) + "/").status_code, 204)

    def test_page_read_permission_and_archive_are_independent_of_saving(self):
        page = ChannelPage.objects.get(pk=self.page["id"])
        self.assertEqual(self.save_item("page", page.pk).status_code, 200)
        self.assertEqual(self.saved()[0]["source_id"], str(page.pk))
        # Bob can save an archived but readable page; default search still hides it.
        from django.utils import timezone
        page.archived_at = timezone.now()
        page.save()
        bob = self.as_person(self.bob)
        self.assertEqual(self.save_item("page", page.pk, bob).status_code, 200)
        self.assertEqual(self.saved(bob), [])
        self.assertEqual(len(self.saved(bob, archived="true")), 1)
        self.deny("slack.page.read")
        self.assertEqual(self.saved(archived="true"), [])
        self.assertEqual(self.save_item("page", page.pk).status_code, 404)

    def test_reference_tracks_edits_and_is_removed_with_source(self):
        message = self.direct("Texto inicial")
        self.save_item("chat", message.pk)
        message.body = "Texto actualizado"
        message.save()
        self.assertIn("actualizado", self.saved()[0]["snippet"])
        self.assertEqual(self.saved(q="inicial"), [])
        message_id = message.pk
        message.delete()
        self.assertFalse(SavedItem.objects.exists())
        self.assertFalse(SearchDocument.objects.filter(direct_id=message_id).exists())

    def test_strict_inputs_bound_and_retries_at_limit(self):
        first = self.direct("Primero")
        second = self.direct("Segundo")
        with patch("boldApp.mensajeria.personal_views.MAX_SAVED_ITEMS", 1):
            self.assertEqual(self.save_item("chat", first.pk).status_code, 200)
            self.assertEqual(self.save_item("chat", first.pk).status_code, 200)
            self.assertEqual(self.save_item("chat", second.pk).status_code, 400)
        self.assertEqual(self.save_item("channel", first.pk).status_code, 404)
        for body in ({"kind": "root", "source_id": str(first.pk)}, {"kind": "chat", "source_id": "bad"},
                     {"kind": "chat", "source_id": str(first.pk), "employee_id": str(self.bob.employee_id)}):
            self.assertEqual(self.client.put(self.endpoint, body, format="json").status_code, 400)
        self.assertEqual(APIClient().put(self.endpoint, {}, format="json").status_code, 401)
        self.assertEqual(self.client.get(self.endpoint).status_code, 405)
        with override_settings(MESSAGING_PILOT_ENABLED=True, MESSAGING_PILOT_UNIT_IDS=[]):
            self.assertEqual(self.save_item("chat", first.pk).status_code, 403)

    def test_live_presenters_are_personal_and_batch_the_indicator(self):
        from .personal_data import prime_saved, saved_data
        message = self.direct("Referencia propia")
        self.save_item("chat", message.pk)
        path = f"/api/v2/messaging/conversations/{self.chat.pk}/messages/"
        mine = self.client.get(path).data["results"][0]
        peer = self.as_person(self.bob).get(path).data["results"][0]
        self.assertTrue(mine["saved"])
        self.assertFalse(peer["saved"])
        self.assertEqual(mine["saved_document_id"], str(message.search_document.pk))
        sources = [message, *[self.direct(f"Historial {index}") for index in range(49)]]
        with self.assertNumQueries(1):
            prime_saved(sources, "direct", self.alice.employee_id)
            self.assertTrue(saved_data(message, "direct", self.alice.employee_id)["saved"])
        self.assertFalse(saved_data(message, "direct", self.bob.employee_id)["saved"])
        channel_message = self.channel_message("Guardar del canal")
        self.save_item("channel", channel_message.pk)
        rows = self.client.get(self.url + "messages/").data["results"]
        self.assertTrue(next(row for row in rows if row["id"] == str(channel_message.pk))["saved"])
        self.save_item("page", self.page["id"])
        self.assertTrue(self.client.get(self.detail).data["saved"])
