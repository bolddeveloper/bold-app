from urllib.parse import urlsplit
from datetime import timedelta
from django.test import TransactionTestCase, RequestFactory, override_settings
from django.core.management import call_command
from django.utils import timezone
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient
from boldApp.autenticacion.services import create_session
from boldApp.core.models import UserAccount, PositionAssignment, JobRolePermission, OrganizationalUnit
from boldApp.tareas.models import Comment, Task, TaskStatus, Project, TaskProject, TaskFollower
from boldApp.tareas.views import AssignmentScopedViewSetMixin
from types import SimpleNamespace


@override_settings(SECURE_SSL_REDIRECT=False, DEBUG=True)
class CommentHistoryTests(TransactionTestCase):
    def setUp(self):
        call_command("seed_demo_data", verbosity=0)
        account = UserAccount.objects.get(email="ana@bold.gt")
        self.assignment = PositionAssignment.objects.get(employee=account.employee, is_active=True)
        self.other = PositionAssignment.objects.get(employee__user_account__email="david@bold.gt", is_active=True)
        self.unit = self.assignment.position.unit
        self.status = TaskStatus.objects.filter(unit=self.unit).first()
        _, session = create_session(account, RequestFactory().get("/", REMOTE_ADDR="127.0.0.1"))
        self.client = APIClient()
        self.client.force_authenticate(account, session)
        self.client.credentials(HTTP_X_ASSIGNMENT_ID=str(self.assignment.pk))
        self.task = self.task_for(self.assignment, "Historial")

    def task_for(self, author, title, assignee=None, unit=None):
        unit = unit or self.unit
        return Task.objects.create(title=title, unit=unit, status=TaskStatus.objects.filter(unit=unit).first(),
            created_by_assignment=author, assignee_assignment=assignee, priority="medium")

    def comments(self, task, count):
        return Comment.objects.bulk_create([Comment(task=task, author_assignment=self.assignment, body=f"Sintético {i}") for i in range(count)])

    def page(self, **filters):
        return self.client.get("/api/v2/comments/", {"recent": "1", **filters})

    def next_page(self, link):
        url = urlsplit(link)
        return self.client.get(url.path + "?" + url.query)

    def test_timeline_filter_excludes_task_comments_and_other_project_timelines(self):
        normal = Comment.objects.create(task=self.task, author_assignment=self.assignment, body="Tarea")
        project = Project.objects.create(name="Cronograma", unit=self.unit, owner_assignment=self.assignment, created_by_assignment=self.assignment)
        TaskProject.objects.create(task=self.task, project=project, position=1, added_by_assignment=self.assignment)
        timeline = Comment.objects.create(task=self.task, author_assignment=self.assignment, body="Cronograma", image_section="timeline", image_project_id=project.pk)
        other = Comment.objects.create(task=self.task, author_assignment=self.assignment, body="Otro", image_section="timeline")
        page = self.page(tasks=str(self.task.pk), image_section="timeline")
        self.assertEqual(page.status_code, 200, page.data)
        self.assertEqual({str(row["id"]) for row in page.data["results"]}, {str(timeline.pk), str(other.pk)})
        page = self.page(project=str(project.pk), image_section="timeline")
        self.assertEqual(page.status_code, 200, page.data)
        self.assertEqual([str(row["id"]) for row in page.data["results"]], [str(timeline.pk)])
        self.assertEqual(self.page(image_section="invalid").status_code, 400)

    def test_large_history_returns_25_rows_and_authorized_count_not_all_comments(self):
        self.comments(self.task, 5000)
        foreign = self.task_for(self.other, "Privada", unit=self.other.position.unit)
        self.comments(foreign, 50)
        with CaptureQueriesContext(connection) as sql:
            page = self.page(tasks=f"{self.task.pk},{foreign.pk}")
        self.assertEqual(page.status_code, 200, page.data)
        self.assertEqual(page.data["count"], 5000)
        self.assertEqual(len(page.data["results"]), 25)
        self.assertTrue(all(str(item["task"]) == str(self.task.pk) for item in page.data["results"]))
        self.assertIsNotNone(page.data["next"])
        print(f"SQL paged history: {len(sql)} queries; 25 rows of 5000 authorized comments")

    def test_composite_cursor_handles_equal_dates_new_insert_and_soft_delete(self):
        comments = self.comments(self.task, 63)
        stamp = timezone.now() - timedelta(days=1)
        Comment.objects.filter(task=self.task).update(created_at=stamp)
        first = self.page(tasks=str(self.task.pk))
        self.assertEqual(first.status_code, 200, first.data)
        seen = [str(row["id"]) for row in first.data["results"]]
        fresh = self.comments(self.task, 1)[0]  # new top item cannot shift the existing cursor
        link = first.data["next"]
        while link:
            page = self.next_page(link)
            self.assertEqual(page.status_code, 200, page.data)
            seen.extend(str(row["id"]) for row in page.data["results"])
            link = page.data["next"]
        self.assertEqual(len(seen), len(set(seen)))
        self.assertEqual(set(seen), {str(row.pk) for row in comments})
        self.assertNotIn(str(fresh.pk), seen)
        fresh.deleted_at = timezone.now(); fresh.save(update_fields=["deleted_at"])
        self.assertEqual(self.page(tasks=str(self.task.pk)).data["count"], 63)
        legacy = self.client.get("/api/v2/comments/", {"tasks": str(self.task.pk)})
        self.assertEqual(legacy.status_code, 200)
        self.assertTrue("page=2" in legacy.data["next"])
        self.assertEqual(self.page(tasks=str(self.task.pk), cursor="tampered").status_code, 404)

    def test_cursor_does_not_preserve_access_after_permission_revocation(self):
        self.comments(self.task, 60)
        page = self.page(tasks=str(self.task.pk))
        self.assertEqual(page.data["count"], 60)
        JobRolePermission.objects.filter(job_role=self.assignment.position.job_role, permission__code="tasks.task.read").delete()
        page = self.next_page(page.data["next"])
        self.assertEqual(page.status_code, 200, page.data)
        self.assertEqual(page.data["count"], 0)
        self.assertEqual(page.data["results"], [])

    def test_mine_and_project_are_filters_never_authorization_grants(self):
        assigned = self.task_for(self.other, "Asignada", assignee=self.assignment)
        followed = self.task_for(self.other, "Seguida")
        unrelated = self.task_for(self.other, "No relacionada")
        TaskFollower.objects.create(task=followed, assignment=self.assignment, notification_level="all")
        for task in (self.task, assigned, followed, unrelated):
            self.comments(task, 1)
        page = self.page(mine="1")
        self.assertEqual(page.status_code, 200, page.data)
        self.assertEqual({str(row["task"]) for row in page.data["results"]}, {str(task.pk) for task in (self.task, assigned, followed)})
        project = Project.objects.create(unit=self.unit, name="Historial", owner_assignment=self.assignment, created_by_assignment=self.assignment)
        TaskProject.objects.create(task=self.task, project=project, position=1, added_by_assignment=self.assignment)
        page = self.page(project=str(project.pk))
        self.assertEqual(page.data["count"], 1)
        JobRolePermission.objects.filter(job_role=self.assignment.position.job_role, permission__code="tasks.project.read").delete()
        page = self.page(project=str(project.pk))
        self.assertEqual(page.status_code, 200, page.data)
        self.assertEqual(page.data["count"], 0)
        self.assertEqual(page.data["results"], [])
        for filters in ({"recent": "false"}, {"mine": "yes"}, {"project": "invalid"}, {"project": f"{project.pk},{project.pk}"}):
            self.assertEqual(self.page(**filters).status_code, 400)

    def test_empty_candidate_query_is_safe_even_through_subqueries(self):
        view = AssignmentScopedViewSetMixin()
        view.request = SimpleNamespace(assignment=self.assignment)
        self.assertEqual(list(view.visible_tasks(Task.objects.none())), [])
        self.assertEqual(list(view.visible_tasks(Task.objects.filter(id__in=Task.objects.filter(id__in=[]).values("id")))), [])
