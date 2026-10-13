from copy import deepcopy
from datetime import timedelta
from functools import partial
from hashlib import sha256
import json
import uuid

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import APIException, ValidationError
from rest_framework.serializers import IntegerField, UUIDField

from boldApp.administrativo.services import record_system_event
from .access import require_file, require_module
from .document import add_block, address, blank_sheet, blocks, cell_at, decorate, duplicate, put_cell, reconcile_markers, unique_sheet_name, validate_document
from .models import Operation, Workbook
from .task_bridge import apply_tasks, validate_connection


class Conflict(APIException):
    status_code = 409

    def __init__(self, detail):
        # DRF's default converts numbers and booleans into strings inside conflict payloads.
        self.detail = detail if isinstance(detail, dict) else {"detail": str(detail)}


def publish(workbook_id, data):
    layer = get_channel_layer()
    if layer:
        async_to_sync(layer.group_send)("sheet_" + str(workbook_id), {"type": "sheet.changed", "data": data})


def mark_pending(workbook):
    workbook.calculation_error = ""
    if not workbook.drive_account_id or workbook.sync_state in {"external", "importing"}:
        from .tasks import enqueue
        transaction.on_commit(partial(enqueue, str(workbook.pk), timezone.now() + timedelta(seconds=3)))
        return
    now = timezone.now()
    workbook.pending_since = workbook.pending_since or now
    workbook.sync_after = min(now + timedelta(seconds=3), workbook.pending_since + timedelta(seconds=15))
    workbook.sync_state = "pending"
    workbook.attempts = 0
    from .tasks import enqueue
    transaction.on_commit(partial(enqueue, str(workbook.pk), workbook.sync_after))


def find_block(document, sheet_id, block_id):
    try:
        sheet = document["sheets"][sheet_id]
        return sheet, next(block for block in sheet["__bold"]["blocks"] if block["id"] == block_id)
    except (KeyError, StopIteration) as exc:
        raise ValidationError("El bloque ya no existe. Conservamos tus cambios pendientes.") from exc


def shift_rows(document, sheet, start, delta):
    from .engine import call
    result = call("shift", document, sheet=sheet["id"], row=start, count=delta)["document"]
    # Univer adjusts formulas across all worksheets, including absolute and named references.
    for key in document["sheetOrder"]:
        metadata = document["sheets"][key]["__bold"]
        document["sheets"][key].clear()
        document["sheets"][key].update(result["sheets"][key])
        document["sheets"][key]["__bold"] = metadata
    for block in sheet["__bold"]["blocks"]:
        if block["startRow"] >= start:
            block["startRow"] += delta
    document["styles"] = result.get("styles", {})
    if "resources" in result:
        document["resources"] = result["resources"]


