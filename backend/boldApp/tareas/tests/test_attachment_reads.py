from urllib.parse import urlsplit
from django.core.management import call_command
from contextlib import contextmanager
from unittest.mock import patch
from django.db.backends.utils import CursorWrapper
from django.test import TransactionTestCase, RequestFactory, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from boldApp.autenticacion.services import create_session
from boldApp.core.models import UserAccount, PositionAssignment, JobRolePermission
from boldApp.tareas.models import Attachment, Comment, Task, TaskStatus


@contextmanager
def capture_sql():
    # Async middleware may use another connection. A main-thread query log can
    # be empty even when SQL executes; record actual execution in either thread.
    queries = []
    execute = CursorWrapper.execute
    def recorded(cursor, sql, params=None):
        queries.append(sql)
        return execute(cursor, sql, params)
    with patch.object(CursorWrapper, "execute", recorded):
        yield queries


@override_settings(SECURE_SSL_REDIRECT=False, DEBUG=True)
class AttachmentReadTests(TransactionTestCase):
    def setUp(self):
        call_command("seed_demo_data", verbosity=0)
        account = UserAccount.objects.get(email="ana@bold.gt")
        self.assignment = PositionAssignment.objects.get(employee=account.employee, is_active=True)
        self.other = PositionAssignment.objects.get(employee__user_account__email="david@bold.gt", is_active=True)
        _, session = create_session(account, RequestFactory().get("/", REMOTE_ADDR="127.0.0.1"))
        self.client = APIClient()
        self.client.force_authenticate(account, session)
        self.client.credentials(HTTP_X_ASSIGNMENT_ID=str(self.assignment.pk))
        self.task = self.make_task(self.assignment)

    def make_task(self, author):
        unit = author.position.unit
        return Task.objects.create(title="Adjuntos sintéticos", unit=unit,
            status=TaskStatus.objects.filter(unit=unit).first(), created_by_assignment=author, priority="medium")

    def files(self, task, count):
        return Attachment.objects.bulk_create([Attachment(task=task, file_name=f"Archivo {i}",
            file_url="https://example.com/file", size_bytes=0, uploaded_by_assignment=self.assignment) for i in range(count)])

    def page(self, **filters):
        return self.client.get("/api/v2/attachments/", {"recent": "1", "tasks": str(self.task.pk), **filters})

    def next_page(self, link):
        url = urlsplit(link)
        return self.client.get(url.path + "?" + url.query)

    def test_large_attachment_page_and_task_count_exclude_foreign_and_deleted_files(self):
        self.files(self.task, 5000)
        foreign = self.make_task(self.other)
        self.files(foreign, 50)
        deleted = self.files(self.task, 1)[0]
        deleted.deleted_at = timezone.now(); deleted.save(update_fields=["deleted_at"])
        with capture_sql() as sql:
            page = self.page(tasks=f"{self.task.pk},{foreign.pk}")
        self.assertEqual(page.status_code, 200, page.data)
        self.assertEqual(page.data["count"], 5000)
        self.assertEqual(len(page.data["results"]), 25)
        self.assertGreater(len(sql), 0)
        self.assertTrue(all(str(row["task"]) == str(self.task.pk) for row in page.data["results"]))
        tasks = self.client.get("/api/v2/tasks/", {"ids": f"{self.task.pk},{foreign.pk}"})
        self.assertEqual(tasks.status_code, 200, tasks.data)
        self.assertEqual(tasks.data["count"], 1)
        self.assertEqual(tasks.data["results"][0]["attachment_count"], 5000)
        print(f"SQL attachment page: {len(sql)} queries; 25 rows of 5000 authorized files")

    def test_cursor_handles_equal_dates_and_does_not_walk_new_insert(self):
        originals = self.files(self.task, 63)
        Attachment.objects.filter(task=self.task).update(created_at=timezone.now())
        first = self.page()
        fresh = self.files(self.task, 1)[0]
        seen = [str(row["id"]) for row in first.data["results"]]
        link = first.data["next"]
        while link:
            page = self.next_page(link)
            self.assertEqual(page.status_code, 200, page.data)
            seen.extend(str(row["id"]) for row in page.data["results"])
            link = page.data["next"]
        self.assertEqual(len(seen), len(set(seen)))
        self.assertEqual(set(seen), {str(row.pk) for row in originals})
        self.assertNotIn(str(fresh.pk), seen)
        legacy = self.client.get("/api/v2/attachments/", {"tasks": str(self.task.pk)})
        self.assertIn("page=2", legacy.data["next"])

    def test_cursor_is_not_a_grant_and_isolated_from_comment_cursor(self):
        self.files(self.task, 60)
        first = self.page()
        Comment.objects.bulk_create([Comment(task=self.task, author_assignment=self.assignment, body="Test") for _ in range(26)])
        comments = self.client.get("/api/v2/comments/", {"tasks": str(self.task.pk), "recent": "1"})
        comment_cursor = urlsplit(comments.data["next"]).query
        self.assertEqual(self.client.get("/api/v2/attachments/?" + comment_cursor).status_code, 404)
        self.assertEqual(self.page(cursor="tampered").status_code, 404)
        self.assertEqual(self.page(recent="yes").status_code, 400)
        JobRolePermission.objects.filter(job_role=self.assignment.position.job_role, permission__code="tasks.task.read").delete()
        revoked = self.next_page(first.data["next"])
        self.assertEqual(revoked.status_code, 200, revoked.data)
        self.assertEqual(revoked.data["count"], 0)
        self.assertEqual(revoked.data["results"], [])

    def test_aggregate_does_not_add_one_count_query_per_task(self):
        with capture_sql() as one:
            self.client.get("/api/v2/tasks/", {"ids": str(self.task.pk)})
        extra = [self.make_task(self.assignment) for _ in range(20)]
        for task in extra:
            self.files(task, 1)
        with capture_sql() as many:
            response = self.client.get("/api/v2/tasks/", {"ids": ",".join(str(task.pk) for task in [self.task, *extra])})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(response.data["results"]), 21)
        self.assertEqual(len(one), len(many))
        self.assertGreater(len(one), 0)
        counts = {str(row["id"]): row["attachment_count"] for row in response.data["results"]}
        self.assertEqual(counts[str(self.task.pk)], 0)
        self.assertTrue(all(counts[str(task.pk)] == 1 for task in extra))
