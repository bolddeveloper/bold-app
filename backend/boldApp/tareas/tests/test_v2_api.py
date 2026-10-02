from asgiref.sync import async_to_sync
from channels.testing import WebsocketCommunicator
from channels.layers import get_channel_layer
from django.core.management import call_command
from django.test import TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from django.test import RequestFactory
from django.db import connection
from django.test.utils import CaptureQueriesContext
from unittest.mock import patch
from types import SimpleNamespace

from boldApp.autenticacion.services import create_session, issue_ws_ticket
from boldApp.core.models import (
    JobRolePermission,
    OrganizationalUnit,
    Permission,
    PositionAssignment,
    UserAccount,
)
from boldApp.tareas.models import Attachment, Comment, Project, ProjectMember, Section, Tag, Task, TaskFollower, TaskProject, TaskStatus, TaskTag
from boldApp.tareas.management.commands.seed_demo_data import DEMO_PEOPLE
from config.asgi import application
from boldApp.tareas.views import AssignmentScopedViewSetMixin, resolve_access


@override_settings(SECURE_SSL_REDIRECT=False, DEBUG=True)
class TasksV2ApiTests(TransactionTestCase):
    reset_sequences = True

    def setUp(self):
        call_command("seed_demo_data", verbosity=0)
        self.client = APIClient()
        self.ana = UserAccount.objects.get(email="ana@bold.gt")
        self.david = UserAccount.objects.get(email="david@bold.gt")
        self.actor = UserAccount.objects.get(email="developer@bold.gt")
        self.ana_assignment = PositionAssignment.objects.get(employee=self.ana.employee, is_active=True)
        self.david_assignment = PositionAssignment.objects.get(employee=self.david.employee, is_active=True)
        self.actor_assignment = PositionAssignment.objects.get(employee=self.actor.employee, is_active=True)
        _, self.auth_session = create_session(self.actor, RequestFactory().get("/", REMOTE_ADDR="127.0.0.1"))
        self.client.force_authenticate(user=self.actor, token=self.auth_session)
        self.client.credentials(
            HTTP_X_ASSIGNMENT_ID=str(self.actor_assignment.id),
        )
        self.marketing = OrganizationalUnit.objects.get(name="Marketing")
        self.operations = OrganizationalUnit.objects.get(name="Operaciones")
        self.ops_project = Project.objects.get(name="Rediseno web")
        self.ops_section = Section.objects.get(project=self.ops_project, name="todo")
        self.marketing_status = TaskStatus.objects.get(unit=self.marketing, category="todo")
        self.ops_status = TaskStatus.objects.get(unit=self.operations, category="in_progress")

    def task_payload(self):
        return {
            "unit": str(self.marketing.id),
            "assignee_assignment": str(self.ana_assignment.id),
            "status": str(self.marketing_status.id),
            "title": "Entrega conjunta",
            "priority": "high",
            "project": str(self.ops_project.id),
            "section": str(self.ops_section.id),
            "project_position": "1.0000000000",
        }

    def test_scoped_read_authorizes_only_candidate_tasks(self):
        task = Task.objects.create(unit=self.marketing, status=self.marketing_status, title="Consulta medida", priority="medium", created_by_assignment=self.ana_assignment)
        Task.objects.bulk_create([Task(unit=self.operations, status=self.ops_status, title=f"Otra tarea {index}", priority="medium", created_by_assignment=self.david_assignment) for index in range(30)])
        comment = Comment.objects.create(task=task, author_assignment=self.ana_assignment, body="Comentario medido")
        candidate_counts = []
        for endpoint, param in (("tasks", "ids"), ("comments", "tasks")):
            with patch("boldApp.tareas.views.resolve_access", wraps=resolve_access) as resolver, CaptureQueriesContext(connection) as queries:
                response = self.client.get(f"/api/v2/{endpoint}/", {param: str(task.id)})
            self.assertEqual(response.status_code, 200, response.data)
            print(f"SQL scoped {endpoint}: {len(queries)} queries; {resolver.call_count} authorization candidates")
            candidate_counts.append(resolver.call_count)
            self.assertEqual(len(response.data["results"]), 1)
            if endpoint == "comments":
                self.assertEqual(str(response.data["results"][0]["id"]), str(comment.id))
        self.assertEqual(candidate_counts, [1, 1])

    def test_catalog_hierarchy_does_not_query_each_ancestor(self):
        root = self.operations
        for index in range(12):
            root = OrganizationalUnit.objects.create(name=f"Profundidad {index}", parent_unit=root)
        view = AssignmentScopedViewSetMixin()
        view.request = SimpleNamespace(assignment=self.actor_assignment)
        with CaptureQueriesContext(connection) as queries:
            view.allowed_unit_ids("tasks.catalog.read")
        hierarchy_reads = [query for query in queries if 'FROM "organizational_units"' in query["sql"]]
        print(f"SQL catalog hierarchy: {len(hierarchy_reads)} organizational-unit queries")
        self.assertLessEqual(len(hierarchy_reads), 2)

    def test_request_visibility_cache_is_isolated_by_candidates_and_rejects_cycles(self):
        first = Task.objects.create(unit=self.marketing, status=self.marketing_status, title="Primera", priority="medium", created_by_assignment=self.ana_assignment)
        second = Task.objects.create(unit=self.operations, status=self.ops_status, title="Segunda", priority="medium", created_by_assignment=self.david_assignment)
        view = AssignmentScopedViewSetMixin()
        view.request = SimpleNamespace(assignment=self.actor_assignment)
        self.assertEqual(list(view.visible_tasks(Task.objects.filter(pk=first.id)).values_list("id", flat=True)), [first.id])
        self.assertEqual(list(view.visible_tasks(Task.objects.filter(pk=second.id)).values_list("id", flat=True)), [second.id])
        child = OrganizationalUnit.objects.create(name="Ciclo de prueba", parent_unit=self.operations)
        OrganizationalUnit.objects.filter(pk=self.operations.id).update(parent_unit=child)
        owner = PositionAssignment.objects.get(employee__user_account__email="luis@bold.gt", is_active=True)
        view = AssignmentScopedViewSetMixin()
        view.request = SimpleNamespace(assignment=owner)
        self.assertEqual(list(view.visible_tasks(Task.objects.filter(pk=second.id))), [])

    def test_incremental_task_and_relation_filters_do_not_expand_visibility(self):
        task = Task.objects.create(unit=self.marketing, status=self.marketing_status, title="Tarea visible", priority="medium", created_by_assignment=self.ana_assignment)
        other = Task.objects.create(unit=self.operations, status=self.ops_status, title="Tarea de otra unidad", priority="medium", created_by_assignment=self.david_assignment)
        comment = Comment.objects.create(task=task, author_assignment=self.ana_assignment, body="Solo esta tarea")
        foreign_comment = Comment.objects.create(task=other, author_assignment=self.david_assignment, body="Otra unidad")
        attachment = Attachment.objects.create(task=task, uploaded_by_assignment=self.ana_assignment,
            file_name="Prueba", file_url="https://example.com/file", mime_type="text/plain", size_bytes=1)
        tag = Tag.objects.create(unit=self.marketing, name="Filtro incremental")
        task_tag = TaskTag.objects.create(task=task, tag=tag, added_by_assignment=self.ana_assignment)
        _, session = create_session(self.ana, RequestFactory().get("/", REMOTE_ADDR="127.0.0.1"))
        client = APIClient()
        client.force_authenticate(self.ana, session)
        client.credentials(HTTP_X_ASSIGNMENT_ID=str(self.ana_assignment.id))
        listed = client.get("/api/v2/tasks/", {"ids": f"{task.id},{other.id}"})
        self.assertEqual(listed.status_code, 200, listed.data)
        self.assertEqual({str(row["id"]) for row in listed.data["results"]}, {str(task.id)})
        for endpoint, expected in (("comments", comment.id), ("attachments", attachment.id), ("task-tags", task_tag.id)):
            response = client.get(f"/api/v2/{endpoint}/", {"tasks": f"{task.id},{other.id}"})
            self.assertEqual(response.status_code, 200, response.data)
            self.assertEqual({str(row["task"]) for row in response.data["results"]}, {str(task.id)})
            self.assertIn(str(expected), {str(row["id"]) for row in response.data["results"]})
        response = client.get("/api/v2/comments/", {"tasks": str(other.id)})
        self.assertEqual(response.data["results"], [])
        self.assertNotIn(str(foreign_comment.id), {str(row["id"]) for row in response.data["results"]})
        for endpoint in ("task-followers", "task-projects"):
            response = self.client.get(f"/api/v2/{endpoint}/", {"tasks": str(task.id)})
            self.assertEqual(response.status_code, 200, response.data)
            self.assertTrue(all(str(row["task"]) == str(task.id) for row in response.data["results"]))

    def test_catalog_batch_matches_single_unit_authorization(self):
        JobRolePermission.objects.filter(job_role=self.ana_assignment.position.job_role,
            permission__code="tasks.catalog.read").delete()
        _, session = create_session(self.ana, RequestFactory().get("/", REMOTE_ADDR="127.0.0.1"))
        client = APIClient()
        client.force_authenticate(self.ana, session)
        client.credentials(HTTP_X_ASSIGNMENT_ID=str(self.ana_assignment.id))
        units = f"{self.marketing.id},{self.operations.id}"
        response = client.get("/api/v2/task-statuses/", {"units": units})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertGreater(len(response.data["results"]), 0)
        self.assertTrue(all(row["unit"] is None or str(row["unit"]) == str(self.marketing.id) for row in response.data["results"]))
        response = client.get("/api/v2/tags/", {"units": units})
        self.assertEqual(response.data["results"], [])

    def test_incremental_filters_reject_invalid_or_oversized_ids(self):
        for endpoint, param in (("tasks", "ids"), ("comments", "tasks"), ("task-statuses", "units"), ("tags", "units")):
            for value in ("", "not-a-uuid", ",".join([str(self.marketing.id)] * 51)):
                response = self.client.get(f"/api/v2/{endpoint}/", {param: value})
                self.assertEqual(response.status_code, 400, response.data)

    def test_relation_invalidations_reach_two_clients_with_identifiers_only(self):
        task = Task.objects.create(unit=self.marketing, status=self.marketing_status, title="Evento privado", priority="medium", created_by_assignment=self.ana_assignment)
        layer = get_channel_layer()
        clients = [async_to_sync(layer.new_channel)() for _ in range(2)]
        for channel in clients:
            async_to_sync(layer.group_add)(f"unit_{task.unit_id}", channel)
        attachment = Attachment.objects.create(task=task, uploaded_by_assignment=self.ana_assignment,
            file_name="No difundir", file_url="https://example.com/private", mime_type="text/plain", size_bytes=1)
        envelopes = [async_to_sync(layer.receive)(channel)["envelope"] for channel in clients]
        self.assertEqual(envelopes[0]["event_id"], envelopes[1]["event_id"])
        self.assertEqual(envelopes[0]["event_type"], "attachment.changed")
        self.assertEqual(envelopes[0]["payload"], {"tasks": [str(task.id)]})
        attachment.delete()
        self.assertEqual(async_to_sync(layer.receive)(clients[0])["envelope"]["event_type"], "attachment.changed")

    def test_resource_invalidations_are_discarded_on_rollback(self):
        from django.db import transaction
        from unittest.mock import patch

        with patch("boldApp.tareas.signals.dispatch_resource_invalidation") as dispatch:
            try:
                with transaction.atomic():
                    Section.objects.create(project=self.ops_project, name="No guardar", position=9999)
                    self.assertFalse(dispatch.called)
                    raise RuntimeError("rollback")
            except RuntimeError:
                pass
            self.assertFalse(dispatch.called)

    def test_incremental_querysets_have_a_unique_pagination_tiebreaker(self):
        from boldApp.tareas.views import AssignmentScopedViewSetMixin

        helper = AssignmentScopedViewSetMixin()
        for model in (Project, ProjectMember, Section, Task, TaskStatus, TaskFollower, TaskProject, Comment, Attachment, Tag, TaskTag):
            queryset = helper.stable_order(model.objects.all())
            self.assertTrue(queryset.ordered)
            self.assertEqual(queryset.query.order_by[-1], "pk")

    def test_seed_includes_idempotent_samuel_authentication_account(self):
        samuel = UserAccount.objects.get(email="samuel@bold.gt")
        assignment = PositionAssignment.objects.get(employee=samuel.employee, is_active=True, released_at__isnull=True)
        self.assertEqual(assignment.position.unit.name, "Marketing")
        self.assertTrue(samuel.check_password("bolddemo123"))

        samuel.set_password("Contraseña local preservada 2026!")
        samuel.save(update_fields=["password"])
        call_command("seed_demo_data", verbosity=0)
        samuel.refresh_from_db()
        self.assertTrue(samuel.check_password("Contraseña local preservada 2026!"))
        self.assertEqual(UserAccount.objects.filter(email="samuel@bold.gt").count(), 1)
        self.assertEqual(PositionAssignment.objects.filter(employee=samuel.employee, is_active=True, released_at__isnull=True).count(), 1)

    def test_seed_includes_owner_and_high_management_demo_accounts(self):
        luis = UserAccount.objects.get(email="luis@bold.gt")
        paulus = UserAccount.objects.get(email="paulus@bold.gt")
        self.assertTrue(luis.is_staff)
        self.assertTrue(luis.is_superuser)
        self.assertTrue(luis.check_password("LuisBold2026!"))
        self.assertEqual(luis.employee.position_assignments.get(is_active=True).position.job_role.title, "Propietario")
        self.assertFalse(paulus.is_staff)
        self.assertFalse(paulus.is_superuser)
        self.assertTrue(paulus.check_password("PaulusBold2026!"))
        self.assertEqual(paulus.employee.position_assignments.get(is_active=True).position.job_role.title, "Alta Gerencia")

        luis.set_password("Contraseña de dueño modificada 2026!")
        luis.save(update_fields=["password"])
        call_command("seed_demo_data", verbosity=0)
        luis.refresh_from_db()
        self.assertTrue(luis.check_password("Contraseña de dueño modificada 2026!"))

    def test_owner_can_list_and_manage_projects_across_departments(self):
        owner = UserAccount.objects.get(email="luis@bold.gt")
        owner_assignment = PositionAssignment.objects.get(
            employee=owner.employee,
            is_active=True,
            released_at__isnull=True,
        )
        _, owner_session = create_session(
            owner,
            RequestFactory().get("/", REMOTE_ADDR="127.0.0.1"),
        )
        client = APIClient()
        client.force_authenticate(owner, owner_session)
        client.credentials(HTTP_X_ASSIGNMENT_ID=str(owner_assignment.id))

        listed = client.get("/api/v2/projects/")
        self.assertEqual(listed.status_code, 200, listed.data)
        listed_units = {str(row["unit"]) for row in listed.data["results"]}
        self.assertIn(str(self.marketing.id), listed_units)
        self.assertIn(str(self.operations.id), listed_units)

        created = client.post(
            "/api/v2/projects/",
            {
                "unit": str(self.marketing.id),
                "owner_assignment": str(self.ana_assignment.id),
                "name": "Proyecto global del propietario",
                "status": "Activo",
            },
            format="json",
        )
        self.assertEqual(created.status_code, 201, created.data)
        edited = client.patch(
            f"/api/v2/projects/{self.ops_project.id}/",
            {"description": "Seguimiento actualizado por Dirección"},
            format="json",
        )
        self.assertEqual(edited.status_code, 200, edited.data)

    def test_project_members_must_belong_to_project_unit(self):
        ProjectMember.objects.filter(
            project=self.ops_project,
            assignment=self.david_assignment,
        ).delete()
        valid = self.client.post(
            "/api/v2/project-members/",
            {
                "project": str(self.ops_project.id),
                "assignment": str(self.david_assignment.id),
                "member_role": "member",
                "status": "active",
            },
            format="json",
        )
        self.assertEqual(valid.status_code, 201, valid.data)

        invalid = self.client.post(
            "/api/v2/project-members/",
            {
                "project": str(self.ops_project.id),
                "assignment": str(self.ana_assignment.id),
                "member_role": "member",
                "status": "active",
            },
            format="json",
        )
        self.assertEqual(invalid.status_code, 400, invalid.data)
        self.assertIn("assignment", invalid.data)
        self.assertFalse(
            ProjectMember.objects.filter(
                project=self.ops_project,
                assignment=self.ana_assignment,
            ).exists()
        )

    def test_task_creator_can_list_required_statuses_without_catalog_permission(self):
        role = self.ana_assignment.position.job_role
        JobRolePermission.objects.filter(
            job_role=role,
            permission__code="tasks.catalog.read",
        ).delete()
        self.assertTrue(
            JobRolePermission.objects.filter(
                job_role=role,
                permission__code="tasks.task.create",
                effect=JobRolePermission.EFFECT_ALLOW,
            ).exists()
        )

        _, session = create_session(
            self.ana,
            RequestFactory().get("/", REMOTE_ADDR="127.0.0.1"),
        )
        client = APIClient()
        client.force_authenticate(self.ana, session)
        client.credentials(HTTP_X_ASSIGNMENT_ID=str(self.ana_assignment.id))

        response = client.get(f"/api/v2/task-statuses/?unit={self.marketing.id}")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertGreater(len(response.data["results"]), 0)

    def test_owner_can_create_tasks_in_a_newly_created_unit(self):
        owner = UserAccount.objects.get(email="luis@bold.gt")
        owner_assignment = PositionAssignment.objects.get(
            employee=owner.employee,
            is_active=True,
            released_at__isnull=True,
        )
        new_unit = OrganizationalUnit.objects.create(
            name="Finanzas",
            unit_type=self.marketing.unit_type,
            sensitivity_level=self.marketing.sensitivity_level,
        )
        statuses = TaskStatus.objects.filter(unit=new_unit)
        self.assertEqual(statuses.count(), 3)
        initial_status = statuses.get(category="todo")

        _, owner_session = create_session(
            owner,
            RequestFactory().get("/", REMOTE_ADDR="127.0.0.1"),
        )
        client = APIClient()
        client.force_authenticate(owner, owner_session)
        client.credentials(HTTP_X_ASSIGNMENT_ID=str(owner_assignment.id))

        listed = client.get(f"/api/v2/task-statuses/?unit={new_unit.id}")
        self.assertEqual(listed.status_code, 200, listed.data)
        self.assertEqual(len(listed.data["results"]), 3)
        created = client.post(
            "/api/v2/tasks/",
            {
                "unit": str(new_unit.id),
                "status": str(initial_status.id),
                "title": "Preparar cierre financiero",
                "priority": "high",
            },
            format="json",
        )
        self.assertEqual(created.status_code, 201, created.data)

    def test_collaborator_can_mutate_only_tasks_created_by_its_assignment(self):
        collaborator_role = self.ana_assignment.position.job_role
        managed_codes = {
            "tasks.task.update",
            "tasks.task.delete",
            "tasks.task.assign",
        }

        JobRolePermission.objects.filter(
            job_role=collaborator_role,
            permission__code__in=managed_codes,
        ).delete()
        update_permission = Permission.objects.get(code="tasks.task.update")
        JobRolePermission.objects.create(
            job_role=collaborator_role,
            permission=update_permission,
            effect=JobRolePermission.EFFECT_ALLOW,
            scope_type=JobRolePermission.SCOPE_CREATED_BY_ME,
        )

        carla = UserAccount.objects.get(email="carla@bold.gt")
        carla_assignment = PositionAssignment.objects.get(employee=carla.employee, is_active=True)
        own_task = Task.objects.create(
            unit=self.marketing,
            created_by_assignment=self.ana_assignment,
            assignee_assignment=self.ana_assignment,
            status=self.marketing_status,
            title="Tarea creada por Ana",
            priority="medium",
        )
        foreign_task = Task.objects.create(
            unit=self.marketing,
            created_by_assignment=carla_assignment,
            assignee_assignment=self.ana_assignment,
            status=self.marketing_status,
            title="Tarea creada por Carla",
            priority="medium",
        )

        _, session = create_session(
            self.ana,
            RequestFactory().get("/", REMOTE_ADDR="127.0.0.1"),
        )
        client = APIClient()
        client.force_authenticate(self.ana, session)
        client.credentials(HTTP_X_ASSIGNMENT_ID=str(self.ana_assignment.id))

        edited = client.patch(
            f"/api/v2/tasks/{own_task.id}/",
            {"title": "Tarea propia editada"},
            format="json",
        )
        self.assertEqual(edited.status_code, 200, edited.data)

        assign_without_permission = client.patch(
            f"/api/v2/tasks/{own_task.id}/",
            {"assignee_assignment": str(carla_assignment.id)},
            format="json",
        )
        self.assertEqual(assign_without_permission.status_code, 403)

        JobRolePermission.objects.create(
            job_role=collaborator_role,
            permission=Permission.objects.get(code="tasks.task.assign"),
            effect=JobRolePermission.EFFECT_ALLOW,
            scope_type=JobRolePermission.SCOPE_CREATED_BY_ME,
        )
        assigned = client.patch(
            f"/api/v2/tasks/{own_task.id}/",
            {"assignee_assignment": str(carla_assignment.id)},
            format="json",
        )
        self.assertEqual(assigned.status_code, 200, assigned.data)

        foreign_edit = client.patch(
            f"/api/v2/tasks/{foreign_task.id}/",
            {"title": "No debe cambiar"},
            format="json",
        )
        self.assertEqual(foreign_edit.status_code, 403)
        self.assertIn("solo permite modificar tareas creadas", foreign_edit.data["detail"])

        JobRolePermission.objects.create(
            job_role=collaborator_role,
            permission=Permission.objects.get(code="tasks.task.delete"),
            effect=JobRolePermission.EFFECT_ALLOW,
            scope_type=JobRolePermission.SCOPE_CREATED_BY_ME,
        )
        self.assertEqual(client.delete(f"/api/v2/tasks/{foreign_task.id}/").status_code, 403)
        self.assertEqual(client.delete(f"/api/v2/tasks/{own_task.id}/").status_code, 204)

    def test_bulk_create_update_delete_and_atomic_validation(self):
        payload = {key: value for key, value in self.task_payload().items() if key not in {"project", "section", "project_position"}}
        created = self.client.post("/api/v2/tasks/bulk/", {"operation": "create", "items": [{**payload, "title": "Uno"}, {**payload, "title": "Dos"}]}, format="json")
        self.assertEqual(created.status_code, 201, getattr(created, "data", None))
        ids = created.data["created"]
        changed = self.client.post("/api/v2/tasks/bulk/", {"operation": "update", "ids": ids, "changes": {"priority": "low"}}, format="json")
        self.assertEqual(changed.status_code, 200, getattr(changed, "data", None))
        self.assertEqual(Task.objects.filter(id__in=ids, priority="low").count(), 2)
        invalid = self.client.post("/api/v2/tasks/bulk/", {"operation": "update", "ids": ids, "changes": {"status": str(self.ops_status.id)}}, format="json")
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(Task.objects.filter(id__in=ids, priority="low").count(), 2)
        deleted = self.client.post("/api/v2/tasks/bulk/", {"operation": "delete", "ids": ids}, format="json")
        self.assertEqual(deleted.status_code, 200, getattr(deleted, "data", None))
        self.assertEqual(Task.all_objects.filter(id__in=ids, deleted_at__isnull=False).count(), 2)

    def test_bulk_parent_cycle_is_rejected(self):
        payload = {key: value for key, value in self.task_payload().items() if key not in {"project", "section", "project_position"}}
        created = self.client.post("/api/v2/tasks/bulk/", {"operation": "create", "items": [{**payload, "title": "Raiz"}, {**payload, "title": "Hija"}]}, format="json")
        self.assertEqual(created.status_code, 201, getattr(created, "data", None))
        root, child = created.data["created"]
        first = self.client.post("/api/v2/tasks/bulk/", {"operation": "update", "ids": [child], "changes": {"parent_task": root}}, format="json")
        self.assertEqual(first.status_code, 200, getattr(first, "data", None))
        cycle = self.client.post("/api/v2/tasks/bulk/", {"operation": "update", "ids": [root], "changes": {"parent_task": child}}, format="json")
        self.assertEqual(cycle.status_code, 400)
        self.assertIsNone(Task.objects.get(pk=root).parent_task_id)

    def test_bulk_project_link_and_invalid_ids(self):
        created = self.client.post("/api/v2/tasks/", self.task_payload(), format="json")
        self.assertEqual(created.status_code, 201, getattr(created, "data", None))
        task_id = created.data["id"]
        linked = self.client.post("/api/v2/tasks/bulk/", {"operation": "link", "ids": [task_id], "project": str(self.ops_project.id), "section": str(self.ops_section.id)}, format="json")
        self.assertEqual(linked.status_code, 200, getattr(linked, "data", None))
        self.assertEqual(TaskProject.objects.get(task_id=task_id, project=self.ops_project).section_id, self.ops_section.id)
        again = self.client.post("/api/v2/tasks/bulk/", {"operation": "link", "ids": [task_id], "project": str(self.ops_project.id)}, format="json")
        self.assertEqual(again.status_code, 200, getattr(again, "data", None))
        self.assertEqual(TaskProject.objects.get(task_id=task_id, project=self.ops_project).section_id, self.ops_section.id)
        invalid = self.client.post("/api/v2/tasks/bulk/", {"operation": "delete", "ids": ["not-a-uuid"]}, format="json")
        self.assertEqual(invalid.status_code, 400)
        self.assertTrue(Task.objects.filter(pk=task_id).exists())

    def test_bulk_create_rolls_back_when_a_later_item_is_invalid(self):
        payload = {key: value for key, value in self.task_payload().items() if key not in {"project", "section", "project_position"}}
        response = self.client.post("/api/v2/tasks/bulk/", {"operation": "create", "items": [{**payload, "title": "No debe quedar"}, {**payload, "title": "   "}]}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertFalse(Task.objects.filter(title="No debe quedar").exists())

    def test_requires_an_active_assignment_owned_by_the_account(self):
        foreign_client = APIClient()
        foreign_client.force_authenticate(user=self.actor, token=self.auth_session)
        foreign_client.credentials(
            HTTP_X_ASSIGNMENT_ID=str(self.david_assignment.id),
        )
        response = foreign_client.get("/api/v2/projects/")
        self.assertEqual(response.status_code, 403)

    def test_assignment_directory_is_paginated_and_exposes_only_safe_fields(self):
        response = self.client.get("/api/v2/core/position-assignments/directory/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["count"], len(DEMO_PEOPLE))
        self.assertIn("samuel@bold.gt", {row["employee_email"] for row in response.data["results"]})
        self.assertEqual(
            set(response.data["results"][0]),
            {
                "id", "employee", "employee_name", "employee_email", "unit", "unit_name",
                "job_role", "job_role_title", "account_is_superuser",
            },
        )

    def test_nonprivileged_seed_neutralizes_every_known_privileged_demo_account(self):
        with self.settings(
            DEBUG=False,
            SEED_DEMO_ACCOUNTS=True,
            SEED_PRIVILEGED_DEMO_ACCOUNTS=False,
        ):
            call_command("seed_demo_data", verbosity=0)

        for email in {"luis@bold.gt", "paulus@bold.gt", "developer@bold.gt"}:
            account = UserAccount.objects.get(email=email)
            self.assertFalse(account.is_active)
            self.assertFalse(account.is_staff)
            self.assertFalse(account.is_superuser)
            self.assertFalse(account.has_usable_password())

    def test_project_dates_validation_duplicate_names_and_empty_sections(self):
        payload = {
            "unit": str(self.marketing.id),
            "owner_assignment": str(self.ana_assignment.id),
            "name": "  Proyecto nuevo  ",
            "status": "Activo",
            "start_date": "2026-09-11",
            "end_date": "2026-09-30",
        }
        first = self.client.post("/api/v2/projects/", payload, format="json")
        second = self.client.post("/api/v2/projects/", payload, format="json")
        self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual(first.data["name"], "Proyecto nuevo")
        self.assertEqual(second.status_code, 201, second.data)
        self.assertEqual(second.data["name"], "Proyecto nuevo (2)")
        self.assertFalse(Section.objects.filter(project_id=first.data["id"]).exists())

        payload["name"] = "Rango incorrecto"
        payload["start_date"], payload["end_date"] = "2026-10-01", "2026-09-30"
        invalid = self.client.post("/api/v2/projects/", payload, format="json")
        self.assertEqual(invalid.status_code, 400)
        self.assertIn("end_date", invalid.data)

    def test_section_delete_unsections_tasks_and_task_titles_are_trimmed(self):
        response = self.client.post("/api/v2/tasks/", {**self.task_payload(), "title": "  Tarea limpia  "}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        task = Task.objects.get(id=response.data["id"])
        link = TaskProject.objects.get(task=task)
        self.assertEqual(task.title, "Tarea limpia")
        deleted = self.client.delete(f"/api/v2/sections/{self.ops_section.id}/")
        self.assertEqual(deleted.status_code, 204)
        link.refresh_from_db()
        self.assertIsNone(link.section_id)

        invalid = self.client.post("/api/v2/tasks/", {**self.task_payload(), "section": None, "title": "   "}, format="json")
        self.assertEqual(invalid.status_code, 400)
        self.assertIn("title", invalid.data)

    def test_webhook_secret_is_only_returned_when_endpoint_is_created(self):
        self.auth_session.mfa_verified_at = timezone.now()
        self.auth_session.auth_strength = "password_totp"
        self.auth_session.save(update_fields=["mfa_verified_at", "auth_strength"])
        created = self.client.post(
            "/api/v2/webhook-endpoints/",
            {
                "unit": str(self.marketing.id),
                "target_url": "http://127.0.0.1:9000/webhook",
                "event_types": ["task.created"],
                "is_active": True,
            },
            format="json",
        )
        self.assertEqual(created.status_code, 201, created.data)
        self.assertIn("secret", created.data)

        retrieved = self.client.get(f"/api/v2/webhook-endpoints/{created.data['id']}/")
        self.assertEqual(retrieved.status_code, 200, retrieved.data)
        self.assertNotIn("secret", retrieved.data)

    def test_creates_task_and_cross_unit_project_link_atomically(self):
        response = self.client.post("/api/v2/tasks/", self.task_payload(), format="json")
        self.assertEqual(response.status_code, 201, response.data)
        task = Task.objects.get(id=response.data["id"])
        link = TaskProject.objects.get(task=task)
        self.assertEqual(task.unit, self.marketing)
        self.assertEqual(link.project, self.ops_project)
        self.assertEqual(link.section, self.ops_section)
        self.assertEqual(task.created_by_assignment, self.actor_assignment)

    def test_projectless_task_follows_creator_by_default_and_allows_opt_out(self):
        base = {
            "unit": str(self.operations.id),
            "status": str(self.ops_status.id),
            "title": "Tarea sin proyecto ni responsable",
            "priority": "medium",
        }
        created = self.client.post("/api/v2/tasks/", base, format="json")
        self.assertEqual(created.status_code, 201, created.data)
        task = Task.objects.get(id=created.data["id"])
        self.assertIsNone(task.assignee_assignment)
        follower = TaskFollower.objects.get(task=task, assignment=self.actor_assignment)

        removed = self.client.delete(f"/api/v2/task-followers/{follower.id}/")
        self.assertEqual(removed.status_code, 204, getattr(removed, "data", None))
        self.assertEqual(task.created_by_assignment, self.actor_assignment)
        self.assertIn(str(task.id), {str(row["id"]) for row in self.client.get("/api/v2/tasks/").data["results"]})

        opted_out = self.client.post("/api/v2/tasks/", {**base, "follow_creator": False}, format="json")
        self.assertEqual(opted_out.status_code, 201, opted_out.data)
        self.assertFalse(TaskFollower.objects.filter(task_id=opted_out.data["id"]).exists())

        bulk = self.client.post("/api/v2/tasks/bulk/", {"operation": "create", "items": [base]}, format="json")
        self.assertEqual(bulk.status_code, 201, bulk.data)
        self.assertTrue(TaskFollower.objects.filter(task_id=bulk.data["created"][0], assignment=self.actor_assignment).exists())

    def test_rejects_a_status_from_another_unit(self):
        payload = self.task_payload()
        payload["status"] = str(self.ops_status.id)
        response = self.client.post("/api/v2/tasks/", payload, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("status", response.data)

    def test_moves_responsibility_to_another_unit(self):
        created = self.client.post("/api/v2/tasks/", self.task_payload(), format="json")
        task_id = created.data["id"]
        response = self.client.post(
            f"/api/v2/tasks/{task_id}/move/",
            {
                "unit": str(self.operations.id),
                "assignee_assignment": str(self.david_assignment.id),
                "status": str(self.ops_status.id),
                "project": str(self.ops_project.id),
                "section": str(self.ops_section.id),
                "position": "2.0000000000",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        task = Task.objects.get(id=task_id)
        self.assertEqual(task.unit, self.operations)
        self.assertEqual(task.assignee_assignment, self.david_assignment)

    def test_websocket_requires_single_use_ticket_and_matching_assignment(self):
        valid_ticket = issue_ws_ticket(self.actor, self.auth_session, self.actor_assignment.id, self.operations.id)
        invalid_ticket = issue_ws_ticket(self.actor, self.auth_session, self.david_assignment.id, self.operations.id)
        async def checks():
            valid = WebsocketCommunicator(
                application,
                f"/ws/unit/{self.operations.id}/?ticket={valid_ticket}",
                headers=[(b"origin", b"http://localhost:5173")],
            )
            connected, _ = await valid.connect()
            self.assertTrue(connected)
            await valid.disconnect()

            invalid = WebsocketCommunicator(
                application,
                f"/ws/unit/{self.operations.id}/?ticket={invalid_ticket}",
                headers=[(b"origin", b"http://localhost:5173")],
            )
            connected, _ = await invalid.connect()
            self.assertFalse(connected)

        async_to_sync(checks)()

    def test_handoff_notifies_both_responsible_units(self):
        created = self.client.post("/api/v2/tasks/", self.task_payload(), format="json")
        task_id = created.data["id"]
        layer = get_channel_layer()
        old_channel = async_to_sync(layer.new_channel)()
        new_channel = async_to_sync(layer.new_channel)()
        async_to_sync(layer.group_add)(f"unit_{self.marketing.id}", old_channel)
        async_to_sync(layer.group_add)(f"unit_{self.operations.id}", new_channel)

        response = self.client.post(
            f"/api/v2/tasks/{task_id}/move/",
            {
                "unit": str(self.operations.id),
                "assignee_assignment": str(self.david_assignment.id),
                "status": str(self.ops_status.id),
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        old_event = async_to_sync(layer.receive)(old_channel)
        new_event = async_to_sync(layer.receive)(new_channel)
        self.assertEqual(old_event["envelope"]["event_type"], "task.status_changed")
        self.assertEqual(new_event["envelope"]["event_type"], "task.status_changed")
        self.assertEqual(old_event["envelope"]["event_version"], 2)

    def test_board_move_notifies_two_clients_without_changing_task_status(self):
        created = self.client.post("/api/v2/tasks/", self.task_payload(), format="json")
        task = Task.objects.get(id=created.data["id"])
        link = TaskProject.objects.get(task=task)
        layer = get_channel_layer()
        clients = [async_to_sync(layer.new_channel)() for _ in range(2)]
        for channel in clients:
            async_to_sync(layer.group_add)(f"unit_{task.unit_id}", channel)
        response = self.client.patch(
            f"/api/v2/task-projects/{link.id}/",
            {"section": None, "position": "2000.0000000000"}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        task.refresh_from_db()
        self.assertEqual(task.status_id, self.marketing_status.id)
        events = [async_to_sync(layer.receive)(channel)["envelope"] for channel in clients]
        self.assertEqual(events[0]["event_type"], "task.updated")
        self.assertEqual(events[0]["event_id"], events[1]["event_id"])

    @override_settings(CORS_ALLOWED_ORIGINS=["http://localhost:5173"])
    def test_browser_cors_allows_assignment_header(self):
        response = self.client.options(
            "/api/v2/tasks/", HTTP_ORIGIN="http://localhost:5173",
            HTTP_ACCESS_CONTROL_REQUEST_METHOD="POST",
            HTTP_ACCESS_CONTROL_REQUEST_HEADERS="authorization,content-type,x-assignment-id",
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("x-assignment-id", response["Access-Control-Allow-Headers"])
