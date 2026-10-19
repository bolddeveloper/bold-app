from copy import deepcopy
from datetime import timedelta
from hashlib import md5
import json
from types import SimpleNamespace
from unittest.mock import patch
import uuid

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.test import APIClient

from boldApp.core.models import Employee, JobRole, JobRolePermission, OrganizationalUnit, Permission, Position, PositionAssignment, UserAccount
from boldApp.hojas.document import add_block, address, agenda, blocks, cell_at, columns, decorate, duplicate, put_cell, row_values, set_value, validate_document
from boldApp.hojas.drive import EXTERNAL, apply_review, check_external, sync, update_external, error_message
from boldApp.hojas.models import ImportReview, Member, Operation, Revision, TaskLink, Workbook
from boldApp.hojas.task_bridge import refresh_from_task
from boldApp.tareas.models import Comment, Task, TaskFollower, TaskStatus
from boldApp.workspace.service import GoogleUnavailable


@override_settings(DEBUG=True, SECURE_SSL_REDIRECT=False, SHEETS_AGENDA_SOURCE="")
class SheetsTests(TestCase):
    def setUp(self):
        self.unit = OrganizationalUnit.objects.create(name="Hojas IT", unit_type="department", sensitivity_level="low")
        self.role = JobRole.objects.create(title="Responsable", level="owner")
        self.actor = self.person("owner@bold.gt", "Propietario", True)
        self.client = APIClient()
        self.login(self.actor)
        self.status = TaskStatus.objects.create(unit=self.unit, name="Pendiente", category="todo", position=1, is_final=False)
        self.document = agenda()
        self.sheet, self.block = next(blocks(self.document))
        self.block["columns"] = columns("tasks")
        decorate(self.sheet, self.block)
        self.file = Workbook.objects.create(id=self.document["id"], name=self.document["name"], document=self.document, owner=self.actor.employee.user_account, creator=self.actor, initial_agenda=True)
        self.row = self.block["rowIds"][0]

    def person(self, email, name, owner=False):
        employee = Employee.objects.create(full_name=name)
        UserAccount.objects.create_user(email=email, password="Prepared-test-password-2026!", employee=employee, is_superuser=owner, is_staff=owner)
        return PositionAssignment.objects.create(employee=employee, position=Position.objects.create(unit=self.unit, job_role=self.role))

    def login(self, actor):
        self.client.force_authenticate(actor.employee.user_account)
        self.client.credentials(HTTP_X_ASSIGNMENT_ID=str(actor.id))

    def operation(self, changes, revision=None, identity=None):
        self.file.refresh_from_db()
        return self.client.post(f"/api/v2/sheets/files/{self.file.id}/operations/", {"id": identity or str(uuid.uuid4()), "revision": self.file.revision if revision is None else revision, "changes": changes}, format="json")

    def edit(self, key, value, before=None, row=None):
        self.file.refresh_from_db()
        sheet = self.file.document["sheets"][self.sheet["id"]]
        block = sheet["__bold"]["blocks"][0]
        row = row or self.row
        from boldApp.hojas.document import address
        r, c = address(sheet, block, row, key)
        return {"kind": "cell", "sheet": sheet["id"], "block": block["id"], "row": row, "column": key, "before": cell_at(sheet, r, c) if before is None else before, "after": {"v": value}}

    def connect(self):
        configuration = {"enabled": True, "unit": str(self.unit.id), "status_map": {option["value"]: str(self.status.id) for option in columns("tasks")[6]["options"]}}
        result = self.operation([{"kind": "block.configure", "sheet": self.sheet["id"], "block": self.block["id"], "configuration": {"task": configuration}}])
        self.assertEqual(result.status_code, 200, result.data)

    def test_create_template_without_drive_and_retry_is_idempotent(self):
        identity = str(uuid.uuid4())
        payload = {"id": identity, "name": "Mi plantilla", "is_template": True, "template": "agenda"}
        with patch("boldApp.hojas.views.drive.valid_folder") as folder, patch("boldApp.hojas.views.drive.google") as google:
            response = self.client.post("/api/v2/sheets/files/", payload, format="json")
            self.assertEqual(response.status_code, 201, response.data)
            self.assertEqual(self.client.post("/api/v2/sheets/files/", payload, format="json").status_code, 200)
            folder.assert_not_called()
            google.assert_not_called()
        template = Workbook.objects.get(pk=identity)
        self.assertTrue(template.is_template)
        self.assertIsNone(template.drive_account_id)
        self.assertEqual(len(template.document["sheetOrder"]), 6)
        self.assertEqual(Task.objects.count(), 0)
        self.assertEqual(self.client.patch(f"/api/v2/sheets/files/{identity}/", {"name": "Renombrada"}, format="json").status_code, 200)
        copied = self.client.post("/api/v2/sheets/files/", {"id": str(uuid.uuid4()), "name": "Copia", "is_template": True, "template": identity}, format="json")
        self.assertEqual(copied.status_code, 201, copied.data)
        self.assertNotEqual(copied.data["document"]["sheetOrder"], template.document["sheetOrder"])
        self.assertEqual(self.client.delete(f"/api/v2/sheets/files/{identity}/").status_code, 204)
        self.assertEqual(self.client.get(f"/api/v2/sheets/files/{identity}/").status_code, 403)
        self.assertEqual(self.client.get(f"/api/v2/sheets/files/{copied.data['id']}/").status_code, 200)
        restored = self.client.post(f"/api/v2/sheets/files/{identity}/restore/", {}, format="json")
        self.assertEqual(restored.status_code, 200, restored.data)
        self.assertTrue(restored.data["is_template"])

    def test_builtin_template_customization_and_removal_are_personal(self):
        endpoint = "/api/v2/sheets/files/template-agenda/"
        self.assertEqual(len(self.client.get("/api/v2/sheets/library/").data["templates"]), 1)
        first = self.client.post(endpoint, {}, format="json")
        self.assertEqual(first.status_code, 200, first.data)
        identity = first.data["id"]
        self.assertNotEqual(identity, str(self.file.id))
        self.assertEqual(self.client.post(endpoint, {}, format="json").data["id"], identity)
        self.assertEqual(self.client.get("/api/v2/sheets/library/").data["templates"], [])
        self.assertEqual(self.client.patch(f"/api/v2/sheets/files/{identity}/", {"name": "Agenda propia"}, format="json").status_code, 200)
        self.assertEqual(self.client.delete(endpoint, {}, format="json").status_code, 204)
        self.assertEqual(self.client.get("/api/v2/sheets/library/").data["templates"], [])
        blocked = self.client.post("/api/v2/sheets/files/", {"id": str(uuid.uuid4()), "name": "No recrear", "is_template": True, "template": "agenda"}, format="json")
        self.assertEqual(blocked.status_code, 403, blocked.data)
        self.file.refresh_from_db()
        self.assertIsNone(self.file.deleted_at)
        other = self.person("template-other@bold.gt", "Otra persona", True)
        self.login(other)
        self.assertEqual(len(self.client.get("/api/v2/sheets/library/").data["templates"]), 1)
        self.assertEqual(self.client.patch(f"/api/v2/sheets/files/{identity}/", {"name": "Prohibido"}, format="json").status_code, 404)
        self.login(self.actor)
        self.assertEqual(self.client.post(f"/api/v2/sheets/files/{identity}/restore/", {}, format="json").status_code, 200)
        self.assertEqual(self.client.get("/api/v2/sheets/library/").data["templates"], [])
        self.assertEqual(self.client.get(f"/api/v2/sheets/files/{identity}/").data["name"], "Agenda propia")

    def test_template_management_requires_module_permissions(self):
        person = self.person("template-denied@bold.gt", "Sin permisos")
        self.login(person)
        with patch("boldApp.hojas.access.check_and_log", return_value=SimpleNamespace(allowed=False)):
            for method, endpoint, payload in [
                ("post", "/api/v2/sheets/files/", {"id": str(uuid.uuid4()), "name": "Plantilla", "is_template": True}),
                ("post", "/api/v2/sheets/files/template-agenda/", {}),
                ("delete", "/api/v2/sheets/files/template-agenda/", {}),
            ]:
                response = getattr(self.client, method)(endpoint, payload, format="json")
                self.assertEqual(response.status_code, 403, response.data)
        self.assertFalse(Workbook.objects.filter(owner=person.employee.user_account).exists())

    def test_template_has_six_empty_sheets_and_copy_removes_assignments(self):
        self.assertEqual([self.document["sheets"][key]["name"] for key in self.document["sheetOrder"]], ["Liderazgo", "Procesos", "IT", "Herramientas", "Copia de Procesos", "Bold Lab"])
        self.assertEqual(Task.objects.count(), 0)
        set_value(self.sheet, self.block, self.row, "responsible", str(self.actor.id))
        copied = duplicate(self.document)
        self.assertNotEqual(copied["id"], self.document["id"])
        for sheet, block in blocks(copied):
            self.assertFalse(block["task"]["enabled"])
            for row in block["rowIds"]:
                self.assertFalse(row_values(sheet, block, row).get("responsible"))

    def test_selecting_responsible_creates_task_without_manual_connection_or_drive(self):
        self.assertEqual(self.operation([self.edit("title", "Crear al asignar"), self.edit("note", None)]).status_code, 200)
        self.assertEqual(Task.objects.count(), 0)
        response = self.operation([self.edit("responsible", str(self.actor.id))])
        self.assertEqual(response.status_code, 200, response.data)
        task = TaskLink.objects.get(workbook=self.file, row_id=self.row).task
        self.assertEqual(task.assignee_assignment_id, self.actor.id)
        self.assertEqual(task.status.category, "todo")
        self.assertEqual(Comment.objects.filter(task=task).count(), 0)
        configuration = response.data["document"]["sheets"][self.sheet["id"]]["__bold"]["blocks"][0]["task"]
        self.assertTrue(configuration["enabled"])
        self.assertEqual(configuration["unit"], str(self.unit.id))
        self.assertFalse(self.file.drive_account_id)

    def test_each_row_uses_responsible_department_and_preserves_task_on_reassignment(self):
        other_unit = OrganizationalUnit.objects.create(name="Marketing", unit_type="department", sensitivity_level="low")
        other = self.person("marketing@bold.gt", "Marketing responsable")
        other.position.unit = other_unit
        other.position.save(update_fields=["unit"])
        other_status = TaskStatus.objects.create(unit=other_unit, name="Por hacer", category="todo", position=0)
        done = TaskStatus.objects.create(unit=other_unit, name="Terminado Marketing", category="completed", position=2, is_final=True)
        second_row = self.block["rowIds"][1]
        response = self.operation([
            self.edit("title", "IT"), self.edit("responsible", str(self.actor.id)),
            self.edit("title", "Marketing", row=second_row), self.edit("responsible", str(other.id), row=second_row),
        ])
        self.assertEqual(response.status_code, 200, response.data)
        first = TaskLink.objects.get(workbook=self.file, row_id=self.row).task
        second = TaskLink.objects.get(workbook=self.file, row_id=second_row).task
        self.assertEqual(first.unit_id, self.unit.id)
        self.assertEqual(second.unit_id, other_unit.id)
        self.assertEqual(second.status_id, other_status.id)
        second.title = "Cambio desde tareas"
        second.save()
        refresh_from_task(second.id)
        self.file.refresh_from_db()
        sheet, block = next(blocks(self.file.document))
        self.assertEqual(row_values(sheet, block, second_row)["title"], second.title)
        self.assertTrue(TaskLink.objects.get(task=second).active)
        response = self.operation([self.edit("status", "completed", row=second_row)])
        self.assertEqual(response.status_code, 200, response.data)
        second.refresh_from_db()
        self.assertEqual(second.status_id, done.id)
        response = self.operation([self.edit("responsible", str(other.id))])
        self.assertEqual(response.status_code, 200, response.data)
        first.refresh_from_db()
        self.assertEqual(first.unit_id, other_unit.id)
        self.assertEqual(first.status_id, other_status.id)
        self.assertEqual(TaskLink.objects.get(workbook=self.file, row_id=self.row).task_id, first.id)
        self.assertEqual(Task.objects.count(), 2)

    @patch("boldApp.hojas.task_bridge.task_permission")
    def test_mixed_departments_still_require_permission_for_each_row(self, permission):
        other_unit = OrganizationalUnit.objects.create(name="Restringido", unit_type="department", sensitivity_level="low")
        other = self.person("restringido@bold.gt", "Otro responsable")
        other.position.unit = other_unit
        other.position.save(update_fields=["unit"])
        def check(actor, code, unit, task=None):
            if unit.id == other_unit.id:
                raise PermissionDenied("Departamento no autorizado")
        permission.side_effect = check
        second_row = self.block["rowIds"][1]
        response = self.operation([
            self.edit("title", "IT"), self.edit("responsible", str(self.actor.id)),
            self.edit("title", "Restringida", row=second_row), self.edit("responsible", str(other.id), row=second_row),
        ])
        self.assertEqual(response.status_code, 403, response.data)
        self.assertEqual(Task.objects.count(), 0)
        self.file.refresh_from_db()
        self.assertEqual(self.file.revision, 0)

    def test_collaborators_without_responsible_share_one_task_after_title_is_entered(self):
        first = self.person("colaborador@bold.gt", "Primer colaborador")
        second = self.person("colaborador2@bold.gt", "Segundo colaborador")
        self.assertEqual(self.operation([self.edit("title", None), self.edit("collaborators", str(first.id))]).status_code, 200)
        self.assertEqual(Task.objects.count(), 0)
        response = self.operation([self.edit("title", "Compartida")])
        self.assertEqual(response.status_code, 200, response.data)
        link = TaskLink.objects.get(workbook=self.file, row_id=self.row)
        original_task = link.task_id
        self.assertIsNone(link.task.assignee_assignment_id)
        self.assertTrue(TaskFollower.objects.filter(task=link.task, assignment=first).exists())
        identity = str(uuid.uuid4())
        changes = [self.edit("collaborators", f"{first.id},{second.id}"), self.edit("priority", "high")]
        revision = self.file.revision
        response = self.operation(changes, identity=identity)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(self.operation(changes, revision=revision, identity=identity).status_code, 200)
        self.assertEqual(self.operation([self.edit("responsible", str(self.actor.id))]).status_code, 200)
        link.refresh_from_db()
        self.assertEqual(link.task_id, original_task)
        self.assertEqual(Task.objects.count(), 1)
        self.assertEqual(link.task.assignee_assignment_id, self.actor.id)
        self.assertEqual(link.task.priority, "high")
        self.assertEqual(set(TaskFollower.objects.filter(task=link.task, assignment__in=[first, second]).values_list("assignment_id", flat=True)), {first.id, second.id})

    def test_legacy_multi_select_after_drive_sync_preserves_cells_and_existing_task(self):
        first = self.person("colaborador1@bold.gt", "Apellido, Nombre")
        second = self.person("colaborador2@bold.gt", "Segundo colaborador")
        response = self.operation([self.edit("title", "Tarea existente"), self.edit("priority", "high"), self.edit("responsible", str(self.actor.id)), self.edit("collaborators", str(first.id))])
        self.assertEqual(response.status_code, 200, response.data)
        original_task = TaskLink.objects.get(workbook=self.file, row_id=self.row).task_id
        self.drive_file()
        self.file.sync_state = "current"
        self.file.synced_revision = self.file.revision
        self.file.save()
        Revision.objects.create(workbook=self.file, revision=self.file.revision, document=self.file.document, reason="drive_base")
        identity = str(uuid.uuid4())
        revision = self.file.revision
        changes = [self.edit("collaborators", __import__("json").dumps(["Apellido, Nombre", "Segundo colaborador"]))]
        response = self.operation(changes, identity=identity)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(self.operation(changes, revision=revision, identity=identity).status_code, 200)
        self.file.refresh_from_db()
        sheet, block = next(blocks(self.file.document))
        values = row_values(sheet, block, self.row)
        self.assertEqual(values["collaborators"], f"{first.id},{second.id}")
        self.assertEqual(values["responsible"], str(self.actor.id))
        self.assertEqual(values["title"], "Tarea existente")
        self.assertEqual(values["priority"], "high")
        self.assertEqual(TaskLink.objects.get(workbook=self.file, row_id=self.row).task_id, original_task)
        self.assertEqual(Task.objects.count(), 1)
        self.assertEqual(Operation.objects.get(pk=identity).changes[0]["after"]["v"], f"{first.id},{second.id}")

    def test_legacy_selection_with_ambiguous_people_does_not_modify_the_block(self):
        self.person("primero@bold.gt", "Mismo nombre")
        self.person("segundo@bold.gt", "Mismo nombre")
        before = deepcopy(self.file.document)
        response = self.operation([self.edit("collaborators", '["Mismo nombre"]')])
        self.assertEqual(response.status_code, 400)
        self.file.refresh_from_db()
        self.assertEqual(self.file.document, before)
        self.assertEqual(Task.objects.count(), 0)

    def test_creator_selected_as_collaborator_is_preserved_when_task_changes(self):
        self.assertEqual(self.operation([self.edit("title", "Colaborador principal"), self.edit("collaborators", str(self.actor.id))]).status_code, 200)
        task = TaskLink.objects.get(workbook=self.file, row_id=self.row).task
        task.title = "Editada en Mis tareas"
        task.save()
        refresh_from_task(task.id)
        self.file.refresh_from_db()
        sheet, block = next(blocks(self.file.document))
        self.assertEqual(row_values(sheet, block, self.row)["collaborators"], str(self.actor.id))

    def test_automatic_connection_rejects_missing_task_permissions_atomically(self):
        editor = self.person("sin-permiso-tareas@bold.gt", "Editor de Hojas")
        for action in ("read", "edit", "assign"):
            JobRolePermission.objects.get_or_create(job_role=self.role, permission=Permission.objects.get(code="sheets.file." + action), scope_type="own_unit", defaults={"effect": "allow"})
        Member.objects.create(workbook=self.file, account=editor.employee.user_account, role="editor")
        self.login(editor)
        response = self.operation([self.edit("title", "No ampliar permisos"), self.edit("responsible", str(editor.id))])
        self.assertEqual(response.status_code, 403)
        self.file.refresh_from_db()
        self.assertEqual(Task.objects.count(), 0)
        self.assertEqual(self.file.revision, 0)
        self.assertFalse(next(blocks(self.file.document))[1]["task"]["enabled"])

    def test_cost_blocks_do_not_connect_tasks_automatically(self):
        self.file.refresh_from_db()
        sheet = self.file.document["sheets"][self.sheet["id"]]
        block = add_block(sheet, "costs")
        block["columns"] += [col for col in columns("tasks") if col["id"] in {"title", "responsible", "collaborators", "status"}]
        decorate(sheet, block)
        row = block["rowIds"][0]
        set_value(sheet, block, row, "title", "Licencia")
        self.file.save(update_fields=["document"])
        r, c = address(sheet, block, row, "responsible")
        response = self.operation([{"kind": "cell", "sheet": sheet["id"], "block": block["id"], "row": row, "column": "responsible", "before": cell_at(sheet, r, c), "after": {"v": str(self.actor.id)}}])
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(Task.objects.count(), 0)

    def test_custom_states_require_explicit_mapping_before_auto_creation(self):
        self.file.refresh_from_db()
        sheet, block = next(blocks(self.file.document))
        next(col for col in block["columns"] if col["id"] == "status")["options"].append({"value": "review", "label": "Revisión", "color": "#e7aa27"})
        self.file.save(update_fields=["document"])
        response = self.operation([self.edit("title", "Revisar"), self.edit("responsible", str(self.actor.id))])
        self.assertEqual(response.status_code, 400)
        self.assertIn("Revisión", str(response.data))
        self.assertEqual(Task.objects.count(), 0)

    @patch("boldApp.hojas.drive.valid_folder")
    def test_only_server_initial_agenda_can_omit_drive_folder(self, folder):
        folder.side_effect = ValidationError("Selecciona carpeta")
        normal = self.client.post("/api/v2/sheets/files/", {"id": str(uuid.uuid4()), "name": "Nuevo", "initial_agenda": True}, format="json")
        self.assertEqual(normal.status_code, 400)
        self.assertEqual(self.client.post("/api/v2/sheets/files/initial-agenda/", {}, format="json").status_code, 200)
        with self.settings(DEBUG=False):
            self.assertEqual(self.client.post("/api/v2/sheets/files/initial-agenda/", {}, format="json").status_code, 403)

    @patch("boldApp.hojas.engine.call")
    def test_one_task_per_row_retries_sort_and_reassignment_keep_same_task(self, engine):
        def reordered(action, document, **options):
            self.assertEqual(action, "reorder")
            result = deepcopy(document)
            sheet = result["sheets"][options["sheet"]]
            block = next(block for block in sheet["__bold"]["blocks"] if block["id"] == options["block"])
            cells = {row: deepcopy(sheet["cellData"].get(str(block["startRow"] + index + 1), {})) for index, row in enumerate(block["rowIds"])}
            block["rowIds"] = options["order"]
            for index, row in enumerate(block["rowIds"]):
                sheet["cellData"][str(block["startRow"] + index + 1)] = cells[row]
            return {"document": result}
        engine.side_effect = reordered
        self.connect()
        identity = str(uuid.uuid4())
        edits = [self.edit("title", "Primera tarea"), self.edit("responsible", str(self.actor.id))]
        first = self.operation(edits, identity=identity)
        self.assertEqual(first.status_code, 200, first.data)
        first_task = TaskLink.objects.get(workbook=self.file, row_id=self.row).task_id
        replay = self.operation(edits, revision=1, identity=identity)
        self.assertEqual(replay.status_code, 200, replay.data)
        self.assertEqual(TaskLink.objects.filter(workbook=self.file).count(), 1)
        moved = self.operation([{"kind": "row.move", "sheet": self.sheet["id"], "block": self.block["id"], "order": list(reversed(self.block["rowIds"]))}])
        self.assertEqual(moved.status_code, 200, moved.data)
        other = self.person("responsable@bold.gt", "Otro responsable")
        self.assertEqual(self.operation([self.edit("responsible", str(other.id))]).status_code, 200)
        task = Task.objects.get(pk=first_task)
        self.assertEqual(task.assignee_assignment_id, other.id)
        self.assertEqual(self.operation([self.edit("responsible", "")]).status_code, 200)
        task.refresh_from_db()
        self.assertIsNone(task.assignee_assignment_id)
        self.assertEqual(TaskLink.objects.get(workbook=self.file, row_id=self.row).task_id, first_task)

    def test_reverse_task_and_note_updates_are_reflected_without_duplicate_comments(self):
        self.connect()
        self.assertEqual(self.operation([self.edit("title", "Título"), self.edit("responsible", str(self.actor.id)), self.edit("note", "Primera nota")]).status_code, 200)
        link = TaskLink.objects.get(workbook=self.file)
        task = link.task
        task.title = "Editada en Mis tareas"
        task.priority = "high"
        task.save()
        refresh_from_task(task.id)
        self.file.refresh_from_db()
        sheet, block = next(blocks(self.file.document))
        self.assertEqual(row_values(sheet, block, self.row)["title"], task.title)
        self.assertEqual(self.operation([self.edit("note", "Segunda nota")]).status_code, 200)
        self.assertEqual(Comment.objects.filter(task=task).count(), 2)
        self.assertEqual(self.operation([self.edit("note", "Segunda nota")]).status_code, 200)
        self.assertEqual(Comment.objects.filter(task=task).count(), 2)

    def test_disjoint_cells_merge_same_cell_conflicts_preserve_numeric_values(self):
        other_change = self.edit("account", "Cuenta")
        conflict_change = self.edit("title", "Borrador")
        first = self.operation([self.edit("title", "Servidor")], revision=0)
        self.assertEqual(first.status_code, 200)
        other = self.operation([other_change], revision=0)
        self.assertEqual(other.status_code, 200)
        conflict = self.operation([conflict_change], revision=0)
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(conflict.data["conflicts"][0]["current"]["v"], "Servidor")
        self.assertIsInstance(conflict.data["conflicts"][0]["row"], int)
        structural = self.operation([{"kind": "sheet.add", "name": "Nueva"}], revision=0)
        self.assertEqual(structural.status_code, 409)
        self.assertIn("draft", structural.data)

    def test_reader_and_revoked_members_cannot_write_or_read(self):
        member = self.person("lector@bold.gt", "Lector")
        for action in ("read", "export", "edit"):
            JobRolePermission.objects.get_or_create(job_role=self.role, permission=Permission.objects.get(code="sheets.file." + action), scope_type="own_unit", defaults={"effect": "allow"})
        Member.objects.create(workbook=self.file, account=member.employee.user_account, role="reader")
        self.login(member)
        self.assertEqual(self.client.get(f"/api/v2/sheets/files/{self.file.id}/").status_code, 200)
        self.assertEqual(self.operation([self.edit("title", "Prohibido")]).status_code, 403)
        Member.objects.filter(workbook=self.file).delete()
        self.assertEqual(self.client.get(f"/api/v2/sheets/files/{self.file.id}/").status_code, 404)

    def test_stale_grid_merges_resize_with_another_edit_and_preserves_real_conflicts(self):
        base = deepcopy(self.file.document)
        resized = deepcopy(base)
        resized["sheets"][self.sheet["id"]].setdefault("columnData", {}).setdefault("2", {})["w"] = 240
        response = self.operation([self.edit("title", "Cambio simultáneo")], revision=0)
        self.assertEqual(response.status_code, 200, response.data)
        response = self.operation([{"kind": "grid", "document": resized, "baseDocument": base}], revision=0)
        self.assertEqual(response.status_code, 200, response.data)
        self.file.refresh_from_db()
        sheet, block = next(blocks(self.file.document))
        self.assertEqual(row_values(sheet, block, self.row)["title"], "Cambio simultáneo")
        self.assertEqual(sheet["columnData"]["2"]["w"], 240)
        second_resize = deepcopy(base)
        second_resize["sheets"][self.sheet["id"]].setdefault("columnData", {}).setdefault("2", {})["w"] = 300
        response = self.operation([{"kind": "grid", "document": second_resize, "baseDocument": base}], revision=0)
        self.assertEqual(response.status_code, 409)
        self.assertTrue(response.data["structural"])
        self.assertIn("draft", response.data)
        self.file.refresh_from_db()
        self.assertEqual(self.file.document["sheets"][self.sheet["id"]]["columnData"]["2"]["w"], 240)
        no_base = self.operation([{"kind": "grid", "document": second_resize}], revision=0)
        self.assertEqual(no_base.status_code, 409)

    def test_stale_grid_rejects_changes_to_the_same_cell_without_losing_either_value(self):
        base = deepcopy(self.file.document)
        incoming = deepcopy(base)
        sheet, block = next(blocks(incoming))
        set_value(sheet, block, self.row, "title", "Borrador")
        self.assertEqual(self.operation([self.edit("title", "Servidor")], revision=0).status_code, 200)
        response = self.operation([{"kind": "grid", "document": incoming, "baseDocument": base}], revision=0)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(row_values(*next(blocks(response.data["document"])), self.row)["title"], "Servidor")
        self.assertEqual(row_values(*next(blocks(response.data["draft"][0]["document"])), self.row)["title"], "Borrador")

    def test_sharing_does_not_expand_department_task_permissions(self):
        self.connect()
        self.operation([self.edit("title", "Tarea privada"), self.edit("responsible", str(self.actor.id))])
        editor = self.person("editor@bold.gt", "Editor")
        for action in ("read", "edit"):
            JobRolePermission.objects.get_or_create(job_role=self.role, permission=Permission.objects.get(code="sheets.file." + action), scope_type="own_unit", defaults={"effect": "allow"})
        Member.objects.create(workbook=self.file, account=editor.employee.user_account, role="editor")
        self.login(editor)
        denied = self.operation([self.edit("title", "Sin permiso de tareas")])
        self.assertEqual(denied.status_code, 403)
        self.assertEqual(TaskLink.objects.get(workbook=self.file).task.title, "Tarea privada")

    def test_delete_file_keeps_tasks_and_unlinks_them(self):
        self.connect()
        self.operation([self.edit("title", "Conservar"), self.edit("responsible", str(self.actor.id))])
        response = self.client.delete(f"/api/v2/sheets/files/{self.file.id}/")
        self.assertEqual(response.status_code, 204)
        link = TaskLink.objects.get(workbook=self.file)
        self.assertFalse(link.active)
        self.assertIsNone(link.task.deleted_at)

    def test_remove_block_deletes_related_tasks_and_rolls_back_without_delete_permission(self):
        self.connect()
        self.assertEqual(self.operation([self.edit("title", "Eliminar con bloque"), self.edit("responsible", str(self.actor.id))]).status_code, 200)
        link = TaskLink.objects.get(workbook=self.file, row_id=self.row)
        change = {"kind": "block.remove", "sheet": self.sheet["id"], "block": self.block["id"]}
        with patch("boldApp.hojas.task_bridge.task_permission", side_effect=PermissionDenied("Sin permiso para eliminar tareas")):
            denied = self.operation([change])
        self.assertEqual(denied.status_code, 403)
        self.file.refresh_from_db()
        self.assertTrue(any(block["id"] == self.block["id"] for _, block in blocks(self.file.document)))
        link.task.refresh_from_db()
        self.assertIsNone(link.task.deleted_at)
        response = self.operation([change])
        self.assertEqual(response.status_code, 200, response.data)
        link.refresh_from_db()
        link.task.refresh_from_db()
        self.assertIsNotNone(link.task.deleted_at)
        self.assertFalse(link.active)
        self.assertFalse(Task.objects.filter(pk=link.task_id).exists())

    def test_remove_table_from_grid_deletes_its_related_task(self):
        self.connect()
        self.assertEqual(self.operation([self.edit("title", "Eliminar con tabla"), self.edit("responsible", str(self.actor.id))]).status_code, 200)
        link = TaskLink.objects.get(workbook=self.file, row_id=self.row)
        snapshot = deepcopy(self.file.document)
        snapshot["resources"] = [{"name": "SHEET_TABLE_PLUGIN", "data": json.dumps({self.sheet["id"]: {"tables": [], "disabledBlocks": [self.block["id"]]}})}]
        response = self.operation([{"kind": "grid", "document": snapshot, "baseDocument": self.file.document}])
        self.assertEqual(response.status_code, 200, response.data)
        link.task.refresh_from_db()
        self.assertIsNotNone(link.task.deleted_at)

    def test_chart_move_and_resize_persist_with_cell_edits_between_saves(self):
        name = "__casual_sheets_charts__"
        area = {"startRow": 1, "endRow": 8, "startColumn": 3, "endColumn": 7}
        chart = {"id": "chart", "sheetId": self.sheet["id"], "type": "bar", "source": area, "pos": {**area, "width": 625, "height": 375, "offsetX": 25, "offsetY": 7}, "format": {"legend": "right", "dataLabels": True}}
        self.file.document["resources"] = [{"name": name, "data": json.dumps({"v": 1, "charts": [chart]})}]
        self.file.save()
        base = deepcopy(self.file.document)
        moved = deepcopy(base)
        payload = json.loads(moved["resources"][0]["data"])
        payload["charts"][0]["pos"] = {**chart["pos"], "startRow": 4, "endRow": 11}
        moved["resources"][0]["data"] = json.dumps(payload)
        self.assertEqual(self.operation([self.edit("title", "Cambio de celda")]).status_code, 200)
        saved = self.operation([{"kind": "grid", "baseDocument": base, "document": moved}], revision=0)
        self.assertEqual(saved.status_code, 200, saved.data)
        base = deepcopy(saved.data["document"])
        resized = deepcopy(base)
        payload["charts"][0]["pos"]["endColumn"] = 12
        resized["resources"] = [{"name": name, "data": json.dumps(payload)}]
        revision = saved.data["revision"]
        self.assertEqual(self.operation([self.edit("title", "Otro cambio de celda")]).status_code, 200)
        saved = self.operation([{"kind": "grid", "baseDocument": base, "document": resized}], revision=revision)
        self.assertEqual(saved.status_code, 200, saved.data)
        reopened = self.client.get(f"/api/v2/sheets/files/{self.file.id}/")
        document = reopened.data["document"]
        result = json.loads(next(item["data"] for item in document["resources"] if item["name"] == name))["charts"][0]
        self.assertEqual(result["pos"], payload["charts"][0]["pos"])
        self.assertEqual(result["format"], chart["format"])
        self.assertEqual(result["type"], "bar")
        self.assertEqual(row_values(*next(blocks(document)), self.row)["title"], "Otro cambio de celda")
        old_revision = saved.data["revision"]
        competing = deepcopy(document)
        newer = deepcopy(payload)
        newer["charts"][0]["title"] = "Versión anterior en servidor"
        competing["resources"] = [{"name": name, "data": json.dumps(newer)}]
        self.assertEqual(self.operation([{"kind": "grid", "baseDocument": document, "document": competing}]).status_code, 200)
        deleted = deepcopy(document)
        deleted["resources"] = [item for item in deleted["resources"] if item["name"] != name]
        saved = self.operation([{"kind": "grid", "baseDocument": document, "document": deleted}], revision=old_revision)
        self.assertEqual(saved.status_code, 200, saved.data)
        reopened = self.client.get(f"/api/v2/sheets/files/{self.file.id}/")
        self.assertFalse(any(item["name"] == name for item in reopened.data["document"]["resources"]))

    @patch("boldApp.hojas.operations.shift_rows")
    def test_remove_row_deletes_only_its_task_and_requires_delete_permission(self, shift):
        self.connect()
        last = self.block["rowIds"][-1]
        changes = [self.edit("title", "Conservar"), self.edit("responsible", str(self.actor.id)), self.edit("title", "Eliminar fila", row=last), self.edit("responsible", str(self.actor.id), row=last)]
        self.assertEqual(self.operation(changes).status_code, 200)
        kept = TaskLink.objects.get(workbook=self.file, row_id=self.row)
        removed = TaskLink.objects.get(workbook=self.file, row_id=last)
        # The selected row is last in this sheet; isolate the external Excel engine.
        def shift_last(document, sheet, start, delta):
            self.assertEqual(delta, -1)
            sheet["cellData"].pop(str(start), None)
            sheet.get("rowData", {}).pop(str(start), None)
        shift.side_effect = shift_last
        change = {"kind": "row.remove", "sheet": self.sheet["id"], "block": self.block["id"], "row": last}
        with patch("boldApp.hojas.task_bridge.task_permission", side_effect=PermissionDenied("Sin permiso para eliminar tareas")):
            self.assertEqual(self.operation([change]).status_code, 403)
        self.file.refresh_from_db()
        self.assertIn(last, self.file.document["sheets"][self.sheet["id"]]["__bold"]["blocks"][0]["rowIds"])
        removed.task.refresh_from_db()
        self.assertIsNone(removed.task.deleted_at)
        response = self.operation([change])
        self.assertEqual(response.status_code, 200, response.data)
        removed.task.refresh_from_db()
        removed.refresh_from_db()
        self.assertIsNotNone(removed.task.deleted_at)
        self.assertFalse(removed.active)
        kept.task.refresh_from_db()
        self.assertIsNone(kept.task.deleted_at)

    def test_remove_block_clears_native_table_cells_and_rules_after_reload(self):
        start, end = self.block["startRow"], self.block["startRow"] + len(self.block["rowIds"])
        area = {"startRow": start, "endRow": end, "startColumn": 1, "endColumn": len(self.block["columns"])}
        self.sheet["cellData"][str(start)]["40"] = {"v": "Celda ajena"}
        self.sheet["rowData"] = {str(end): {"h": 70}}
        table = {"id": "native", "name": "Tabla_1", "range": area, "columns": [{"id": col["id"], "displayName": col["name"]} for col in self.block["columns"]], "options": {"tableStyleId": "table-default-0"}}
        rules = [{"uid": "list", "type": "list", "formula1": '["A","B"]', "ranges": [{**area, "endRow": end + 2}]}]
        self.document["resources"] = [
            {"name": "SHEET_TABLE_PLUGIN", "data": json.dumps({self.sheet["id"]: {"tables": [table], "tableFilteredOutRows": [end]}})},
            {"name": "SHEET_DATA_VALIDATION_PLUGIN", "data": json.dumps({self.sheet["id"]: rules})},
            {"name": "SHEET_RANGE_THEME_MODEL_PLUGIN", "data": json.dumps({"rangeThemeStyleRuleMap": {"table": {"themeName": "table-default-0", "rangeInfo": {"subUnitId": self.sheet["id"], "range": area}}}})},
        ]
        self.file.document = self.document
        self.file.save()
        response = self.operation([{"kind": "block.remove", "sheet": self.sheet["id"], "block": self.block["id"]}])
        self.assertEqual(response.status_code, 200, response.data)
        self.file.refresh_from_db()
        sheet = self.file.document["sheets"][self.sheet["id"]]
        self.assertFalse(any(block["id"] == self.block["id"] for block in sheet["__bold"]["blocks"]))
        self.assertEqual(sheet["cellData"].get(str(start)), {"40": {"v": "Celda ajena"}})
        self.assertNotIn(str(end), sheet["cellData"])
        self.assertNotIn(str(end), sheet["rowData"])
        saved = {resource["name"]: json.loads(resource["data"]) for resource in self.file.document["resources"]}
        self.assertEqual(saved["SHEET_TABLE_PLUGIN"][self.sheet["id"]]["tables"], [])
        self.assertEqual(saved["SHEET_RANGE_THEME_MODEL_PLUGIN"]["rangeThemeStyleRuleMap"], {})
        self.assertEqual(saved["SHEET_DATA_VALIDATION_PLUGIN"][self.sheet["id"]][0]["ranges"], [{**area, "startRow": end + 1, "endRow": end + 2}])
        reopened = self.client.get(f"/api/v2/sheets/files/{self.file.id}/")
        self.assertEqual(reopened.status_code, 200)
        self.assertEqual(reopened.data["document"]["sheets"][self.sheet["id"]], sheet)

    def test_grid_table_removal_also_deletes_the_block_in_saved_document(self):
        snapshot = deepcopy(self.file.document)
        snapshot["resources"] = [{"name": "SHEET_TABLE_PLUGIN", "data": json.dumps({self.sheet["id"]: {"tables": [], "disabledBlocks": [self.block["id"]]}})}]
        response = self.operation([{"kind": "grid", "document": snapshot, "baseDocument": self.file.document}])
        self.assertEqual(response.status_code, 200, response.data)
        self.file.refresh_from_db()
        sheet = self.file.document["sheets"][self.sheet["id"]]
        self.assertFalse(any(block["id"] == self.block["id"] for block in sheet["__bold"]["blocks"]))
        self.assertFalse(any(cells.get("0", {}).get("v") == "block:" + self.block["id"] for cells in sheet["cellData"].values()))

    def drive_file(self):
        self.file.refresh_from_db()
        self.file.drive_account = self.actor.employee.user_account
        self.file.drive_folder = "fixed-folder"
        self.file.drive_id = "reserved-drive-id"
        self.file.sync_state = "pending"
        self.file.sync_after = timezone.now() - timedelta(seconds=1)
        self.file.save()

    def google_mock(self, uncertain=False):
        state = {"created": False, "version": 0, "calls": [], "uncertain": uncertain}
        def google(user, method, path, **options):
            state["calls"].append((method, path))
            if method == "GET":
                if not state["created"]:
                    raise NotFound()
                self.file.refresh_from_db()
                return SimpleNamespace(json=lambda: {"id": self.file.drive_id, "name": self.file.name + ".xlsx", "parents": ["fixed-folder"], "version": str(state["version"]), "md5Checksum": md5(b"xlsx").hexdigest(), "appProperties": {"boldWorkbook": str(self.file.id), "boldRevision": str(self.file.upload_revision)}, "capabilities": {"canEdit": True}}, headers={"ETag": str(state["version"])})
            state["created"] = True
            state["version"] += 1
            if state["uncertain"]:
                state["uncertain"] = False
                raise GoogleUnavailable()
            return {}
        return state, google

    @patch("boldApp.hojas.drive.export", return_value=b"xlsx")
    def test_drive_updates_reserved_id_across_uncertain_response_and_retry(self, export):
        self.drive_file()
        state, google = self.google_mock(uncertain=True)
        with patch("boldApp.hojas.drive.google", side_effect=google):
            sync(self.file.id)
            self.file.refresh_from_db()
            self.assertTrue(self.file.upload_uncertain)
            self.file.sync_after = timezone.now() - timedelta(seconds=1)
            self.file.save()
            sync(self.file.id)
        self.file.refresh_from_db()
        self.assertEqual(self.file.drive_id, "reserved-drive-id")
        self.assertEqual(sum(method == "POST" for method, _ in state["calls"]), 1)
        self.assertIn(("PATCH", "/files/reserved-drive-id"), state["calls"])
        self.assertEqual(self.file.sync_state, "current")

    def test_external_drive_change_queues_import_and_missing_file_is_not_recreated(self):
        self.drive_file()
        self.file.drive_created = True
        self.file.drive_version = "1"
        self.file.save()
        data = {"version": "2", "md5Checksum": "external", "capabilities": {"canEdit": True}}
        with patch("boldApp.hojas.drive.raw_metadata", return_value=(data, "etag")), patch("boldApp.hojas.tasks.enqueue"):
            checked = check_external(self.file.id, self.actor)
        self.assertEqual(checked.sync_state, "importing")
        self.assertEqual(checked.sync_error, "")
        self.file.sync_state = "pending"
        self.file.save()
        with patch("boldApp.hojas.drive.export", return_value=b"xlsx"), patch("boldApp.hojas.drive.raw_metadata", side_effect=NotFound()), patch("boldApp.hojas.drive.google") as google:
            sync(self.file.id)
        google.assert_not_called()
        self.file.refresh_from_db()
        self.assertEqual(self.file.sync_state, "error")

    def test_import_retains_task_ids_is_repeatable_and_checks_drive_version_again(self):
        self.connect()
        self.operation([self.edit("title", "Antes"), self.edit("responsible", str(self.actor.id))])
        self.file.refresh_from_db()
        task_id = TaskLink.objects.get(workbook=self.file).task_id
        imported = deepcopy(self.file.document)
        sheet, block = next(blocks(imported))
        set_value(sheet, block, self.row, "title", "Después")
        review = ImportReview.objects.create(workbook=self.file, reviewer=self.actor.employee.user_account, drive_version="9", drive_checksum="import", base_revision=self.file.revision, document=imported)
        request = SimpleNamespace(user=self.actor.employee.user_account, assignment=self.actor, data={"resolutions": {}}, META={})
        data = {"version": "9", "md5Checksum": "import"}
        with patch("boldApp.hojas.drive.raw_metadata", return_value=(data, "etag")):
            apply_review(self.file.id, review.id, request)
            apply_review(self.file.id, review.id, request)
        self.assertEqual(TaskLink.objects.get(workbook=self.file).task_id, task_id)
        self.assertEqual(Task.objects.get(pk=task_id).title, "Después")
        self.assertEqual(Revision.objects.filter(workbook=self.file, reason="before_drive_import").count(), 1)
        review.applied_at = None
        review.save()
        with patch("boldApp.hojas.drive.raw_metadata", return_value=({"version": "10"}, "etag")):
            from boldApp.hojas.operations import Conflict
            with self.assertRaises(Conflict):
                apply_review(self.file.id, review.id, request)

    def test_google_failure_keeps_document_and_a_pending_retry(self):
        self.drive_file()
        original = deepcopy(self.file.document)
        with patch("boldApp.hojas.drive.export", side_effect=GoogleUnavailable()):
            sync(self.file.id)
        self.file.refresh_from_db()
        self.assertEqual(self.file.document, original)
        self.assertEqual(self.file.sync_state, "error")
        self.assertIsNotNone(self.file.sync_after)

    def test_money_formulas_reject_mixed_currency_without_conversion(self):
        document = agenda()
        sheet = next(sheet for sheet in document["sheets"].values() if sheet["name"] == "Herramientas")
        costs, comparison = sheet["__bold"]["blocks"][1:]
        comparison["currency"] = "HNL"
        from boldApp.hojas.document import decorate
        decorate(sheet, comparison)
        put_cell(sheet, 80, 1, {"f": f"=SUM(E{costs['startRow']+2},E{comparison['startRow']+2})"})
        with self.assertRaises(ValidationError):
            validate_document(document)

    def test_mixed_currency_is_rejected_through_summary_and_named_range(self):
        document = agenda()
        sheet = next(sheet for sheet in document["sheets"].values() if sheet["name"] == "Herramientas")
        costs, comparison = sheet["__bold"]["blocks"][1:]
        comparison["currency"] = "HNL"
        from boldApp.hojas.document import decorate
        decorate(sheet, comparison)
        put_cell(sheet, 80, 1, {"f": f"=E{costs['startRow']+2}"})
        put_cell(sheet, 81, 1, {"f": f"=SUM(B81,E{comparison['startRow']+2})"})
        with self.assertRaises(ValidationError):
            validate_document(document)
        put_cell(sheet, 81, 1, {"f": "=SUM(Mixed)"})
        document["resources"] = [{"name": "SHEET_DEFINED_NAME_PLUGIN", "data": __import__("json").dumps({"mixed": {"name": "Mixed", "formulaOrRefString": f"=B81+E{comparison['startRow']+2}", "localSheetId": sheet["id"]}})}]
        with self.assertRaises(ValidationError):
            validate_document(document)

    @patch("boldApp.hojas.drive.export", return_value=b"xlsx")
    def test_a_drive_edit_after_upload_does_not_become_the_accepted_baseline(self, export):
        self.drive_file()
        state, google = self.google_mock()
        def changed_metadata(workbook):
            return {"name": workbook.name + ".xlsx", "parents": ["fixed-folder"], "version": "3", "md5Checksum": "external", "capabilities": {"canEdit": True}}, "3"
        with patch("boldApp.hojas.drive.google", side_effect=google):
            with patch("boldApp.hojas.drive.raw_metadata", side_effect=[NotFound(), changed_metadata(self.file)]):
                sync(self.file.id)
        self.file.refresh_from_db()
        self.assertEqual(self.file.sync_state, "importing")
        self.assertTrue(self.file.upload_uncertain)
        self.assertEqual(self.file.drive_version, "")

    @patch("boldApp.hojas.tasks.calculate_workbook")
    @patch("boldApp.hojas.drive.sync")
    def test_an_active_job_or_future_deadline_does_not_start_another_calculation(self, sync, calculate):
        from boldApp.hojas.tasks import synchronize
        self.file.sync_lease = uuid.uuid4()
        self.file.lease_until = timezone.now() + timedelta(seconds=120)
        self.file.save()
        synchronize(self.file.id)
        calculate.assert_not_called()
        sync.assert_not_called()
        self.file.sync_lease, self.file.lease_until = None, None
        self.file.sync_after = timezone.now() + timedelta(seconds=10)
        self.file.save()
        synchronize(self.file.id)
        calculate.assert_not_called()

    def test_recreation_keeps_content_but_never_generates_historical_tasks(self):
        from boldApp.hojas.document import recreate_agenda
        data = recreate_agenda({"tables": {"IT": [{"title": {"v": "Revisar proceso"}, "due_date": {"v": "2026-10-09"}, "responsible": {"v": str(self.actor.id)}, "status": {"v": "Terminado"}}]}, "costs": [{"product": {"v": "Licencia"}, "price": {"v": 5}, "quantity": {"v": 4}}], "comparison": []})
        sheet = next(sheet for sheet in data["sheets"].values() if sheet["name"] == "IT")
        block = sheet["__bold"]["blocks"][0]
        values = row_values(sheet, block, block["rowIds"][0])
        self.assertEqual(values["title"], "Revisar proceso")
        self.assertEqual(values["due_date"], "2026-10-09")
        self.assertEqual(values["responsible"], "")
        self.assertFalse(block["task"]["enabled"])
        self.assertEqual(Task.objects.count(), 0)

    def test_import_cannot_replace_a_document_while_upload_is_in_progress(self):
        from boldApp.hojas.operations import Conflict
        review = ImportReview.objects.create(workbook=self.file, reviewer=self.actor.employee.user_account, drive_version="1", drive_checksum="old", base_revision=self.file.revision, document=self.file.document)
        self.file.lease_until = timezone.now() + timedelta(seconds=60)
        self.file.sync_lease = uuid.uuid4()
        self.file.save()
        request = SimpleNamespace(user=self.actor.employee.user_account, assignment=self.actor, data={"resolutions": {}})
        with self.assertRaises(Conflict), patch("boldApp.hojas.drive.raw_metadata") as metadata:
            apply_review(self.file.id, review.id, request)
        metadata.assert_not_called()
        self.file.refresh_from_db()
        self.assertEqual(self.file.document, self.document)

    def test_conditional_formulas_cannot_load_external_connections(self):
        document = agenda()
        sheet = document["sheetOrder"][0]
        document["resources"] = [{"name": "SHEET_CONDITIONAL_FORMATTING_PLUGIN", "data": __import__("json").dumps({sheet: [{"cfId": "rule", "ranges": [{"startRow": 1, "endRow": 1, "startColumn": 1, "endColumn": 1}], "stopIfTrue": False, "rule": {"type": "highlightCell", "subType": "formula", "value": '=WEBSERVICE("https://example.com")'}}]})}]
        with self.assertRaises(ValidationError):
            validate_document(document)

    def test_custom_validation_cannot_load_external_connections(self):
        document = agenda()
        sheet = document["sheetOrder"][0]
        document["resources"] = [{"name": "SHEET_DATA_VALIDATION_PLUGIN", "data": __import__("json").dumps({sheet: [{"uid": "rule", "ranges": [{"startRow": 1, "endRow": 1, "startColumn": 1, "endColumn": 1}], "type": "custom", "formula1": '=WEBSERVICE("https://example.com")'}]})}]
        with self.assertRaises(ValidationError):
            validate_document(document)

    def test_filter_cannot_reference_another_sheet_or_an_unbounded_range(self):
        document = agenda()
        document["resources"] = [{"name": "SHEET_FILTER_PLUGIN", "data": __import__("json").dumps({document["sheetOrder"][0]: {"ref": {"startRow": 0, "endRow": 999999, "startColumn": 0, "endColumn": 1}}})}]
        with self.assertRaises(ValidationError):
            validate_document(document)

    def test_task_moved_to_another_department_is_unlinked_without_copying_its_data(self):
        self.connect()
        self.assertEqual(self.operation([self.edit("title", "Visible"), self.edit("responsible", str(self.actor.id))]).status_code, 200)
        link = TaskLink.objects.get(workbook=self.file)
        other = OrganizationalUnit.objects.create(name="Otro departamento", unit_type="department", sensitivity_level="low")
        Task.all_objects.filter(pk=link.task_id).update(unit=other, title="Dato de otro departamento")
        self.file.refresh_from_db()
        revision = self.file.revision
        refresh_from_task(link.task_id)
        self.file.refresh_from_db()
        link.refresh_from_db()
        sheet, block = next(blocks(self.file.document))
        self.assertFalse(link.active)
        self.assertEqual(row_values(sheet, block, self.row)["title"], "Visible")
        self.assertEqual(self.file.revision, revision + 1)
        edit = self.operation([self.edit("title", "Nuevo título")])
        self.assertEqual(edit.status_code, 400)
        task = Task.all_objects.get(pk=link.task_id)
        self.assertEqual(task.unit_id, other.id)
        self.assertEqual(task.title, "Dato de otro departamento")

    def test_soft_deleted_task_is_unlinked_and_publishes_a_new_revision(self):
        self.connect()
        self.assertEqual(self.operation([self.edit("title", "Conservar fila"), self.edit("responsible", str(self.actor.id))]).status_code, 200)
        link = TaskLink.objects.get(workbook=self.file)
        Task.all_objects.filter(pk=link.task_id).update(deleted_at=timezone.now())
        self.file.refresh_from_db()
        revision = self.file.revision
        refresh_from_task(link.task_id)
        self.file.refresh_from_db()
        link.refresh_from_db()
        self.assertFalse(link.active)
        self.assertEqual(self.file.revision, revision + 1)

    @patch("boldApp.core.permissions.HasActiveAssignment.has_permission", return_value=True)
    def test_sheet_images_follow_file_access_and_revocation_without_task_permissions(self, active):
        from boldApp.hojas.images import bind_images
        from boldApp.workspace.image_storage import authorized_image
        from boldApp.workspace.models import ImageStorageRoot, StoredImage
        root = ImageStorageRoot.objects.create(user=self.actor.employee.user_account, subject="subject", client_id="client", google_email="owner@bold.gt", folder_id="images", folder_name="Imágenes", active=True)
        image = StoredImage.objects.create(root=root, drive_id="image", mime_type="image/png", size_bytes=10)
        url = f"/api/v2/media/images/{image.id}/"
        set_value(self.sheet, self.block, self.row, "note", '<!--bold-rich-text--><img src="' + url + '">')
        self.file.document = self.document
        with patch("boldApp.hojas.images.authorized_image", return_value=True):
            bind_images(self.file, SimpleNamespace(user=self.actor.employee.user_account, assignment=self.actor))
        self.file.save()
        reader = self.person("images-reader@bold.gt", "Lector de imágenes")
        JobRolePermission.objects.get_or_create(job_role=self.role, permission=Permission.objects.get(code="sheets.file.read"), scope_type="own_unit", defaults={"effect": "allow"})
        Member.objects.create(workbook=self.file, account=reader.employee.user_account, role="reader")
        request = SimpleNamespace(user=reader.employee.user_account, assignment=reader)
        self.assertTrue(authorized_image(request, image))
        Member.objects.filter(workbook=self.file).delete()
        self.assertFalse(authorized_image(request, image))

    def test_an_editor_cannot_bind_a_private_image_by_pasting_its_identifier(self):
        from boldApp.hojas.images import bind_images
        from boldApp.workspace.models import ImageBinding, ImageStorageRoot, StoredImage
        root = ImageStorageRoot.objects.create(user=self.actor.employee.user_account, subject="subject", client_id="client", google_email="owner@bold.gt", folder_id="images", folder_name="Imágenes", active=True)
        image = StoredImage.objects.create(root=root, drive_id="image", mime_type="image/png", size_bytes=10)
        set_value(self.sheet, self.block, self.row, "note", f'<!--bold-rich-text--><img src="/api/v2/media/images/{image.id}/">')
        self.file.document = self.document
        with patch("boldApp.hojas.images.authorized_image", return_value=False), self.assertRaises(PermissionDenied):
            bind_images(self.file, SimpleNamespace(user=self.actor.employee.user_account, assignment=self.actor))
        self.assertFalse(ImageBinding.objects.filter(resource_kind="workbook", resource_id=self.file.id).exists())

    def test_reverse_updates_stop_when_file_access_is_revoked(self):
        self.connect()
        self.assertEqual(self.operation([self.edit("title", "Visible"), self.edit("responsible", str(self.actor.id))]).status_code, 200)
        link = TaskLink.objects.get(workbook=self.file)
        Task.all_objects.filter(pk=link.task_id).update(title="No copiar")
        with patch("boldApp.hojas.access.require_file", side_effect=PermissionDenied("Revocado")):
            refresh_from_task(link.task_id)
        self.file.refresh_from_db()
        sheet, block = next(blocks(self.file.document))
        self.assertEqual(row_values(sheet, block, self.row)["title"], "Visible")

    def test_native_file_hyperlink_reaches_the_task_description(self):
        self.connect()
        change = self.edit("description", "Archivo")
        change["after"]["p"] = {"body": {"customRanges": [{"rangeType": 0, "properties": {"url": "https://example.com/file?a=1&b=2"}}]}}
        response = self.operation([self.edit("title", "Revisar archivo"), self.edit("responsible", str(self.actor.id)), change])
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIn('href="https://example.com/file?a=1&amp;b=2"', TaskLink.objects.get(workbook=self.file).task.description)
        self.file.refresh_from_db()
        sheet, block = next(blocks(self.file.document))
        from boldApp.hojas.document import address
        self.assertNotIn("p", cell_at(sheet, *address(sheet, block, self.row, "description")))

    @patch("boldApp.hojas.engine.requests.post")
    def test_removing_a_sheet_keeps_and_unlinks_its_tasks(self, post):
        self.connect()
        self.assertEqual(self.operation([self.edit("title", "Conservar tarea"), self.edit("responsible", str(self.actor.id))]).status_code, 200)
        link = TaskLink.objects.get(workbook=self.file)
        self.file.refresh_from_db()
        remaining = deepcopy(self.file.document)
        remaining["sheetOrder"].remove(self.sheet["id"])
        del remaining["sheets"][self.sheet["id"]]
        post.return_value.ok = True
        post.return_value.json.return_value = {"document": remaining}
        response = self.operation([{"kind": "sheet.remove", "sheet": self.sheet["id"]}])
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(post.call_args.kwargs["json"]["action"], "remove")
        self.file.refresh_from_db()
        self.assertNotIn(self.sheet["id"], self.file.document["sheets"])
        link.refresh_from_db()
        self.assertFalse(link.active)
        self.assertTrue(Task.objects.filter(pk=link.task_id, title="Conservar tarea").exists())

    def test_adding_the_same_sheet_name_keeps_the_queue_valid(self):
        for expected in ("Nueva hoja", "Nueva hoja 2", "Nueva hoja 3"):
            response = self.operation([{"kind": "sheet.add", "name": "Nueva hoja"}])
            self.assertEqual(response.status_code, 200, response.data)
            self.file.refresh_from_db()
            last = self.file.document["sheetOrder"][-1]
            self.assertEqual(self.file.document["sheets"][last]["name"], expected)

    @patch("boldApp.hojas.engine.requests.post")
    def test_renaming_to_an_existing_sheet_name_sends_a_unique_name(self, post):
        other = self.document["sheetOrder"][1]
        expected = self.sheet["name"] + " 2"
        renamed = deepcopy(self.document)
        renamed["sheets"][other]["name"] = expected
        post.return_value.ok = True
        post.return_value.json.return_value = {"document": renamed}
        response = self.operation([{"kind": "sheet.rename", "sheet": other, "name": self.sheet["name"]}])
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(post.call_args.kwargs["json"]["name"], expected)

    @patch("boldApp.hojas.drive.raw_metadata")
    def test_drive_check_waits_for_the_active_upload_without_reporting_external_changes(self, metadata):
        self.drive_file()
        self.file.drive_created = True
        self.file.sync_state = "syncing"
        self.file.sync_lease = uuid.uuid4()
        self.file.lease_until = timezone.now() + timedelta(seconds=30)
        self.file.save()
        checked = check_external(self.file.id, self.actor)
        metadata.assert_not_called()
        self.assertEqual(checked.sync_state, "syncing")

    @patch("boldApp.hojas.drive.export", return_value=b"xlsx")
    def test_confirmed_own_upload_does_not_become_an_external_change(self, export):
        self.drive_file()
        state, google = self.google_mock()
        def already_confirmed(user, method, path, **options):
            response = google(user, method, path, **options)
            if method == "GET" and state["created"]:
                Workbook.objects.filter(pk=self.file.id).update(upload_uncertain=False)
            return response
        with patch("boldApp.hojas.drive.google", side_effect=already_confirmed):
            sync(self.file.id)
        self.file.refresh_from_db()
        self.assertEqual(self.file.sync_state, "current")
        self.assertEqual(self.file.sync_error, "")

    @patch("boldApp.hojas.drive.export", return_value=b"xlsx")
    def test_check_recovers_an_uncertain_own_upload_and_clears_the_notice(self, export):
        self.drive_file()
        state, google = self.google_mock(uncertain=True)
        with patch("boldApp.hojas.drive.google", side_effect=google):
            sync(self.file.id)
            Workbook.objects.filter(pk=self.file.id).update(drive_created=True)
            checked = check_external(self.file.id, self.actor)
        self.assertEqual(checked.sync_state, "current")
        self.assertEqual(checked.synced_revision, checked.upload_revision)
        self.assertEqual(checked.sync_error, "")

    def test_drive_marker_alone_does_not_hide_a_real_external_edit(self):
        self.drive_file()
        self.file.drive_created = True
        self.file.drive_version = "4"
        self.file.upload_checksum = "saved-content"
        self.file.save()
        data = {"version": "13", "md5Checksum": "changed-content", "name": self.file.name + ".xlsx", "parents": [self.file.drive_folder], "appProperties": {"boldWorkbook": str(self.file.id), "boldRevision": str(self.file.upload_revision)}, "capabilities": {"canEdit": True}}
        with patch("boldApp.hojas.drive.raw_metadata", return_value=(data, "etag")):
            checked = check_external(self.file.id, self.actor)
        self.assertEqual(checked.sync_state, "importing")

    def test_a_new_edit_clears_the_previous_calculation_notice(self):
        self.file.calculation_error = "Error de una revisión anterior"
        self.file.save(update_fields=["calculation_error"])
        response = self.operation([self.edit("title", "Nueva revisión")])
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["calculation_error"], "")

    @patch("boldApp.hojas.tasks.enqueue")
    def test_recalculate_returns_fresh_file_state_and_clears_a_stale_notice(self, enqueue):
        self.file.calculation_error = "Error anterior"
        self.file.save(update_fields=["calculation_error"])
        response = self.client.post(f"/api/v2/sheets/files/{self.file.id}/recalculate/", {}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["calculation_error"], "")
        self.assertEqual(response.data["id"], str(self.file.id))
        enqueue.assert_called_once()

    @patch("boldApp.hojas.engine.call")
    def test_an_empty_workbook_does_not_need_the_formula_engine(self, engine):
        from boldApp.hojas.document import blank
        from boldApp.hojas.tasks import calculate_workbook
        self.file.document = blank("Sin fórmulas")
        self.file.document["id"] = str(self.file.id)
        self.file.revision = 1
        self.file.calculation_error = "Anterior"
        self.file.save()
        calculate_workbook(self.file.id)
        engine.assert_not_called()
        self.file.refresh_from_db()
        self.assertEqual(self.file.calculated_revision, 1)
        self.assertEqual(self.file.calculation_error, "")

    @patch("boldApp.hojas.tasks.logger.exception")
    @patch("boldApp.hojas.operations.publish")
    @patch("boldApp.hojas.engine.call")
    def test_calculation_notice_reports_a_known_file_error_without_calling_it_an_outage(self, engine, publish, logger):
        from boldApp.hojas.tasks import calculate_workbook
        self.file.revision = 1
        self.file.save()
        engine.side_effect = ValidationError("Revisa el rango con nombre: Price")
        calculate_workbook(self.file.id)
        self.file.refresh_from_db()
        self.assertIn("Revisa el rango con nombre: Price", self.file.calculation_error)
        self.assertNotIn("motor esté disponible", self.file.calculation_error)
        self.assertEqual(self.file.calculated_revision, 0)
        self.assertEqual(self.file.document, self.document)

    @patch("boldApp.hojas.tasks.logger.exception")
    @patch("boldApp.hojas.operations.publish")
    @patch("boldApp.hojas.engine.call")
    def test_a_failed_old_calculation_cannot_replace_the_success_of_a_new_revision(self, engine, publish, logger):
        from boldApp.hojas.tasks import calculate_workbook
        self.file.revision = 1
        self.file.save()
        def old_failure(*args, **kwargs):
            Workbook.objects.filter(pk=self.file.id).update(revision=2, calculated_revision=2, calculation_error="")
            raise RuntimeError("Falló la revisión anterior")
        engine.side_effect = old_failure
        calculate_workbook(self.file.id)
        self.file.refresh_from_db()
        self.assertEqual(self.file.calculated_revision, 2)
        self.assertEqual(self.file.calculation_error, "")
        publish.assert_not_called()

    @patch("boldApp.hojas.operations.publish")
    @patch("boldApp.hojas.engine.import_file")
    def test_recalculate_recovers_internal_list_options_without_overwriting_edited_cells(self, imported, publish):
        import json
        from boldApp.hojas.tasks import calculate_workbook
        key = self.document["sheetOrder"][0]
        rule = {"uid": "status-list", "type": "list", "formula1": "=_BOLD_LIST_2", "ranges": [{"startRow": 100, "endRow": 101, "startColumn": 1, "endColumn": 1}]}
        self.file.document["resources"] = [{"name": "SHEET_DATA_VALIDATION_PLUGIN", "data": json.dumps({key: [rule]})}]
        self.file.document["sheets"][key]["cellData"]["100"] = {"1": {"v": "Edición conservada"}}
        self.file.excel_content = b"original-xlsx"
        self.file.save()
        recovered = deepcopy(self.file.document)
        recovered["resources"][0]["data"] = json.dumps({key: [{**rule, "formula1": '["Pendiente","Terminado"]'}]})
        recovered["sheets"][key]["cellData"]["100"]["1"]["v"] = "Texto antiguo de Excel"
        imported.return_value = {"document": recovered}
        calculate_workbook(self.file.pk)
        self.file.refresh_from_db()
        self.assertEqual(json.loads(self.file.document["resources"][0]["data"])[key][0]["formula1"], '["Pendiente","Terminado"]')
        self.assertEqual(self.file.document["sheets"][key]["cellData"]["100"]["1"]["v"], "Edición conservada")
        self.assertEqual(self.file.calculation_error, "")

    def test_chart_resources_reject_missing_sheets_and_out_of_bounds_ranges(self):
        document = deepcopy(self.document)
        model = {"id": "chart", "sheetId": "missing", "source": {"startRow": 0, "endRow": 2, "startColumn": 0, "endColumn": 1}, "pos": {"startRow": 0, "endRow": 10, "startColumn": 3, "endColumn": 10}}
        document["resources"] = [{"name": "__casual_sheets_charts__", "data": __import__("json").dumps({"v": 1, "charts": [model]})}]
        with self.assertRaises(ValidationError):
            validate_document(document)
        model["sheetId"] = document["sheetOrder"][0]
        model["source"]["endRow"] = 20000
        document["resources"][0]["data"] = __import__("json").dumps({"v": 1, "charts": [model]})
        with self.assertRaises(ValidationError):
            validate_document(document)
        model["source"]["endRow"] = 2
        for invalid in ({"v": 1, "charts": [{**model, "pos": {**model["pos"], "width": 0}}]}, {"v": 1, "charts": [], "deletedParts": ["xl/worksheets/sheet1.xml"]}):
            document["resources"][0]["data"] = json.dumps(invalid)
            with self.assertRaises(ValidationError):
                validate_document(document)

    def test_native_tables_reject_deleted_sheets_and_invalid_ranges(self):
        import json
        document = deepcopy(self.document)
        table = {"id": "table", "name": "Tabla", "range": {"startRow": 1, "endRow": 3, "startColumn": 1, "endColumn": 1}, "columns": [{"id": "column", "displayName": "Tarea"}]}
        document["resources"] = [{"name": "SHEET_TABLE_PLUGIN", "data": json.dumps({"missing": {"tables": [table]}})}]
        with self.assertRaises(ValidationError):
            validate_document(document)
        key = document["sheetOrder"][0]
        document["resources"][0]["data"] = json.dumps({key: {"tables": [table]}})
        validate_document(document)
        table["range"]["endRow"] = 20000
        document["resources"][0]["data"] = json.dumps({key: {"tables": [table]}})
        with self.assertRaises(ValidationError):
            validate_document(document)

    @patch("boldApp.hojas.drive.publish")
    @patch("boldApp.administrativo.services.record_system_event")
    @patch("boldApp.hojas.drive.apply_tasks")
    @patch("boldApp.hojas.drive.raw_metadata", return_value=({"version": "9", "md5Checksum": "remote", "name": "Agenda", "parents": ["folder"]}, None))
    @patch("boldApp.hojas.drive.review_external")
    def test_drive_import_rebases_changes_saved_while_the_download_is_in_progress(self, review_external, metadata, tasks, audit, publish):
        self.drive_file()
        lease = uuid.uuid4()
        self.file.sync_lease = lease
        self.file.synced_revision = self.file.revision
        self.file.save()
        base = deepcopy(self.file.document)
        Revision.objects.create(workbook=self.file, revision=self.file.synced_revision, document=base, reason="drive_base")
        key = base["sheetOrder"][0]
        remote = deepcopy(base)
        remote["sheets"][key]["cellData"]["10"] = {"1": {"v": "Drive"}}
        review = ImportReview.objects.create(workbook=self.file, reviewer=self.actor.employee.user_account, drive_version="9", base_revision=self.file.revision, document=remote, excel_content=b"xlsx", issues=[], changes=[])
        def concurrent_save(*args):
            local = deepcopy(base)
            local["sheets"][key]["cellData"]["11"] = {"1": {"v": "BOLD"}}
            Workbook.objects.filter(pk=self.file.pk).update(document=local, revision=self.file.revision + 1)
            return review
        review_external.side_effect = concurrent_save
        update_external(self.file.pk, lease)
        self.file.refresh_from_db()
        self.assertEqual(self.file.document["sheets"][key]["cellData"]["10"]["1"]["v"], "Drive")
        self.assertEqual(self.file.document["sheets"][key]["cellData"]["11"]["1"]["v"], "BOLD")
        self.assertEqual(self.file.sync_state, "pending")
        self.assertEqual(self.file.sync_error, "")
        tasks.assert_called_once()

    @patch("boldApp.hojas.drive.publish")
    @patch("boldApp.administrativo.services.record_system_event")
    @patch("boldApp.hojas.drive.apply_tasks")
    @patch("boldApp.hojas.drive.raw_metadata", return_value=({"version": "9", "md5Checksum": "remote", "name": "Agenda", "parents": ["folder"]}, None))
    @patch("boldApp.hojas.drive.review_external")
    def test_drive_same_cell_updates_automatically_and_saves_both_versions(self, review_external, metadata, tasks, audit, publish):
        self.drive_file()
        lease = uuid.uuid4()
        self.file.sync_lease = lease
        self.file.synced_revision = self.file.revision
        base = deepcopy(self.file.document)
        key = base["sheetOrder"][0]
        sheet = base["sheets"][key]
        block = sheet["__bold"]["blocks"][0]
        row, column = address(sheet, block, self.row, "priority")
        put_cell(sheet, row, column, {"v": "medium"})
        Revision.objects.create(workbook=self.file, revision=self.file.synced_revision, document=base, reason="drive_base")
        local, remote = deepcopy(base), deepcopy(base)
        local["sheets"][key]["zoomRatio"] = .9
        remote["sheets"][key]["zoomRatio"] = .8
        put_cell(local["sheets"][key], row, column, {"v": "low"})
        put_cell(remote["sheets"][key], row, column, {"v": ""})
        remote["sheets"][key]["cellData"]["100"] = {"1": {"v": "Cambio independiente en Drive"}}
        self.file.document = local
        self.file.revision += 1
        self.file.save()
        review = ImportReview.objects.create(workbook=self.file, reviewer=self.actor.employee.user_account, drive_version="9", base_revision=self.file.revision, document=remote, excel_content=b"drive-xlsx", issues=[], changes=[])
        review_external.return_value = review
        with self.captureOnCommitCallbacks(execute=True):
            update_external(self.file.pk, lease)
        self.file.refresh_from_db()
        review.refresh_from_db()
        self.assertEqual(cell_at(self.file.document["sheets"][key], row, column)["v"], "low")
        self.assertEqual(self.file.document["sheets"][key]["cellData"]["100"]["1"]["v"], "Cambio independiente en Drive")
        self.assertEqual(self.file.sync_state, "pending")
        self.assertEqual(self.file.sync_error, "")
        self.assertEqual(self.file.document["sheets"][key]["zoomRatio"], .9)
        self.assertEqual(self.file.drive_id, "reserved-drive-id")
        incoming = Revision.objects.get(workbook=self.file, reason="drive_conflict")
        self.assertEqual(incoming.document, remote)
        self.assertEqual(bytes(incoming.excel_content), b"drive-xlsx")
        self.assertEqual(Revision.objects.get(workbook=self.file, reason="before_drive_import").document, local)
        self.assertIsNotNone(review.applied_at)
        tasks.assert_called_once()
        self.assertNotIn("sync_error", publish.call_args.args[1])

    @patch("boldApp.hojas.drive.publish")
    @patch("boldApp.administrativo.services.record_system_event")
    @patch("boldApp.hojas.drive.apply_tasks")
    @patch("boldApp.hojas.drive.raw_metadata", return_value=({"version": "9", "md5Checksum": "remote", "name": "Agenda", "parents": ["folder"]}, None))
    @patch("boldApp.hojas.drive.review_external")
    def test_drive_without_a_common_base_keeps_bold_and_archives_drive(self, review_external, metadata, tasks, audit, publish):
        self.drive_file()
        lease = uuid.uuid4()
        self.file.sync_lease = lease
        self.file.synced_revision = self.file.revision
        self.file.revision += 1
        self.file.save()
        local = deepcopy(self.file.document)
        remote = deepcopy(local)
        remote["sheets"][remote["sheetOrder"][0]]["zoomRatio"] = .8
        review = ImportReview.objects.create(workbook=self.file, reviewer=self.actor.employee.user_account, drive_version="9", base_revision=self.file.revision, document=remote, excel_content=b"drive-xlsx", issues=[], changes=[])
        review_external.return_value = review
        with self.captureOnCommitCallbacks(execute=True):
            update_external(self.file.pk, lease)
        self.file.refresh_from_db()
        self.assertEqual(self.file.document, local)
        self.assertEqual(self.file.sync_state, "pending")
        self.assertEqual(self.file.sync_error, "")
        self.assertEqual(Revision.objects.get(workbook=self.file, reason="drive_conflict").document, remote)
        self.assertNotIn("sync_error", publish.call_args.args[1])

    def test_drive_conflict_message_does_not_expose_a_serialized_dictionary(self):
        from boldApp.hojas.operations import Conflict
        self.assertEqual(error_message(Conflict("Revisar la misma celda"), "Error"), "Revisar la misma celda")

    def test_image_resources_reject_a_source_that_cannot_be_rendered_safely(self):
        document = deepcopy(self.document)
        document["resources"] = [{"name": "SHEET_DRAWING_PLUGIN", "data": __import__("json").dumps({document["sheetOrder"][0]: {"order": ["image"], "data": {"image": {"drawingType": 0, "source": "javascript:alert(1)"}}}})}]
        with self.assertRaises(ValidationError):
            validate_document(document)
