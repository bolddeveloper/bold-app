from contextlib import contextmanager
from contextvars import ContextVar
from hashlib import sha256

from django.db import transaction
from django.db.models import Q
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.serializers import UUIDField

from boldApp.core.authorization import check_and_log
from boldApp.core.models import OrganizationalUnit, PositionAssignment
from boldApp.tareas.models import ActivityLog, Comment, Task, TaskFollower, TaskStatus
from boldApp.tareas.serializers import CommentSerializer, TaskSerializer
from .access import require_module
from .document import blocks, row_values, set_value, validate_document
from .models import TaskLink, Workbook

bridging = ContextVar("sheets_task_bridge", default=False)


@contextmanager
def suppress_reverse():
    token = bridging.set(True)
    try:
        yield
    finally:
        bridging.reset(token)


def task_permission(assignment, code, unit, task=None):
    if not check_and_log(assignment=assignment, permission_code=code, target_unit=unit, resource_id=task.id if task else None, resource_type="task").allowed:
        raise PermissionDenied("Compartir Hojas no amplía los permisos de tareas del departamento.")


def assignment_for(value, unit=None):
    if not value:
        return None
    try:
        candidates = PositionAssignment.objects.select_related("employee__user_account", "position__unit", "position__job_role").filter(is_active=True, released_at__isnull=True, employee__is_active=True, employee__user_account__is_active=True)
        if unit is not None:
            candidates = candidates.filter(position__unit=unit)
        return candidates.get(pk=UUIDField().run_validation(value))
    except (PositionAssignment.DoesNotExist, ValueError, TypeError) as exc:
        raise ValidationError("Selecciona un responsable válido de este departamento; no se asignan personas por coincidencia de nombres.") from exc


def connect_automatic_tasks(sheet, block, actor):
    configuration = block.get("task", {})
    if block["type"] != "tasks" or configuration.get("enabled"):
        return False
    for row in block["rowIds"]:
        values = row_values(sheet, block, row)
        if not str(values.get("title") or "").strip():
            continue
        collaborators = values.get("collaborators") or ""
        if not isinstance(collaborators, str):
            raise ValidationError("Colaboradores inválidos.")
        person = values.get("responsible") or next(filter(None, collaborators.split(",")), None)
        if not person:
            continue
        unit_id = UUIDField().run_validation(configuration["unit"]) if configuration.get("unit") else None
        assignment = assignment_for(person, unit_id)
        unit = assignment.position.unit
        require_module(actor, "assign")
        task_permission(actor, "tasks.task.create", unit)
        task_permission(actor, "tasks.task.assign", unit)
        statuses = list(TaskStatus.objects.filter(Q(unit=unit) | Q(unit__isnull=True)).order_by("position", "id"))
        statuses.sort(key=lambda status: status.unit_id != unit.id)
        mapping = dict(configuration.get("status_map", {}))
        options = next((col.get("options", []) for col in block["columns"] if col["id"] == "status"), [])
        for option in options:
            if mapping.get(option["value"]):
                continue
            status = next((status for status in statuses if status.category == option["value"]), None)
            if not status:
                raise ValidationError("Asocia el estado «" + option["label"] + "» en Configurar antes de asignar esta tarea.")
            mapping[option["value"]] = str(status.id)
        block["task"] = {**configuration, "enabled": True, "unit": str(unit.id), "status_map": mapping}
        validate_connection(block, actor)
        return True
    return False


def validate_connection(block, actor):
    configuration = block.get("task", {})
    if not configuration.get("enabled"):
        return None
    if not {"title", "responsible", "status"}.issubset({col["id"] for col in block["columns"]}):
        raise ValidationError("Conectar tareas requiere columnas Tarea, Responsable y Estado.")
    try:
        unit = OrganizationalUnit.objects.get(pk=UUIDField().run_validation(configuration.get("unit")))
    except (OrganizationalUnit.DoesNotExist, ValueError, TypeError) as exc:
        raise ValidationError("Selecciona el departamento antes de conectar tareas.") from exc
    mapping = configuration.get("status_map", {})
    options = next(col.get("options", []) for col in block["columns"] if col["id"] == "status")
    if not options or not {option["value"] for option in options}.issubset(mapping):
        raise ValidationError("Asocia todos los estados de la tabla antes de activar tareas.")
    valid_ids = {str(value) for value in TaskStatus.objects.filter(Q(unit=unit) | Q(unit__isnull=True)).values_list("id", flat=True)}
    if any(value not in valid_ids for value in mapping.values()):
        raise ValidationError("Un estado no pertenece al departamento elegido.")
    return unit


