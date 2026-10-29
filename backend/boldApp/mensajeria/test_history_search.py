import importlib
import uuid
import time
from datetime import timedelta
from types import SimpleNamespace
from unittest import skipUnless
from unittest.mock import patch

from django.apps import apps
from django.db import connection, transaction
from django.db.migrations.executor import MigrationExecutor
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from boldApp.workspace.models import ImageStorageRoot
from . import test_pages as fixtures
from .models import (ChannelAccessRule, ChannelMedia, ChannelMessage, ChannelPage,
    ChannelReadState, DepartmentChannel, DirectConversation, DirectMessage, MessageMedia, SearchDocument)
from .search_text import normalized_text, snippet


@override_settings(MESSAGING_PILOT_ENABLED=False)
class HistorySearchTests(TestCase):
    root = fixtures.ChannelPageTests.root
    identity = fixtures.ChannelPageTests.identity
    as_person = fixtures.ChannelPageTests.as_person
    blocks = fixtures.ChannelPageTests.blocks
    deny = fixtures.ChannelPageTests.deny
    endpoint = "/api/v2/messaging/search/"

    def setUp(self):
        fixtures.ChannelPageTests.setUp(self)
        self.chat = DirectConversation.objects.create(**dict(zip(("first_employee_id", "second_employee_id"), sorted([self.alice.employee_id, self.bob.employee_id]))))

    def direct(self, body, *, conversation=None, author=None):
        return DirectMessage.objects.create(conversation=conversation or self.chat, author_id=author or self.alice.employee_id,
            client_id=uuid.uuid4(), body=body)

    def channel_message(self, body, *, parent=None, author=None):
        return ChannelMessage.objects.create(channel_id=self.channel_id, author_assignment=author or self.alice,
            author_id=(author or self.alice).employee_id, client_id=uuid.uuid4(), payload_digest="fixture",
            sequence=ChannelMessage.objects.filter(channel_id=self.channel_id).count() + 1,
            body=body, parent=parent, department_name="IT", department_color="#123456")

    def search(self, client=None, **filters):
        result = (client or self.client).get(self.endpoint, filters)
        self.assertEqual(result.status_code, 200, result.data)
        self.assertIn("no-store", result["Cache-Control"])
        return result.data

    def ids(self, **filters):
        return {row["source_id"] for row in self.search(**filters)["results"]}

    def test_whole_history_accents_word_and_page_block_context(self):
        old = self.channel_message("Revisión presupuestaria ñandú")
        for index in range(70):
            self.channel_message(f"Conversación posterior {index}")
        dm = self.direct("Ñandú: presupuesto revisión")
        page = ChannelPage.objects.get(pk=self.page["id"])
        block = {"id": str(uuid.uuid4()), "type": "paragraph", "text": "Presupuesto para la revisión del ñandú"}
        page.blocks = [block]
        page.save()
        rows = self.search(q="REVISION ñandú")["results"]
        self.assertEqual({row["source_id"] for row in rows}, {str(old.pk), str(dm.pk), str(page.pk)})
        page_result = next(row for row in rows if row["kind"] == "page")
        self.assertEqual(page_result["target"]["block_id"], block["id"])
        self.assertEqual(self.search(q="presupuest")["results"], [])
        self.assertNotIn("drive_id", str(rows))

    def test_direct_chats_have_no_owner_override_and_filters_cannot_expand_membership(self):
        private = self.direct("Privado exclusivamente para sus participantes")
        self.assertIn(str(private.pk), self.ids(q="privado", scope="chat"))
        self.assertEqual(self.search(client=self.as_person(self.owner), q="privado")["results"], [])
        endpoint = f"/api/v2/messaging/conversations/{self.chat.pk}/messages/{private.pk}/context/"
        self.assertEqual(self.as_person(self.owner).get(endpoint).status_code, 404)
        self.assertEqual(self.as_person(self.owner).get(self.endpoint, {"conversation": str(self.chat.pk)}).status_code, 404)
        self.assertEqual(APIClient().get(self.endpoint, {"q": "privado"}).status_code, 401)

    def test_private_channel_boundary_is_rechecked_for_search_pagination_and_context(self):
        message = self.channel_message("Secreto del canal reservado")
        DepartmentChannel.objects.filter(pk=self.channel_id).update(visibility="private")
        bob = self.as_person(self.bob)
        owner = self.as_person(self.owner)
        self.assertEqual(self.search(client=owner, q="secreto")["results"], [])
        self.assertEqual(self.search(client=bob, q="secreto")["results"], [])
        rule = ChannelAccessRule.objects.create(channel_id=self.channel_id, employee=self.bob.employee, access="read")
        self.assertIn(str(message.pk), {row["source_id"] for row in self.search(client=bob, q="secreto")["results"]})
        context_url = self.url + f"messages/{message.pk}/context/"
        self.assertEqual(bob.get(context_url).status_code, 200)
        rule.access = "blocked"
        rule.save()
        self.assertEqual(self.search(client=bob, q="secreto")["results"], [])
        self.assertEqual(bob.get(context_url).status_code, 404)

    def test_page_permission_precedes_matching_and_task_projection_is_never_indexed(self):
        page = ChannelPage.objects.get(pk=self.page["id"])
        opaque = str(uuid.uuid4())
        page.blocks += [{"id": str(uuid.uuid4()), "type": "task", "task_id": opaque, "text": "Proyección confidencial"}]
        page.save()
        self.assertNotIn(opaque, page.search_document.text)
        self.assertNotIn("confidencial", page.search_document.text)
        self.deny("slack.page.read")
        self.assertEqual(self.search(q="acuerdos")["results"], [])
        self.assertEqual(self.search(kind="page")["results"], [])
        self.channel_message("Acuerdos visibles del canal")
        self.assertEqual(len(self.search(q="acuerdos")["results"]), 1)
        self.deny("slack.channel.read")
        self.assertEqual(self.search(q="acuerdos")["results"], [])

    def test_file_metadata_type_author_dates_and_no_drive_access(self):
        message = self.direct("Captura del lanzamiento")
        root = ImageStorageRoot.objects.create(user=self.alice.employee.user_account, subject="search-test", client_id="synthetic",
            google_email="drive@example.invalid", folder_id="private-drive-root", folder_name="Pruebas", active=True)
        MessageMedia.objects.create(message=message, root=root, drive_id="DO-NOT-EXPOSE", kind="image", mime_type="image/webp",
            filename="Revisión_campaña.png", size_bytes=2345, digest="a" * 64, width=100, height=100)
        rows = self.search(q="revision campaña", kind="image", author=str(self.alice.employee_id),
            after=(message.created_at-timedelta(minutes=1)).isoformat(), before=(message.created_at+timedelta(minutes=1)).isoformat())["results"]
        self.assertEqual([row["source_id"] for row in rows], [str(message.pk)])
        self.assertEqual(rows[0]["media"]["filename"], "Revisión_campaña.png")
        self.assertNotIn("DO-NOT-EXPOSE", str(rows))
        self.assertEqual(self.search(q="campaña", kind="text")["results"], [])
        self.assertEqual(self.search(q="campaña", author=str(self.bob.employee_id))["results"], [])
        self.assertEqual(self.search(q="campaña", before=(message.created_at-timedelta(seconds=1)).isoformat())["results"], [])
        self.assertEqual(len(self.search(kind="file")["results"]), 1)

    def test_stable_signed_cursor_ties_concurrent_insertion_and_query_account_binding(self):
        stamp = timezone.now() - timedelta(days=1)
        sources = [self.direct(f"Historial común {index}") for index in range(45)]
        # Set a tie on the source AND projection; ordinary writes never mutate
        # creation time. This exercises the secondary UUID seek boundary.
        DirectMessage.objects.filter(pk__in=[row.pk for row in sources]).update(created_at=stamp)
        SearchDocument.objects.filter(direct__in=sources).update(created_at=stamp)
        first = self.search(q="historial", scope="chat")
        cursor = first["next_cursor"]
        self.assertTrue(cursor)
        self.direct("Historial insertado después del inicio")
        repeated = self.search(q="historial", scope="chat", cursor=first["first_cursor"])
        self.assertEqual([row["source_id"] for row in repeated["results"]], [row["source_id"] for row in first["results"]])
        second = self.search(q="historial", scope="chat", cursor=cursor)
        third = self.search(q="historial", scope="chat", cursor=second["next_cursor"])
        all_ids = [row["source_id"] for page in (first, second, third) for row in page["results"]]
        self.assertEqual(len(all_ids), 45)
        self.assertEqual(len(set(all_ids)), 45)
        self.assertIsNone(third["next_cursor"])
        for client, changes in ((self.client, {"q": "otro"}), (self.client, {"kind": "text"}), (self.as_person(self.bob), {})):
            self.assertEqual(client.get(self.endpoint, {"q": "historial", "scope": "chat", "cursor": cursor, **changes}).status_code, 400)
        self.assertEqual(self.client.get(self.endpoint, {"q": "historial", "scope": "chat", "cursor": cursor + "x"}).status_code, 400)
        with patch("django.core.signing.time.time", return_value=time.time()+1900):
            self.assertEqual(self.client.get(self.endpoint, {"q": "historial", "scope": "chat", "cursor": cursor}).status_code, 400)
        alternate = self.identity("alternate-assignment", self.it)
        alternate.employee = self.alice.employee
        alternate.save(update_fields=["employee"])
        self.assertEqual(self.as_person(alternate).get(self.endpoint, {"q": "historial", "scope": "chat", "cursor": cursor}).status_code, 400)

    def test_cursor_cannot_retain_content_after_revocation(self):
        for index in range(25):
            self.channel_message(f"Reservado resultado {index}")
        first = self.search(q="reservado", scope="slack")
        self.assertTrue(first["next_cursor"])
        DepartmentChannel.objects.filter(pk=self.channel_id).update(visibility="private")
        self.assertEqual(self.search(q="reservado", scope="slack", cursor=first["next_cursor"])["results"], [])

    def test_live_projection_edits_deletion_archive_and_transaction_rollback(self):
        message = self.direct("Palabra inicial")
        message.body = "Contenido reemplazado"
        message.save(update_fields=["body"])
        self.assertEqual(self.search(q="inicial")["results"], [])
        self.assertIn(str(message.pk), self.ids(q="reemplazado"))
        try:
            with transaction.atomic():
                self.direct("Cambio que termina revertido")
                raise ValueError("rollback")
        except ValueError:
            pass
        self.assertEqual(self.search(q="revertido")["results"], [])
        message.delete()
        self.assertEqual(self.search(q="reemplazado")["results"], [])
        page = ChannelPage.objects.get(pk=self.page["id"])
        page.archived_at = timezone.now()
        page.save()
        self.assertEqual(self.search(q="acuerdos")["results"], [])
        self.assertEqual(len(self.search(q="acuerdos", archived="true")["results"]), 1)

    def test_invalid_filters_are_rejected_and_pilot_is_not_widened(self):
        for filters in ({"q": "a"}, {"q": "uno dos tres cuatro cinco seis siete ocho nueve"}, {"q": "***"},
                {"channel": "bad"}, {"extra": "ignored?"}, {"kind": "html"},
                {"channel": self.channel_id, "scope": "chat"}, {"after": "2030-01-01T00:00:00Z", "before": "2020-01-01T00:00:00Z"}):
            self.assertEqual(self.client.get(self.endpoint, filters).status_code, 400, filters)
        self.assertEqual(self.client.get(self.endpoint + "?q=uno&q=dos").status_code, 400)
        with override_settings(MESSAGING_PILOT_ENABLED=True, MESSAGING_PILOT_UNIT_IDS=()):
            self.assertEqual(self.client.get(self.endpoint).status_code, 403)

    def test_exact_old_direct_context_is_bounded_without_marking_read(self):
        rows = [self.direct(f"Mensaje {index}") for index in range(80)]
        anchor = rows[20]
        endpoint = f"/api/v2/messaging/conversations/{self.chat.pk}/messages/{anchor.pk}/context/"
        result = self.as_person(self.bob).get(endpoint)
        self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual(result.data["anchor_id"], str(anchor.pk))
        self.assertEqual([row["id"] for row in result.data["results"]], [str(row.pk) for row in rows[5:36]])
        self.assertTrue(result.data["has_before"])
        self.assertTrue(result.data["has_after"])
        self.assertFalse(self.chat.messages.filter(read_at__isnull=False).exists())

    def test_exact_thread_context_excludes_other_threads_and_does_not_acknowledge_reads(self):
        root = self.channel_message("Raíz del hilo")
        other = self.channel_message("Otra raíz")
        reply = self.channel_message("Respuesta exacta", parent=root, author=self.bob)
        self.channel_message("Respuesta ajena", parent=other)
        result = self.client.get(self.url + f"messages/{reply.pk}/context/")
        self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual([row["id"] for row in result.data["results"]], [str(root.pk), str(reply.pk)])
        self.assertEqual(result.data["parent_id"], str(root.pk))
        self.assertEqual(ChannelReadState.objects.count(), 0)

    def test_backfill_uses_historical_sources_and_excludes_task_content(self):
        message = self.direct("Contenido previo al índice")
        SearchDocument.objects.all().delete()
        migration = importlib.import_module("boldApp.mensajeria.migrations.0017_history_search")
        state = MigrationExecutor(connection).loader.project_state([("boldApp_mensajeria", "0017_history_search")]).apps
        with connection.cursor() as cursor:
            migration.backfill(state, SimpleNamespace(connection=connection, execute=cursor.execute))
        self.assertIn(str(message.pk), self.ids(q="indice"))
        self.assertEqual(SearchDocument.objects.count(), DirectMessage.objects.count() + ChannelMessage.objects.count() + ChannelPage.objects.count())

    def test_snippets_are_plain_text_and_normalization_is_shared(self):
        self.assertEqual(normalized_text("Revisión_campaña ÑANDÚ"), "revision campana nandu")
        text = "A" * 400 + " Revisión <script>no ejecutar</script> " + "B" * 400
        excerpt = snippet(text, "revision")
        self.assertIn("Revisión", excerpt)
        self.assertLessEqual(len(excerpt), 242)

    @skipUnless(connection.vendor == "postgresql", "PostgreSQL-only functional GIN assertion")
    def test_postgres_functional_gin_is_present_and_usable(self):
        from django.contrib.postgres.search import SearchVector, SearchQuery
        self.direct("Presupuesto revisión campaña")
        self.assertEqual(len(self.search(q="REVISION campaña")["results"]), 1)
        with connection.cursor() as cursor:
            cursor.execute("SELECT indexdef FROM pg_indexes WHERE indexname='slack_search_text_gin'")
            definition = cursor.fetchone()[0]
            self.assertIn("USING gin", definition)
            cursor.execute("SET LOCAL enable_seqscan=off")
            plan = SearchDocument.objects.alias(_vector=SearchVector("text", config="simple")).filter(
                _vector=SearchQuery("revision campana", config="simple")).explain()
            self.assertIn("slack_search_text_gin", plan)
