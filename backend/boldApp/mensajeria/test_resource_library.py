import importlib
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from boldApp.workspace.models import ImageStorageRoot
from . import test_history_search as fixtures
from .models import ChannelAccessRule, ChannelMedia, ChannelReadState, DepartmentChannel, DirectMessage, MessageMedia, SearchDocument
from .resource_links_v1 import resource_links


@override_settings(MESSAGING_PILOT_ENABLED=False)
class ResourceLibraryTests(TestCase):
    root = fixtures.HistorySearchTests.root
    identity = fixtures.HistorySearchTests.identity
    as_person = fixtures.HistorySearchTests.as_person
    blocks = fixtures.HistorySearchTests.blocks
    deny = fixtures.HistorySearchTests.deny
    send = fixtures.fixtures.ChannelPageTests.send
    direct = fixtures.HistorySearchTests.direct
    channel_message = fixtures.HistorySearchTests.channel_message

    def setUp(self):
        fixtures.HistorySearchTests.setUp(self)
        self.chat_url = f"/api/v2/messaging/conversations/{self.chat.pk}/library/"
        self.channel_url = self.url + "library/"

    def library(self, url=None, client=None, **filters):
        response = (client or self.client).get(url or self.chat_url, filters)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIn("no-store", response["Cache-Control"])
        return response.data

    def attach(self, message, model=MessageMedia, kind="image"):
        root, _ = ImageStorageRoot.objects.get_or_create(subject="resource-test", defaults={"user": self.alice.employee.user_account,
            "client_id": "synthetic", "google_email": "test@example.invalid", "folder_id": "private-root", "folder_name": "Test", "active": True})
        return model.objects.create(message=message, root=root, drive_id="NEVER-EXPOSE-THIS", kind=kind,
            mime_type="image/webp" if kind == "image" else "audio/webm", filename="Revisión_campaña.webp" if kind == "image" else "Grabación.webm",
            size_bytes=123, digest="a" * 64)

    def test_complete_history_excludes_plain_text_and_pages_and_never_contacts_drive(self):
        oldest = self.direct("Consultar https://bold.gt/proceso")
        for i in range(75):
            self.direct(f"Mensaje sin recurso {i}")
        with patch("boldApp.mensajeria.media.google", side_effect=AssertionError("no Drive listing")):
            result = self.library()
        self.assertEqual([r["source_id"] for r in result["results"]], [str(oldest.pk)])
        self.assertEqual(result["results"][0]["links"], [{"href": "https://bold.gt/proceso", "label": "https://bold.gt/proceso"}])
        self.assertFalse(DirectMessage.objects.filter(delivered_at__isnull=False).exists())
        self.assertFalse(DirectMessage.objects.filter(read_at__isnull=False).exists())
        self.assertEqual(ChannelReadState.objects.count(), 0)
        self.assertEqual(self.library(self.channel_url)["results"], [])

    def test_media_filters_author_dates_whole_words_and_metadata_only(self):
        image = self.direct("Campaña imagen https://bold.gt/campana")
        self.attach(image)
        audio = self.direct("Grabación de revisión", author=self.bob.employee_id)
        self.attach(audio, kind="audio")
        self.assertEqual(len(self.library(kind="file")["results"]), 2)
        self.assertEqual(len(self.library(kind="image")["results"]), 1)
        self.assertEqual(len(self.library(kind="audio", author=self.bob.employee_id, q="REVISION")["results"]), 1)
        self.assertEqual(len(self.library(q="revisi")["results"]), 0)
        self.assertEqual(len(self.library(after=(timezone.now()+timedelta(days=1)).isoformat())["results"]), 0)
        self.assertEqual(len(self.library(before=(timezone.now()-timedelta(days=1)).isoformat())["results"]), 0)
        data = self.library(kind="link")["results"]
        self.assertEqual(data[0]["media"]["filename"], "Revisión_campaña.webp")
        self.assertNotIn("drive_id", str(data))
        self.assertNotIn("NEVER-EXPOSE", str(data))

    def test_editing_updates_links_without_reordering_and_duplicates_stay_one_card(self):
        row = self.direct("www.bold.gt https://bold.gt/help https://bold.gt/help")
        doc = row.search_document
        self.assertEqual(len(self.library()["results"][0]["links"]), 2)
        row.body = "Ya no contiene enlaces"
        row.edited_at = timezone.now()
        row.save()
        doc.refresh_from_db()
        self.assertFalse(doc.has_links)
        self.assertEqual(self.library()["results"], [])
        self.attach(row)
        self.assertEqual(len(self.library()["results"]), 1)
        self.assertEqual(self.library()["results"][0]["created_at"], row.created_at)

    def test_cursor_stable_for_equal_timestamps_and_new_insertions(self):
        stamp = timezone.now()-timedelta(days=2)
        for i in range(31):
            row = self.direct(f"https://bold.gt/{i}")
            DirectMessage.objects.filter(pk=row.pk).update(created_at=stamp)
            SearchDocument.objects.filter(direct=row).update(created_at=stamp)
        first = self.library()
        self.direct("https://bold.gt/new-after-snapshot")
        second = self.library(cursor=first["next_cursor"])
        self.assertEqual((len(first["results"]), len(second["results"])), (25, 6))
        self.assertEqual(len({r["source_id"] for r in first["results"]+second["results"]}), 31)
        self.assertEqual(self.library(cursor=first["first_cursor"])["results"], first["results"])
        self.assertEqual(self.client.get(self.chat_url, {"cursor": first["next_cursor"], "kind": "link"}).status_code, 400)
        self.assertEqual(self.as_person(self.bob).get(self.chat_url, {"cursor": first["next_cursor"]}).status_code, 400)
        self.assertEqual(self.client.get(self.channel_url, {"cursor": first["next_cursor"]}).status_code, 400)

    def test_scoped_channel_threads_and_archived_read_only_history(self):
        main = self.channel_message("https://bold.gt/root")
        reply = self.channel_message("https://bold.gt/reply", parent=main)
        other = self.channel_message("https://bold.gt/other")
        self.attach(reply, ChannelMedia)
        result = self.library(self.channel_url, parent=main.pk)
        self.assertEqual({r["source_id"] for r in result["results"]}, {str(main.pk), str(reply.pk)})
        self.assertNotIn(str(other.pk), str(result))
        DepartmentChannel.objects.filter(pk=self.channel_id).update(archived_at=timezone.now())
        self.assertEqual(len(self.library(self.channel_url)["results"]), 3)
        self.assertEqual(self.client.get(self.channel_url, {"parent": reply.pk}).status_code, 404)
        self.assertEqual(self.client.get(self.chat_url, {"parent": main.pk}).status_code, 400)

    def test_current_acl_before_every_page_even_owner_cannot_read_private_messages(self):
        self.direct("https://bold.gt/private-chat")
        owner = self.as_person(self.owner)
        self.assertEqual(owner.get(self.chat_url, {"unknown": "x"}).status_code, 404)
        self.assertEqual(APIClient().get(self.chat_url).status_code, 401)
        self.channel_message("https://bold.gt/private-channel")
        DepartmentChannel.objects.filter(pk=self.channel_id).update(visibility="private")
        self.assertEqual(owner.get(self.channel_url).status_code, 404)
        bob = self.as_person(self.bob)
        self.assertEqual(bob.get(self.channel_url).status_code, 404)
        rule = ChannelAccessRule.objects.create(channel_id=self.channel_id, employee=self.bob.employee, access="read")
        page = self.library(self.channel_url, client=bob)
        rule.access = "blocked"
        rule.save()
        self.assertEqual(bob.get(self.channel_url, {"cursor": page["first_cursor"]}).status_code, 404)
        self.deny("slack.channel.read")
        self.assertEqual(self.client.get(self.channel_url).status_code, 404)

    def test_page_read_denial_does_not_hide_message_resources(self):
        self.channel_message("https://bold.gt/message-resource")
        self.deny("slack.page.read")
        self.assertEqual(len(self.library(self.channel_url)["results"]), 1)

    def test_pilot_permission_is_enforced_and_filters_are_strict(self):
        with override_settings(MESSAGING_PILOT_ENABLED=True, MESSAGING_PILOT_UNIT_IDS=[]):
            self.assertEqual(self.client.get(self.chat_url).status_code, 403)
        for params in ({"kind": "video"}, {"q": "x"}, {"after": "bad"}, {"author": "bad"}, {"unknown": "x"}, {"cursor": "tampered"}):
            self.assertEqual(self.client.get(self.chat_url, params).status_code, 400, params)
        self.assertEqual(self.client.get(self.chat_url+"?kind=all&kind=image").status_code, 400)

    def test_frozen_historical_backfill_is_bounded_and_idempotent(self):
        row = self.direct("https://bold.gt/old-resource")
        invalid = self.direct("https://user:password@bold.gt/secret")
        SearchDocument.objects.update(has_links=False)
        migration = importlib.import_module("boldApp.mensajeria.migrations.0028_resource_library")
        state = MigrationExecutor(connection).loader.project_state([("boldApp_mensajeria", "0028_resource_library")]).apps
        with connection.cursor() as cursor:
            editor = SimpleNamespace(connection=connection, execute=cursor.execute)
            migration.backfill(state, editor)
            migration.backfill(state, editor)
        self.assertTrue(SearchDocument.objects.get(direct=row).has_links)
        self.assertFalse(SearchDocument.objects.get(direct=invalid).has_links)
        self.assertFalse(SearchDocument.objects.filter(page__isnull=False, has_links=True).exists())

    def test_safe_links_are_literal_never_fetch_and_do_not_truncate_within_a_message(self):
        links = resource_links('(https://bold.gt/a(b)). www.bold.gt/help! https://bold.gt/a(b) javascript:alert(1) https://user:secret@bold.gt https://bold.gt\\evil https://bold.gt:99999 https://bold.gt/\u200bx')
        self.assertEqual([r["href"] for r in links], ["https://bold.gt/a(b)", "https://www.bold.gt/help"])
        body = " ".join(f"https://bold.gt/{n}" for n in range(120))
        self.assertEqual(len(resource_links(body)), 120)
        self.assertEqual(resource_links("https://[bad/"), [])