def apply_tasks(workbook, previous, request):
    connected = False
    for sheet, block in blocks(workbook.document):
        connected = connect_automatic_tasks(sheet, block, request.assignment) or connected
    if connected:
        validate_document(workbook.document)
    old_rows = {row: row_values(sheet, block, row) for sheet, block in blocks(previous) for row in block["rowIds"]}
    old_connections = {row: block.get("task", {}) for _, block in blocks(previous) for row in block["rowIds"]}
    linked = {str(link.row_id): link for link in workbook.task_links.select_related("task__status", "task__unit").all()}
    active = set()
    with suppress_reverse():
        for sheet, block in blocks(workbook.document):
            configuration = block.get("task", {})
            if not configuration.get("enabled"):
                continue
            unit = validate_connection(block, request.assignment)
            for row_id in block["rowIds"]:
                values = row_values(sheet, block, row_id)
                link = linked.get(row_id)
                if link:
                    active.add(row_id)
                changed = values != old_rows.get(row_id) or configuration != old_connections.get(row_id)
                if not changed and link and link.active:
                    continue
                if link and not link.active and link.task.unit_id != unit.id:
                    raise ValidationError("La tarea se movió a otro departamento. Duplica la fila sin vínculos para conectar una tarea nueva.")
                title = str(values.get("title") or "").strip()
                assignee = assignment_for(values.get("responsible"), unit)
                collaborators = values.get("collaborators") or ""
                if not isinstance(collaborators, str):
                    raise ValidationError("Colaboradores inválidos.")
                collaborator_ids = [str(assignment_for(value, unit).id) for value in collaborators.split(",") if value]
                people = {str(value.employee_id): value for value in PositionAssignment.objects.filter(pk__in=collaborator_ids)}
                collaborator_ids = [str(value.id) for value in people.values() if not assignee or value.employee_id != assignee.employee_id]
                if not link and (not title or not assignee and not collaborator_ids):
                    continue
                if not title:
                    raise ValidationError("Una tarea vinculada necesita título. Eliminar la fila conserva y desvincula la tarea.")
                status_key = values.get("status") or next(iter(configuration["status_map"]))
                status_id = configuration["status_map"].get(status_key)
                if not status_id:
                    raise ValidationError("Asocia este estado con un estado del departamento.")
                data = {"unit": str(unit.id), "title": title, "assignee_assignment": str(assignee.id) if assignee else None, "status": status_id}
                for key in ("priority", "due_date", "description"):
                    if key in values:
                        data[key] = values[key] or {"priority": "medium", "due_date": None, "description": ""}[key]
                if data.get("priority", "medium") not in {"low", "medium", "high"}:
                    raise ValidationError("Prioridad inválida.")
                task = link.task if link else None
                if task and task.deleted_at:
                    raise ValidationError("La tarea vinculada está en la papelera. Restaura la tarea o duplica la fila sin vínculos.")
                task_permission(request.assignment, "tasks.task.update" if task else "tasks.task.create", unit, task)
                if task and task.unit_id != unit.id:
                    task_permission(request.assignment, "tasks.task.update", task.unit, task)
                    task_permission(request.assignment, "tasks.task.assign", task.unit, task)
                if not task or str(task.assignee_assignment_id or "") != str(assignee.id if assignee else ""):
                    task_permission(request.assignment, "tasks.task.assign", unit, task)
                serializer = TaskSerializer(task, data=data, partial=bool(task), context={"request": request})
                serializer.is_valid(raise_exception=True)
                task = serializer.save()
                if not link:
                    link = TaskLink.objects.create(workbook=workbook, sheet_id=sheet["id"], block_id=block["id"], row_id=row_id, task=task)
                else:
                    link.sheet_id, link.block_id = sheet["id"], block["id"]
                    link.active = True
                    link.save(update_fields=["sheet_id", "block_id", "active"])
                active.add(row_id)
                existing = set(str(value) for value in TaskFollower.objects.filter(task=task).exclude(assignment=task.created_by_assignment).values_list("assignment_id", flat=True))
                if "collaborators" in values and existing != set(collaborator_ids):
                    task_permission(request.assignment, "tasks.task.assign", unit, task)
                    TaskFollower.objects.filter(task=task).exclude(assignment=task.created_by_assignment).exclude(assignment_id__in=collaborator_ids).delete()
                    for person_id in collaborator_ids:
                        TaskFollower.objects.get_or_create(task=task, assignment_id=person_id, defaults={"notification_level": "all", "added_by_assignment": request.assignment})
                note = str(values.get("note") or "").strip()
                note_hash = sha256(note.encode()).hexdigest() if note else ""
                if note and note_hash != link.note_hash:
                    task_permission(request.assignment, "tasks.comment.create", unit, task)
                    comment = CommentSerializer(data={"task": str(task.id), "body": note}, context={"request": request})
                    comment.is_valid(raise_exception=True)
                    saved = comment.save(author_assignment=request.assignment)
                    link.note_hash = sha256(saved.body.encode()).hexdigest()
                    link.save(update_fields=["note_hash"])
                    set_value(sheet, block, row_id, "note", saved.body)
                elif not note and "note" in values and link.note_hash:
                    latest = Comment.objects.filter(task=task, image_section="comments").order_by("-created_at").first()
                    set_value(sheet, block, row_id, "note", latest.body if latest else "")
                set_value(sheet, block, row_id, "description", task.description or "")
                ActivityLog.objects.create(task=task, actor_assignment=request.assignment, action="sheet.updated", metadata_json={"workbook": str(workbook.id), "row": row_id})
        workbook.task_links.filter(active=True).exclude(row_id__in=active).update(active=False)
    from .images import bind_images
    bind_images(workbook, request)