def _change_structure(document, change):
    kind = change.get("kind")
    if kind == "grid":
        snapshot = deepcopy(change["document"])
        snapshot["id"] = document["id"]
        snapshot["name"] = document["name"]
        for sheet_id in snapshot["sheetOrder"]:
            if sheet_id not in document["sheets"]:
                raise ValidationError("Añade hojas desde las pestañas de BOLD.")
            snapshot["sheets"][sheet_id]["__bold"] = deepcopy(document["sheets"][sheet_id]["__bold"])
        if set(snapshot["sheetOrder"]) != set(document["sheetOrder"]):
            raise ValidationError("Elimina hojas desde las pestañas de BOLD.")
        return reconcile_markers(snapshot)
    if kind == "sheet.add":
        sheet = blank_sheet(unique_sheet_name(document, change.get("name", "Nueva hoja")))
        document["sheets"][sheet["id"]] = sheet
        document["sheetOrder"].append(sheet["id"])
        return document
    sheet = document["sheets"].get(change.get("sheet"))
    if not sheet:
        raise ValidationError("La hoja ya no existe.")
    if kind == "sheet.rename":
        from .engine import call
        document = call("sheet", document, sheet=sheet["id"], action="rename", name=unique_sheet_name(document, change.get("name", ""), exclude=sheet["id"]))["document"]
    elif kind == "sheet.remove":
        if len(document["sheetOrder"]) <= 1:
            raise ValidationError("Conserva al menos una hoja.")
        from .engine import call
        document = call("sheet", document, sheet=sheet["id"], action="remove")["document"]
    elif kind == "sheet.copy":
        from .engine import call
        document = call("sheet", document, sheet=sheet["id"], action="copy", name=unique_sheet_name(document, change.get("name", sheet["name"])))["document"]
        copied_id = document.pop("copiedSheet")
        copied = document["sheets"][copied_id]
        isolated = {**document, "sheetOrder": [copied_id], "sheets": {copied_id: copied}}
        detached = next(iter(duplicate(isolated)["sheets"].values()))
        detached = json.loads(json.dumps(detached).replace(detached["id"], copied_id))
        document["sheets"][copied_id] = detached
    elif kind == "sheet.move":
        order = change.get("order")
        if set(order or []) != set(document["sheetOrder"]) or len(order) != len(document["sheetOrder"]):
            raise ValidationError("Orden de hojas inválido.")
        document["sheetOrder"] = order
    elif kind == "block.add":
        add_block(sheet, change.get("type"), change.get("title"))
    else:
        sheet, block = find_block(document, change.get("sheet"), change.get("block"))
        if kind == "block.configure":
            allowed = {"title", "columns", "currency", "tax", "discount", "conversion", "task"}
            data = change.get("configuration", {})
            if not set(data).issubset(allowed):
                raise ValidationError("Configuración de bloque inválida.")
            old = {col["id"]: i + 1 for i, col in enumerate(block["columns"])}
            if "columns" in data:
                new_ids = [column["id"] for column in data["columns"]]
                old_ids = list(old)
                if [key for key in new_ids if key in old] != [key for key in old_ids if key in new_ids]:
                    raise ValidationError("Reordena columnas existentes desde la cuadrícula; Configurar permite añadir o quitar campos.")
                if new_ids != old_ids:
                    from .engine import call
                    document = call("columns", document, sheet=sheet["id"], block=block["id"], columns=new_ids)["document"]
                    sheet, block = find_block(document, sheet["id"], block["id"])
            block.update(deepcopy(data))
            decorate(sheet, block)
        elif kind in {"row.add", "row.remove", "row.move"}:
            rows = block["rowIds"]
            if kind == "row.add":
                index = min(max(int(change.get("index", len(rows))), 0), len(rows))
                count = IntegerField(min_value=1, max_value=500).run_validation(change.get("count", 1))
                shift_rows(document, sheet, block["startRow"] + index + 1, count)
                rows[index:index] = [str(uuid.uuid4()) for _ in range(count)]
            elif kind == "row.remove":
                try:
                    index = rows.index(change.get("row"))
                except ValueError as exc:
                    raise ValidationError("La fila ya no existe.") from exc
                count = IntegerField(min_value=1, max_value=500).run_validation(change.get("count", 1))
                if index + count > len(rows):
                    raise ValidationError("La selección excede las filas de la tabla.")
                shift_rows(document, sheet, block["startRow"] + index + 1, -count)
                del rows[index:index + count]
            else:
                order = change.get("order", [])
                if set(order) != set(rows) or len(order) != len(rows):
                    raise ValidationError("Orden de filas inválido.")
                from .engine import call
                document = call("reorder", document, sheet=sheet["id"], block=block["id"], order=order)["document"]
                sheet, block = find_block(document, sheet["id"], block["id"])
            decorate(sheet, block)
        elif kind == "block.remove":
            end = block["startRow"] + len(block["rowIds"]) + (2 if block["type"] in {"costs", "comparison"} else 1)
            sheet["cellData"] = {row: cells for row, cells in sheet["cellData"].items() if not block["startRow"] <= int(row) < end}
            sheet["__bold"]["blocks"].remove(block)
        elif kind == "block.move":
            order = change.get("order", [])
            existing = sheet["__bold"]["blocks"]
            if set(order) != {value["id"] for value in existing} or len(order) != len(existing):
                raise ValidationError("Orden de bloques inválido.")
            from .engine import call
            document = call("reorder", document, sheet=sheet["id"], order=order)["document"]
        else:
            raise ValidationError("Operación desconocida.")
    return document


