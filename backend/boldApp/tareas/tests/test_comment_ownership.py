from django.test import TestCase
from rest_framework.test import APIClient

from boldApp.core.models import Employee, JobRole, JobRolePermission, OrganizationalUnit, Permission, Position, PositionAssignment, UserAccount
from boldApp.tareas.models import Comment, Project, ProjectMember, Task, TaskFollower, TaskProject, TaskStatus


class CommentOwnershipTests(TestCase):
    def setUp(self):
        self.unit = OrganizationalUnit.objects.create(name="Equipo", sensitivity_level="low", unit_type="department")
        self.role = JobRole.objects.create(title="Analista")
        for code in ("tasks.task.read", "tasks.project.read", "tasks.task.update", "tasks.comment.create"):
            JobRolePermission.objects.create(job_role=self.role, permission=Permission.objects.get(code=code), effect="allow", scope_type="own_unit")
        self.author = self.identity("author")
        self.creator = self.identity("creator")
        self.responsible = self.identity("responsible")
        self.helper = self.identity("helper")
        self.reader = self.identity("reader")
        self.owner = self.identity("owner", superuser=True)
        status = TaskStatus.objects.create(unit=self.unit, name="Pendiente", category="todo", position=1)
        self.task = Task.objects.create(unit=self.unit, title="Tarea compartida", status=status,
            created_by_assignment=self.creator, assignee_assignment=self.responsible)
        TaskFollower.objects.create(task=self.task, assignment=self.helper, added_by_assignment=self.creator)
        self.project = Project.objects.create(unit=self.unit, name="Compartido", created_by_assignment=self.creator, owner_assignment=self.creator)
        for person in (self.author, self.helper, self.reader):
            ProjectMember.objects.create(project=self.project, assignment=person, added_by_assignment=self.creator, member_role="collaborator", status="active")
        TaskProject.objects.create(task=self.task, project=self.project, position=1000, added_by_assignment=self.creator)
        self.comment = Comment.objects.create(task=self.task, author_assignment=self.author, body="Original")
        self.url = f"/api/v2/comments/{self.comment.pk}/"

    def identity(self, name, superuser=False):
        employee = Employee.objects.create(full_name=name)
        UserAccount.objects.create_user(email=f"{name}@bold.gt", employee=employee, is_superuser=superuser)
        return PositionAssignment.objects.create(employee=employee, position=Position.objects.create(unit=self.unit, job_role=self.role))

    def client_for(self, assignment):
        client = APIClient()
        client.force_authenticate(assignment.employee.user_account)
        client.credentials(HTTP_X_ASSIGNMENT_ID=str(assignment.pk))
        return client

    def test_other_people_cannot_patch_put_or_delete_even_with_task_update(self):
        for person in (self.creator, self.responsible, self.helper, self.reader, self.owner):
            client = self.client_for(person)
            self.assertEqual(client.get(self.url).status_code, 200)
            for method in ("patch", "put"):
                with self.subTest(person=person.employee.full_name, method=method):
                    response = getattr(client, method)(self.url, {"task": str(self.task.pk), "body": "Alterado", "author_assignment": str(person.pk)}, format="json")
                    self.assertEqual(response.status_code, 403, response.data)
                    self.comment.refresh_from_db()
                    self.assertEqual(self.comment.body, "Original")
                    self.assertEqual(self.comment.author_assignment_id, self.author.pk)
            with self.subTest(person=person.employee.full_name, method="delete"):
                self.assertEqual(client.delete(self.url).status_code, 403)
                self.assertTrue(Comment.objects.filter(pk=self.comment.pk).exists())

    def test_reader_can_comment_without_task_edit_and_manage_only_their_comment(self):
        JobRolePermission.objects.filter(job_role=self.role, permission__code="tasks.task.update").delete()
        client = self.client_for(self.reader)
        self.assertEqual(client.patch(f"/api/v2/tasks/{self.task.pk}/", {"title": "No permitido"}, format="json").status_code, 403)
        response = client.post("/api/v2/comments/", {"task": str(self.task.pk), "body": "Mi comentario", "author_assignment": str(self.owner.pk), "can_manage": True}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(str(response.data["author_assignment"]), str(self.reader.pk))
        self.assertTrue(response.data["can_manage"])
        url = f"/api/v2/comments/{response.data['id']}/"
        self.assertEqual(client.patch(url, {"body": "Mi corrección"}, format="json").status_code, 200)
        self.assertEqual(client.delete(url).status_code, 204)
        self.assertEqual(client.patch(self.url, {"body": "Ajeno", "can_manage": True}, format="json").status_code, 403)

    def test_management_metadata_and_identity_survive_switching_assignments(self):
        client = self.client_for(self.author)
        self.assertTrue(client.get(self.url).data["can_manage"])
        self.assertFalse(self.client_for(self.owner).get(self.url).data["can_manage"])
        replacement = PositionAssignment.objects.create(employee=self.author.employee, position=Position.objects.create(unit=self.unit, job_role=self.role))
        self.author.is_active = False
        self.author.save(update_fields=["is_active"])
        client = self.client_for(replacement)
        self.assertTrue(client.get(self.url).data["can_manage"])
        self.assertEqual(client.patch(self.url, {"body": "Misma persona, otro cargo"}, format="json").status_code, 200)
        self.assertEqual(client.delete(self.url).status_code, 204)

    def test_timeline_comments_have_the_same_author_only_boundary(self):
        self.comment.image_section = "timeline"
        self.comment.image_project_id = self.project.pk
        self.comment.save()
        client = self.client_for(self.helper)
        self.assertEqual(client.patch(self.url, {"body": "Ajeno"}, format="json").status_code, 403)
        self.assertEqual(client.delete(self.url).status_code, 403)
        self.assertEqual(self.client_for(self.author).patch(self.url, {"body": "Cronograma corregido"}, format="json").status_code, 200)

    def test_author_cannot_manage_after_losing_task_visibility(self):
        JobRolePermission.objects.filter(job_role=self.role, permission__code="tasks.task.read").delete()
        client = self.client_for(self.author)
        self.assertEqual(client.patch(self.url, {"body": "Ya no visible"}, format="json").status_code, 404)
        self.assertEqual(client.delete(self.url).status_code, 404)

    def test_django_admin_cannot_bypass_comment_ownership(self):
        from django.contrib.admin import site
        from django.test import RequestFactory
        from boldApp.tareas.admin import CommentAdmin
        admin = CommentAdmin(Comment, site)
        request = RequestFactory().get("/admin/")
        request.user = self.owner.employee.user_account
        self.assertFalse(admin.has_add_permission(request))
        self.assertFalse(admin.has_change_permission(request, self.comment))
        self.assertFalse(admin.has_delete_permission(request, self.comment))
        self.assertFalse(admin.get_actions(request))

    def test_unreadable_task_does_not_accept_comments(self):
        JobRolePermission.objects.filter(job_role=self.role, permission__code="tasks.task.read").delete()
        response = self.client_for(self.reader).post("/api/v2/comments/", {"task": str(self.task.pk), "body": "No puedo verla"}, format="json")
        self.assertEqual(response.status_code, 403, response.data)
        self.assertEqual(Comment.objects.count(), 1)

    def test_author_cannot_move_comment_to_a_task_they_cannot_read(self):
        other_unit = OrganizationalUnit.objects.create(name="Privado", sensitivity_level="low", unit_type="department")
        status = TaskStatus.objects.create(unit=other_unit, name="Pendiente", category="todo", position=1)
        hidden = Task.objects.create(unit=other_unit, title="Oculta", status=status, created_by_assignment=self.creator)
        rule = JobRolePermission.objects.get(job_role=self.role, permission__code="tasks.task.update")
        rule.scope_type = "global"
        rule.save(update_fields=["scope_type"])
        client = self.client_for(self.author)
        self.assertEqual(client.get(f"/api/v2/tasks/{hidden.pk}/").status_code, 404)
        response = client.patch(self.url, {"task": str(hidden.pk), "body": "No debe trasladarse"}, format="json")
        self.assertEqual(response.status_code, 403, response.data)
        self.comment.refresh_from_db()
        self.assertEqual(self.comment.task_id, self.task.pk)
        self.assertEqual(self.comment.body, "Original")