@transaction.atomic
def refresh_from_task(task_id):
    link = TaskLink.objects.filter(task_id=task_id, active=True).first()
    if not link:
        return
    workbook = Workbook.objects.select_for_update().get(pk=link.workbook_id)
    if workbook.deleted_at:
        return
    task = Task.all_objects.select_related("status").get(pk=task_id)
    from .access import require_file
    try:
        require_file(workbook.creator, workbook)
    except PermissionDenied:
        return
    changed = False
    for sheet, block in blocks(workbook.document):
        if str(link.row_id) not in block["rowIds"]:
            continue
        if task.deleted_at or str(task.unit_id) != block["task"].get("unit"):
            # Sharing this file cannot follow a task into another department.
            link.active = False
            link.save(update_fields=["active"])
            changed = True
            break
        try:
            task_permission(workbook.creator, "tasks.task.read", task.unit, task)
        except PermissionDenied:
            return
        values = row_values(sheet, block, str(link.row_id))
        mapping = block["task"].get("status_map", {})
        status_key = next((key for key, value in mapping.items() if value == str(task.status_id)), None)
        if status_key is None:
            status_key = "task-" + str(task.status_id)
            mapping[status_key] = str(task.status_id)
            status_col = next(col for col in block["columns"] if col["id"] == "status")
            status_col.setdefault("options", []).append({"value": status_key, "label": task.status.name, "color": "#8a96a8"})
        comment = Comment.objects.filter(task=task, image_section="comments").order_by("-created_at").first()
        followers = task.followers.order_by("assignment_id")
        if str(task.created_by_assignment_id) not in str(values.get("collaborators") or "").split(","):
            followers = followers.exclude(assignment=task.created_by_assignment)
        incoming = {"title": task.title, "responsible": str(task.assignee_assignment_id or ""), "collaborators": ",".join(str(value) for value in followers.values_list("assignment_id", flat=True)), "priority": task.priority, "due_date": task.due_date.isoformat() if task.due_date else "", "status": status_key, "description": task.description or "", "note": comment.body if comment else ""}
        for key, value in incoming.items():
            if key in values and values[key] != value:
                set_value(sheet, block, str(link.row_id), key, value)
                changed = True
        link.note_hash = sha256(comment.body.encode()).hexdigest() if comment else ""
        link.save(update_fields=["note_hash"])
    if changed:
        from .operations import publish, mark_pending
        from .images import bind_images
        bind_images(workbook)
        workbook.revision += 1
        mark_pending(workbook)
        workbook.save()
        transaction.on_commit(lambda: publish(workbook.id, {"revision": workbook.revision, "source": "task"}))