def change_structure(document, change):
    try:
        return _change_structure(document, change)
    except (KeyError, TypeError, AttributeError, ValueError, OverflowError, StopIteration) as exc:
        raise ValidationError("Operación estructural inválida. Conservamos el borrador.") from exc


@transaction.atomic
def apply_operation(workbook_id, request):
    data = request.data
    try:
        operation_id = UUIDField().run_validation(data["id"])
        base = IntegerField(min_value=0).run_validation(data["revision"])
        changes = data["changes"]
    except (KeyError, ValueError, TypeError) as exc:
        raise ValidationError("Operación o revisión inválida.") from exc
    if not isinstance(changes, list) or not 1 <= len(changes) <= 1000:
        raise ValidationError("Envía entre 1 y 1000 cambios por operación.")
    if any(not isinstance(change, dict) or change.get("kind") == "cell" and (not isinstance(change.get("before", {}), dict) or not isinstance(change.get("after", {}), dict)) for change in changes):
        raise ValidationError("Cambios de celda inválidos.")
    for change in changes:
        if not isinstance(change.get("kind"), str) or "sheet" in change and not isinstance(change["sheet"], str) or "block" in change and not isinstance(change["block"], str):
            raise ValidationError("Identificadores de operación inválidos.")
        if change.get("kind") == "cell" and not isinstance(change.get("column"), (str, int)):
            raise ValidationError("Columna inválida.")
        if change.get("kind") == "block.configure" and not isinstance(change.get("configuration", {}), dict):
            raise ValidationError("Configuración inválida.")
        if change.get("kind") == "grid":
            validate_document(change.get("document"))
            if "baseDocument" in change:
                validate_document(change["baseDocument"])
    workbook = Workbook.objects.select_for_update().get(pk=workbook_id)
    require_file(request.assignment, workbook, "edit")
    if any(change.get("kind") == "grid" and "baseDocument" in change and change["baseDocument"]["id"] != workbook.document["id"] for change in changes):
        raise ValidationError("La base de la cuadrícula pertenece a otro archivo.")
    digest = sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()
    existing = Operation.objects.filter(pk=operation_id).first()
    if existing:
        if existing.workbook_id != workbook.id or existing.actor_id != request.user.id or existing.request_hash != digest:
            raise ValidationError("El identificador de operación ya se utilizó para otro cambio.")
        return workbook
    if base > workbook.revision or base < 0:
        raise ValidationError("Revisión inválida.")
    if any(change.get("kind") not in {"cell", "grid"} or change.get("kind") == "grid" and "baseDocument" not in change for change in changes) and base != workbook.revision:
        raise Conflict({"detail": "La estructura cambió. Conservamos el borrador; revisa antes de aplicarlo.", "revision": workbook.revision, "structural": True, "document": workbook.document, "draft": changes})
    changes = deepcopy(changes)
    previous = deepcopy(workbook.document)
    conflicts = []
    people = None
    for change in changes:
        if change.get("kind") == "cell":
            if change.get("block"):
                sheet, block = find_block(workbook.document, change.get("sheet"), change.get("block"))
                column = next((column for column in block["columns"] if column["id"] == change.get("column")), {})
                if column.get("type") in {"responsible", "collaborators"}:
                    require_module(request.assignment, "assign")
                row, col = address(sheet, block, change.get("row"), change.get("column"))
            else:
                sheet = workbook.document["sheets"].get(change.get("sheet"))
                try:
                    row, col = int(change.get("row")), int(change.get("column"))
                except (ValueError, TypeError) as exc:
                    raise ValidationError("Dirección de celda inválida.") from exc
                if sheet is None or col == 0 and sheet.get("__bold", {}).get("technicalColumn") is not False:
                    raise ValidationError("No puedes modificar identificadores técnicos.")
            current = cell_at(sheet, row, col)
            if change.get("block") and column.get("type") in {"responsible", "collaborators"}:
                value = change.get("after", {}).get("v")
                if isinstance(value, str) and value.lstrip().startswith("["):
                    try:
                        labels = json.loads(value)
                    except ValueError as exc:
                        raise ValidationError("Selecciona personas desde el directorio.") from exc
                    if not isinstance(labels, list) or any(not isinstance(label, str) or not label.strip() for label in labels) or column["type"] == "responsible" and len(labels) > 1:
                        raise ValidationError("Selección de personas inválida.")
                    if people is None:
                        from .engine import directory
                        people = directory()
                    selected = []
                    for label in labels:
                        candidates = [person for person in people if (not block.get("task", {}).get("enabled") or person["unit"] == block["task"]["unit"]) and label.strip() in {person["id"], person["name"], person["email"], person["name"] + " <" + person["email"] + ">"}]
                        if len({person["employee"] for person in candidates}) != 1:
                            raise ValidationError("Persona desconocida o con nombre repetido. Selecciona su perfil desde Bloques.")
                        person = next((person for person in candidates if person["id"] in str(current.get("v") or "").split(",")), candidates[0])
                        selected.append(person["id"])
                    change["after"] = {**change["after"], "v": ",".join(dict.fromkeys(selected))}
            # Formula cached results do not count as independent user edits.
            equivalent = lambda value: {key: item for key, item in value.items() if key not in {"t", "si"} and item is not None and item != {} and (key != "v" or not value.get("f"))}
            if equivalent(current) != equivalent(change.get("before", {})) and equivalent(current) != equivalent(change.get("after", {})):
                conflicts.append({"change": change, "current": current, "incoming": change.get("after", {}), "sheet": sheet["id"], "row": row, "column": col})
            else:
                put_cell(sheet, row, col, deepcopy(change.get("after", {})))
        else:
            if change.get("kind") == "block.configure" and "task" in change.get("configuration", {}):
                _, configured = find_block(workbook.document, change.get("sheet"), change.get("block"))
                if change["configuration"]["task"] != configured.get("task"):
                    require_module(request.assignment, "assign")
            if change.get("kind") == "grid" and base != workbook.revision:
                from .drive_merge import merge_documents
                try:
                    merged = merge_documents(change["baseDocument"], workbook.document, change["document"])
                except Conflict as exc:
                    raise Conflict({**exc.detail, "revision": workbook.revision, "structural": True, "document": previous, "draft": changes}) from exc
                except (KeyError, TypeError, AttributeError, ValueError) as exc:
                    raise ValidationError("La base de la cuadrícula contiene datos inválidos. Conservamos el borrador.") from exc
                change = {**change, "document": merged}
            workbook.document = change_structure(workbook.document, change)
    if conflicts:
        raise Conflict({"detail": "Otra persona cambió estas celdas. Elige qué valor conservar.", "revision": workbook.revision, "conflicts": conflicts, "document": previous})
    validate_document(workbook.document)
    from .document import row_values
    old_assignments = {(row, column["id"]): row_values(sheet, block, row).get(column["id"]) for sheet, block in blocks(previous) for row in block["rowIds"] for column in block["columns"] if column["type"] in {"responsible", "collaborators"}}
    new_assignments = {(row, column["id"]): row_values(sheet, block, row).get(column["id"]) for sheet, block in blocks(workbook.document) for row in block["rowIds"] for column in block["columns"] if column["type"] in {"responsible", "collaborators"}}
    if any(value != old_assignments.get(key, "") for key, value in new_assignments.items()):
        require_module(request.assignment, "assign")
    old_configurations = {block["id"]: block.get("task") for _, block in blocks(previous)}
    for _, block in blocks(workbook.document):
        if block.get("task") != old_configurations.get(block["id"]) and block.get("task", {}).get("enabled"):
            require_module(request.assignment, "assign")
            validate_connection(block, request.assignment)
    apply_tasks(workbook, previous, request)
    workbook.revision += 1
    mark_pending(workbook)
    workbook.save()
    Operation.objects.create(id=operation_id, workbook=workbook, actor=request.user, request_hash=digest, base_revision=base, revision=workbook.revision, changes=changes)
    record_system_event("sheets.operation", request, module_code="sheets", target_type="workbook", target_id=workbook.id, metadata={"operation": str(operation_id), "revision": workbook.revision})
    transaction.on_commit(partial(publish, workbook.id, {"id": str(operation_id), "revision": workbook.revision}))
    return workbook
