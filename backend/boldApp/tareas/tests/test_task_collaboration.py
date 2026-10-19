from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from boldApp.core.models import (AccessGrant, Employee, JobRole, JobRolePermission,
    OrganizationalUnit, Permission, Position, PositionAssignment, UserAccount)
from boldApp.tareas.models import Project, ProjectMember, Section, Task, TaskFollower, TaskProject, TaskStatus


class TaskCollaborationTests(TestCase):
    def setUp(self):
        self.unit = OrganizationalUnit.objects.create(name="Equipo", sensitivity_level="low", unit_type="department")
        self.other_unit = OrganizationalUnit.objects.create(name="Otro equipo", sensitivity_level="low", unit_type="department")
        self.role = JobRole.objects.create(title="Analista")
        self.literal_role = JobRole.objects.create(title="Colaborador")
        for role in (self.role, self.literal_role):
            for code in ("tasks.task.read", "tasks.project.read"):
                JobRolePermission.objects.create(job_role=role, permission=Permission.objects.get(code=code), effect="allow", scope_type="own_unit")
        JobRolePermission.objects.create(job_role=self.role, permission=Permission.objects.get(code="tasks.task.update"), effect="allow", scope_type="created_by_me")
        # Even a broad delete policy must not grant a mere follower deletion.
        JobRolePermission.objects.create(job_role=self.role, permission=Permission.objects.get(code="tasks.task.delete"), effect="allow", scope_type="global")
        self.creator = self.identity("creator")
        self.responsible = self.identity("responsible")
        self.member = self.identity("helper")
        self.unrelated = self.identity("outsider")
        self.literal = self.identity("literal", role=self.literal_role)
        self.cross = self.identity("cross", unit=self.other_unit)
        self.owner = self.identity("owner", superuser=True)
        self.todo = TaskStatus.objects.create(unit=self.unit, name="Pendiente", category="todo", position=1)
        self.done = TaskStatus.objects.create(unit=self.unit, name="Finalizada", category="done", position=2, is_final=True)
        self.task = Task.objects.create(unit=self.unit, title="Trabajo conjunto", status=self.todo,
            created_by_assignment=self.creator, assignee_assignment=self.responsible)
        self.follower = TaskFollower.objects.create(task=self.task, assignment=self.member,
            added_by_assignment=self.creator, notification_level="all")
        self.project = Project.objects.create(unit=self.unit, name="Proyecto", created_by_assignment=self.creator, owner_assignment=self.creator)
        ProjectMember.objects.create(project=self.project, assignment=self.member, added_by_assignment=self.creator,
            member_role="collaborator", status="active")
        self.section = Section.objects.create(project=self.project, name="En curso", position=1000)
        self.link = TaskProject.objects.create(task=self.task, project=self.project, section=None, position=1000,
            added_by_assignment=self.creator)
        self.url = f"/api/v2/tasks/{self.task.pk}/"
        self.client = self.client_for(self.member)

    def identity(self, name, unit=None, role=None, superuser=False):
        employee = Employee.objects.create(full_name=name)
        UserAccount.objects.create_user(email=f"{name}@bold.gt", employee=employee, is_superuser=superuser)
        return PositionAssignment.objects.create(employee=employee,
            position=Position.objects.create(unit=unit or self.unit, job_role=role or self.role))

    def client_for(self, assignment):
        client = APIClient(); client.force_authenticate(assignment.employee.user_account)
        client.credentials(HTTP_X_ASSIGNMENT_ID=str(assignment.pk))
        return client

    def test_task_helper_not_job_title_can_edit_finish_reopen_and_move_section(self):
        self.assertNotEqual(self.member.position.job_role.title, "Colaborador")
        for changes in ({"title": "Editada", "description": "Información adicional"},
                        {"status": str(self.done.pk)}, {"status": str(self.todo.pk)}):
            response = self.client.patch(self.url, changes, format="json")
            self.assertEqual(response.status_code, 200, response.data)
        response = self.client.patch(f"/api/v2/task-projects/{self.link.pk}/",
            {"section": str(self.section.pk), "position": "2000"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.link.refresh_from_db(); self.task.refresh_from_db()
        self.assertEqual(self.link.section_id, self.section.pk)
        self.assertEqual(self.task.status_id, self.todo.pk)
        self.assertEqual(self.task.title, "Editada")
        check = self.client.post("/api/v2/core/authorize/", {"assignment": str(self.member.pk),
            "permission_code": "tasks.task.update", "target_unit": str(self.unit.pk), "resource_id": str(self.task.pk)}, format="json")
        self.assertTrue(check.data["allowed"], check.data)

    def test_existing_bulk_links_move_without_project_administration_but_new_links_do_not(self):
        response = self.client.post("/api/v2/tasks/bulk/", {"operation": "link", "ids": [str(self.task.pk)],
            "project": str(self.project.pk), "section": str(self.section.pk)}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(self.client.patch(f"/api/v2/projects/{self.project.pk}/", {"name": "No autorizado"}, format="json").status_code, 403)
        self.assertEqual(self.client.post("/api/v2/sections/", {"project": str(self.project.pk), "name": "No autorizado", "position": "3000"}, format="json").status_code, 403)
        other = Project.objects.create(unit=self.unit, name="Otro proyecto", created_by_assignment=self.creator, owner_assignment=self.creator)
        ProjectMember.objects.create(project=other, assignment=self.member, added_by_assignment=self.creator, member_role="collaborator", status="active")
        self.assertEqual(self.client.post("/api/v2/tasks/bulk/", {"operation": "link", "ids": [str(self.task.pk)], "project": str(other.pk)}, format="json").status_code, 403)
        self.assertEqual(self.client.patch(f"/api/v2/task-projects/{self.link.pk}/", {"project": str(other.pk), "section": None}, format="json").status_code, 403)
        self.assertEqual(TaskProject.objects.filter(task=self.task).count(), 1)
        bad = Section.objects.create(project=other, name="Ajena", position=1000)
        self.assertEqual(self.client.patch(f"/api/v2/task-projects/{self.link.pk}/", {"section": str(bad.pk)}, format="json").status_code, 400)

    def test_helpers_cannot_delete_individually_or_in_bulk_even_with_a_broad_policy(self):
        self.assertEqual(self.client.delete(self.url).status_code, 403)
        own = Task.objects.create(unit=self.unit, title="Propia", status=self.todo, created_by_assignment=self.member)
        response = self.client.post("/api/v2/tasks/bulk/", {"operation": "delete", "ids": [str(own.pk), str(self.task.pk)]}, format="json")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(Task.objects.filter(pk__in=[own.pk, self.task.pk]).count(), 2)
        self.assertEqual(self.client.patch(self.url, {"assignee_assignment": str(self.member.pk)}, format="json").status_code, 403)

    def test_creator_responsible_and_company_owner_can_delete(self):
        for assignment in (self.creator, self.responsible, self.owner):
            task = Task.objects.create(unit=self.unit, title="Eliminar", status=self.todo,
                created_by_assignment=self.creator, assignee_assignment=self.responsible)
            self.assertEqual(self.client_for(assignment).delete(f"/api/v2/tasks/{task.pk}/").status_code, 204)

    def test_removing_follower_revokes_task_specific_edit_immediately(self):
        self.assertEqual(self.client.patch(self.url, {"priority": "high"}, format="json").status_code, 200)
        creator = self.client_for(self.creator)
        self.assertEqual(creator.delete(f"/api/v2/task-followers/{self.follower.pk}/").status_code, 204)
        self.assertEqual(self.client.patch(self.url, {"title": "No autorizado"}, format="json").status_code, 403)
        self.assertEqual(self.client_for(self.unrelated).patch(self.url, {"title": "No autorizado"}, format="json").status_code, 403)
        # A job literally named Colaborador does not imply task membership.
        self.assertEqual(self.client_for(self.literal).patch(self.url, {"title": "No autorizado"}, format="json").status_code, 403)
        self.assertEqual(self.client_for(self.unrelated).post("/api/v2/task-followers/", {
            "task": str(self.task.pk), "assignment": str(self.unrelated.pk), "notification_level": "all"}, format="json").status_code, 403)
        added = creator.post("/api/v2/task-followers/", {"task": str(self.task.pk),
            "assignment": str(self.member.pk), "notification_level": "all"}, format="json")
        self.assertEqual(added.status_code, 201, added.data)
        self.assertEqual(self.client.patch(self.url, {"title": "Acceso recuperado"}, format="json").status_code, 200)

    def test_applicable_denials_and_disabled_permission_override_collaboration(self):
        permission = Permission.objects.get(code="tasks.task.update")
        deny = JobRolePermission.objects.create(job_role=self.role, permission=permission, effect="deny", scope_type="own_unit")
        self.assertEqual(self.client.patch(self.url, {"title": "No autorizado"}, format="json").status_code, 403)
        deny.delete()
        now = timezone.now()
        direct = AccessGrant.objects.create(grantee_assignment=self.member, granted_by_assignment=self.creator,
            permission=permission, effect="deny", scope_type="own_unit", resource_id=str(self.task.pk),
            valid_from=now - timedelta(minutes=1), valid_until=now + timedelta(minutes=5), reason="Prueba de denegación")
        self.assertEqual(self.client.patch(self.url, {"status": str(self.done.pk)}, format="json").status_code, 403)
        direct.delete()
        Permission.objects.filter(pk=permission.pk).update(requires_step_up_mfa=True)
        self.assertEqual(self.client.patch(self.url, {"title": "Requiere MFA"}, format="json").status_code, 403)
        Permission.objects.filter(pk=permission.pk).update(requires_step_up_mfa=False, is_active=False)
        self.assertEqual(self.client.patch(self.url, {"title": "No autorizado"}, format="json").status_code, 403)

    def test_cross_department_helper_only_receives_this_task_and_cannot_fake_target_unit(self):
        TaskFollower.objects.create(task=self.task, assignment=self.cross, added_by_assignment=self.creator, notification_level="all")
        client = self.client_for(self.cross)
        self.assertEqual(client.patch(self.url, {"status": str(self.done.pk)}, format="json").status_code, 200)
        check = client.post("/api/v2/core/authorize/", {"assignment": str(self.cross.pk), "permission_code": "tasks.task.update",
            "target_unit": str(self.other_unit.pk), "resource_id": str(self.task.pk)}, format="json")
        self.assertFalse(check.data["allowed"], check.data)
        unrelated = Task.objects.create(unit=self.unit, title="No compartida", status=self.todo, created_by_assignment=self.creator)
        self.assertEqual(client.get(f"/api/v2/tasks/{unrelated.pk}/").status_code, 404)

    def test_cross_department_responsible_keeps_task_unit_and_can_complete_private_project_task(self):
        owner = self.client_for(self.owner)
        response = owner.patch(self.url, {"assignee_assignment": str(self.cross.pk)}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.task.refresh_from_db()
        self.assertEqual(self.task.unit_id, self.unit.pk)
        client = self.client_for(self.cross)
        context = client.get(f"/api/v2/task-pipelines/{self.task.pk}/")
        self.assertEqual(context.status_code, 200, context.data)
        self.assertEqual(context.data["projects"], [])
        self.assertTrue(context.data["can_complete_without_project"])
        self.assertEqual(client.get(f"/api/v2/projects/{self.project.pk}/").status_code, 404)
        result = client.patch(self.url, {"status": str(self.done.pk)}, format="json")
        self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual(client.patch(self.url, {"assignee_assignment": str(self.member.pk)}, format="json").status_code, 403)
        unrelated = Task.objects.create(unit=self.unit, title="Privada", status=self.todo, created_by_assignment=self.creator)
        self.assertEqual(client.get(f"/api/v2/tasks/{unrelated.pk}/").status_code, 404)

    def test_create_with_cross_department_responsible(self):
        response = self.client_for(self.owner).post("/api/v2/tasks/", {
            "unit": str(self.unit.pk), "title": "Entre departamentos", "status": str(self.todo.pk), "priority": "medium",
            "assignee_assignment": str(self.cross.pk),
        }, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        task = Task.objects.get(pk=response.data["id"])
        self.assertEqual(task.unit_id, self.unit.pk)
        self.assertEqual(task.assignee_assignment_id, self.cross.pk)
        self.cross.is_active = False
        self.cross.save(update_fields=["is_active"])
        rejected = self.client_for(self.owner).patch(self.url, {"assignee_assignment": str(self.cross.pk)}, format="json")
        self.assertEqual(rejected.status_code, 400, rejected.data)

    def test_responsible_reassignment_invalidates_both_external_units_without_task_details(self):
        from unittest.mock import patch
        old = self.identity("previous", unit=self.other_unit)
        third_unit = OrganizationalUnit.objects.create(name="Tercer equipo", sensitivity_level="low", unit_type="department")
        new = self.identity("next", unit=third_unit)
        self.task.assignee_assignment = old
        self.task.save()
        with patch("boldApp.tareas.signals.dispatch_resource_invalidation") as dispatch:
            with self.captureOnCommitCallbacks(execute=True):
                self.task.assignee_assignment = new
                self.task.save()
        args = dispatch.call_args.args
        self.assertEqual(set(args[0]), {self.other_unit.pk, third_unit.pk})
        self.assertEqual(args[2:], ("task", self.task.pk, {}))

    def test_cross_department_comment_requires_shared_task_own_policy_and_no_deny(self):
        permission = Permission.objects.get(code="tasks.comment.create")
        JobRolePermission.objects.create(job_role=self.role,permission=permission,effect="allow",scope_type="own_unit")
        TaskFollower.objects.create(task=self.task,assignment=self.cross,added_by_assignment=self.creator)
        client = self.client_for(self.cross)
        response = client.post("/api/v2/comments/", {"task":str(self.task.pk),"body":"Comentario entre equipos"}, format="json")
        self.assertEqual(response.status_code,201,response.data)
        deny = JobRolePermission.objects.create(job_role=self.role,permission=permission,effect="deny",scope_type="specific_unit",target_unit=self.unit)
        self.assertEqual(client.post("/api/v2/comments/", {"task":str(self.task.pk),"body":"Denegado"}, format="json").status_code,403)
        deny.delete()
        self.task.followers.filter(assignment=self.cross).delete()
        self.assertEqual(client.post("/api/v2/comments/", {"task":str(self.task.pk),"body":"Sin compartir"}, format="json").status_code,403)

    def test_shared_task_list_batches_membership_checks_and_detail_filters_first(self):
        from django.db import connection
        from django.test.utils import CaptureQueriesContext
        tasks = Task.objects.bulk_create([Task(unit=self.unit, status=self.todo, title=f"Compartida {i}", created_by_assignment=self.creator) for i in range(40)])
        TaskFollower.objects.bulk_create([TaskFollower(task=task, assignment=self.cross, added_by_assignment=self.creator) for task in tasks[:20]])
        client = self.client_for(self.cross)
        with CaptureQueriesContext(connection) as queries:
            response = client.get("/api/v2/tasks/?limit=100")
        self.assertEqual(response.status_code, 200)
        self.assertLess(len(queries), 70)
        ids = {row["id"] for row in response.data["results"]}
        self.assertTrue({str(task.pk) for task in tasks[:20]} <= ids)
        self.assertFalse({str(task.pk) for task in tasks[20:]} & ids)
        with CaptureQueriesContext(connection) as queries:
            self.assertEqual(client.get(f"/api/v2/tasks/{tasks[0].pk}/").status_code, 200)
        self.assertLess(len(queries), 35)
        self.assertEqual(client.get("/api/v2/tasks/invalid-id/").status_code, 404)

    def test_other_department_project_invitation_shares_only_that_project_and_its_tasks(self):
        owner = self.client_for(self.owner)
        result = owner.patch(f"/api/v2/projects/{self.project.pk}/", {"member_ids":[str(self.cross.pk)]}, format="json")
        self.assertEqual(result.status_code,200,result.data)
        client = self.client_for(self.cross)
        self.assertEqual(client.get(f"/api/v2/projects/{self.project.pk}/").status_code,200)
        self.assertEqual(client.get(self.url).status_code,200)
        self.assertEqual(client.patch(self.url,{"title":"No soy editor"},format="json").status_code,403)
        unrelated = Task.objects.create(unit=self.unit,title="Fuera del proyecto",status=self.todo,created_by_assignment=self.creator)
        self.assertEqual(client.get(f"/api/v2/tasks/{unrelated.pk}/").status_code,404)
        self.assertEqual(client.patch(f"/api/v2/projects/{self.project.pk}/",{"name":"No administrar"},format="json").status_code,403)
        owner.patch(f"/api/v2/projects/{self.project.pk}/",{"member_ids":[]},format="json")
        self.assertEqual(client.get(self.url).status_code,404)
