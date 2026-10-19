"""A single Univer snapshot is the source for both the grid and visual blocks."""
from bisect import bisect_left, bisect_right
from copy import deepcopy
from html import escape
import json
import math
import re
import uuid

from rest_framework.exceptions import ValidationError
from django.utils.dateparse import parse_date

CELL_KEYS = {"v", "f", "t", "s", "p", "si", "custom"}
TYPES = {"text", "number", "currency", "date", "responsible", "collaborators", "dropdown", "checkbox", "file", "formula"}
BLOCK_TYPES = {"tasks", "costs", "comparison", "summary", "text"}
PRIORITIES = [{"value": "low", "label": "Baja", "color": "#16b889"}, {"value": "medium", "label": "Media", "color": "#e7aa27"}, {"value": "high", "label": "Alta", "color": "#ef3340"}]
STATES = [{"value": "todo", "label": "Pendiente", "color": "#8a96a8"}, {"value": "in_progress", "label": "En proceso", "color": "#e7aa27"}, {"value": "completed", "label": "Terminado", "color": "#16b889"}]


def identity():
    return str(uuid.uuid4())


def column(key, name, kind="text", **extra):
    return {"id": key, "name": name, "type": kind, **extra}


def columns(kind):
    if kind in {"costs", "comparison"}:
        result = [column("product", "Producto"), column("price", "Precio", "currency"), column("quantity", "Cantidad", "number"), column("total", "Total", "formula")]
        if kind == "comparison":
            result += [column("previous", "Anterior", "currency"), column("difference", "Diferencia", "formula")]
        return result
    if kind == "text":
        return [column("description", "Contenido")]
    if kind == "summary":
        return [column("label", "Concepto"), column("value", "Valor", "formula")]
    return [column("account", "Cuenta"), column("title", "Tarea"), column("responsible", "Responsable", "responsible"), column("collaborators", "Colaboradores", "collaborators"), column("priority", "Prioridad", "dropdown", options=deepcopy(PRIORITIES)), column("due_date", "Entrega", "date"), column("status", "Estado", "dropdown", options=deepcopy(STATES)), column("description", "Archivo / descripción", "file"), column("note", "Última nota")]


def blank_sheet(name="Hoja 1"):
    key = identity()
    return {"id": key, "name": name, "rowCount": 1000, "columnCount": 40, "defaultColumnWidth": 140, "defaultRowHeight": 28, "cellData": {}, "columnData": {"0": {"hd": 1}}, "freeze": {"startRow": -1, "startColumn": -1, "xSplit": 0, "ySplit": 0}, "__bold": {"blocks": []}}


def unique_sheet_name(document, name, exclude=None):
    if not isinstance(name, str):
        raise ValidationError("Nombre de hoja inválido.")
    name = name.strip()
    if not 1 <= len(name) <= 31 or re.search(r"[\\/*?:\[\]]", name) or name.upper().startswith("__BOLD"):
        raise ValidationError("Usa un nombre de hoja válido de hasta 31 caracteres.")
    used = {sheet["name"].casefold() for key, sheet in document["sheets"].items() if key != exclude}
    candidate, number = name, 2
    while candidate.casefold() in used:
        suffix = f" {number}"
        candidate = name[:31 - len(suffix)] + suffix
        number += 1
    return candidate


def blank(name):
    sheet = blank_sheet()
    return {"id": identity(), "name": name, "appVersion": "1.0.3", "locale": "esES", "styles": {}, "sheetOrder": [sheet["id"]], "sheets": {sheet["id"]: sheet}}


def blocks(document):
    for sheet_id in document["sheetOrder"]:
        sheet = document["sheets"][sheet_id]
        for block in sheet.get("__bold", {}).get("blocks", []):
            yield sheet, block


def address(sheet, block, row_id, key):
    try:
        return block["startRow"] + 1 + block["rowIds"].index(str(row_id)), 1 + next(i for i, col in enumerate(block["columns"]) if col["id"] == key)
    except (ValueError, StopIteration) as exc:
        raise ValidationError("La fila o columna ya no existe. Conserva el borrador y revisa los cambios.") from exc


def cell_at(sheet, row, col):
    return sheet.get("cellData", {}).get(str(row), {}).get(str(col)) or {}


def put_cell(sheet, row, col, cell):
    sheet.setdefault("cellData", {}).setdefault(str(row), {})[str(col)] = cell


def row_values(sheet, block, row_id):
    row = block["startRow"] + 1 + block["rowIds"].index(str(row_id))
    values = {}
    for i, col in enumerate(block["columns"]):
        cell = cell_at(sheet, row, i + 1)
        value = cell.get("v", "")
        if col["id"] in {"description", "note"} or col["type"] == "file":
            link = next((part.get("properties", {}).get("url") for part in (cell.get("p") or {}).get("body", {}).get("customRanges", []) if part.get("rangeType") == 0), None)
            if link and re.match(r"^https?://", link, re.I) and not str(value).startswith("<!--bold-rich-text-->"):
                value = f'<!--bold-rich-text--><p><a href="{escape(link, quote=True)}">{escape(str(value or link))}</a></p>'
        values[col["id"]] = value
    return values


def set_value(sheet, block, row_id, key, value):
    if key not in {col["id"] for col in block["columns"]}:
        return
    row, col = address(sheet, block, row_id, key)
    cell = {**cell_at(sheet, row, col), "v": value}
    if cell_at(sheet, row, col).get("v") != value:
        cell.pop("p", None)
        cell.pop("si", None)
    put_cell(sheet, row, col, cell)


def excel_column(index):
    result = ""
    while index:
        index, remainder = divmod(index - 1, 26)
        result = chr(65 + remainder) + result
    return result


def decorate(sheet, block):
    start = block["startRow"]
    put_cell(sheet, start, 0, {"v": "block:" + block["id"]})
    for i, col in enumerate(block["columns"], 1):
        previous = cell_at(sheet, start, i)
        header_style = {"bg": {"rgb": "#ef3340"}, "cl": {"rgb": "#ffffff"}, "bl": 1, "tb": 3, "vt": 2, "fs": 11}
        style = previous.get("s")
        put_cell(sheet, start, i, {**previous, "v": col["name"], "custom": {**previous.get("custom", {}), "boldColumn": col["id"], "boldBlock": block["id"]}, "s": {**header_style, **style} if isinstance(style, dict) else style or header_style})
        width = 320 if col["id"] in {"title", "description", "note"} or col["type"] == "file" else 210 if col["type"] in {"responsible", "collaborators"} else 180 if col["type"] == "text" else 140
        sheet.setdefault("columnData", {}).setdefault(str(i), {}).setdefault("w", width)
    sheet.setdefault("rowData", {}).setdefault(str(start), {}).setdefault("h", 36)
    for i, row_id in enumerate(block["rowIds"], start + 1):
        put_cell(sheet, i, 0, {"v": row_id})
        for j, col in enumerate(block["columns"], 1):
            current = cell_at(sheet, i, j)
            style = current.get("s")
            default_style = {"tb": 3, "vt": 2, "fs": 11, "bg": {"rgb": "#f5f7fa" if (i - start) % 2 == 0 else "#ffffff"}, "cl": {"rgb": "#252a33"}}
            if col["type"] == "currency" or block["type"] in {"costs", "comparison"} and col["type"] == "formula":
                default_style["n"] = {"pattern": '"' + block["currency"] + ' "#,##0.00'}
            put_cell(sheet, i, j, {**current, "s": {**default_style, **style} if isinstance(style, dict) else style or default_style})
        row_data = sheet["rowData"].setdefault(str(i), {})
        if "h" not in row_data:
            row_data.setdefault("ia", 1)
        if block["type"] in {"costs", "comparison"}:
            indices = {col["id"]: j + 1 for j, col in enumerate(block["columns"])}
            price, quantity = excel_column(indices["price"] + 1), excel_column(indices["quantity"] + 1)
            current = cell_at(sheet, i, indices["total"])
            put_cell(sheet, i, indices["total"], {**current, "f": current.get("f") or f"={price}{i + 1}*{quantity}{i + 1}", "s": current.get("s") or {"n": {"pattern": '#,##0.00'}}})
            if block["type"] == "comparison":
                total, previous = excel_column(indices["total"] + 1), excel_column(indices["previous"] + 1)
                current = cell_at(sheet, i, indices["difference"])
                put_cell(sheet, i, indices["difference"], {**current, "f": current.get("f") or f"={total}{i + 1}-{previous}{i + 1}"})
    if block["type"] in {"costs", "comparison"}:
        end = start + len(block["rowIds"]) + 1
        total_index = 1 + next(i for i, col in enumerate(block["columns"]) if col["id"] == "total")
        total = excel_column(total_index + 1)
        put_cell(sheet, end, 0, {"v": "subtotal:" + block["id"]})
        conversion = block.get("conversion", {})
        currency = conversion.get("currency") or block["currency"]
        put_cell(sheet, end, 1, {"v": "Subtotal " + currency})
        current = cell_at(sheet, end, total_index)
        put_cell(sheet, end, total_index, {**current, "f": subtotal_formula(block), "v": None})
    sheet.setdefault("columnData", {})["0"] = {"hd": 1}


def subtotal_formula(block):
    total = excel_column(2 + next(i for i, col in enumerate(block["columns"]) if col["id"] == "total"))
    end = block["startRow"] + len(block["rowIds"]) + 1
    formula = f"=SUM({total}{block['startRow'] + 2}:{total}{end})*(1-{format(block.get('discount', 0), '.15g')}/100)*(1+{format(block.get('tax', 0), '.15g')}/100)" if block["rowIds"] else "=0"
    if block.get("conversion", {}).get("currency"):
        formula += "*" + format(block["conversion"]["rate"], ".15g")
    return formula


def add_block(sheet, kind, title=None, custom_columns=None):
    if kind not in BLOCK_TYPES:
        raise ValidationError("Tipo de bloque inválido.")
    block = {"id": identity(), "type": kind, "title": title or {"tasks": "Tareas", "costs": "Productos y licencias", "comparison": "Anterior / actual", "summary": "Resumen", "text": "Texto"}[kind], "startRow": max([int(key) for key in sheet.get("cellData", {})] + [-2]) + 3, "columns": custom_columns or columns(kind), "rowIds": [identity() for _ in range(3 if kind not in {"text", "summary"} else 1)], "currency": "USD", "tax": 0, "discount": 0, "task": {"enabled": False, "unit": "", "status_map": {}}}
    sheet["__bold"]["blocks"].append(block)
    decorate(sheet, block)
    return block


def agenda():
    document = blank("Agenda de triunfos")
    document["sheets"], document["sheetOrder"] = {}, []
    sets = {
        "Liderazgo": ["account", "title", "due_date", "responsible", "status", "note"],
        "Procesos": ["number", "area", "account", "title", "responsible", "priority", "due_date", "status", "description", "note"],
        "IT": ["account", "title", "priority", "due_date", "responsible", "status", "note"],
        "Herramientas": ["number", "tool", "purpose", "title", "responsible", "priority", "due_date", "status", "description", "note"],
        "Copia de Procesos": ["area", "account", "title", "priority", "due_date", "responsible", "status", "note"],
        "Bold Lab": ["topic", "title", "responsible", "collaborators", "status", "note"],
    }
    base = {col["id"]: col for col in columns("tasks")}
    base.update({"number": column("number", "N.º", "number"), "area": column("area", "Área"), "tool": column("tool", "IA / herramienta"), "purpose": column("purpose", "Propósito"), "topic": column("topic", "Tema")})
    for name, keys in sets.items():
        sheet = blank_sheet(name)
        document["sheets"][sheet["id"]] = sheet
        document["sheetOrder"].append(sheet["id"])
        add_block(sheet, "tasks", name, [deepcopy(base[key]) for key in keys])
        if name == "Herramientas":
            add_block(sheet, "costs")
            add_block(sheet, "comparison")
    return document


def duplicate(document):
    result = deepcopy(document)
    result["id"] = identity()
    identities = {document["id"]: result["id"]}
    sheets = {}
    for key in result["sheetOrder"]:
        sheet = result["sheets"][key]
        sheet["id"] = identity()
        identities[key] = sheet["id"]
        for block in sheet.get("__bold", {}).get("blocks", []):
            old_id = block["id"]
            block["id"] = identity()
            identities[old_id] = block["id"]
            previous = list(block["rowIds"])
            block["rowIds"] = [identity() for _ in previous]
            identities.update(zip(previous, block["rowIds"]))
            block["task"]["enabled"] = False
            for row in block["rowIds"]:
                for col in block["columns"]:
                    if col["type"] in {"responsible", "collaborators"}:
                        set_value(sheet, block, row, col["id"], "")
            decorate(sheet, block)
        sheets[sheet["id"]] = sheet
    result["sheetOrder"] = list(sheets)
    result["sheets"] = sheets
    raw = json.dumps(result)
    for old, new in identities.items():
        raw = raw.replace(old, new)
    result = json.loads(raw)
    return result


def recreate_agenda(content):
    document = agenda()
    for sheet in document["sheets"].values():
        previous = sheet["__bold"]["blocks"]
        sheet["cellData"], sheet["__bold"]["blocks"] = {}, []
        for original in previous:
            block = add_block(sheet, original["type"], original["title"], original["columns"])
            records = content.get("tables", {}).get(sheet["name"], []) if block["type"] == "tasks" else content.get(block["type"], [])
            sheet["cellData"] = {row: cells for row, cells in sheet["cellData"].items() if int(row) < block["startRow"]}
            block["rowIds"] = [identity() for _ in records]
            for index, record in enumerate(records, block["startRow"] + 1):
                for col_index, col in enumerate(block["columns"], 1):
                    cell = deepcopy(record.get(col["id"], {}))
                    if col["type"] in {"responsible", "collaborators"}:
                        cell = {"v": ""}
                    elif col["type"] == "dropdown" and cell.get("v") not in {None, ""}:
                        label = str(cell["v"]).strip()
                        selected = next((option for option in col["options"] if option["label"].casefold() == label.casefold()), None)
                        if not selected:
                            selected = {"value": identity(), "label": label, "color": "#8a96a8"}
                            col["options"].append(selected)
                        cell["v"] = selected["value"]
                    put_cell(sheet, index, col_index, cell)
            decorate(sheet, block)
    validate_document(document)
    return document


def _validate_document(document):
    if not isinstance(document, dict) or len(json.dumps(document, ensure_ascii=False).encode("utf-8")) > 8_000_000:
        raise ValidationError("Archivo inválido o mayor de 8 MB de datos.")
    order, sheets = document.get("sheetOrder"), document.get("sheets")
    if not isinstance(order, list) or not isinstance(sheets, dict) or not 1 <= len(order) <= 30 or len(set(order)) != len(order) or set(order) != set(sheets):
        raise ValidationError("El archivo debe contener entre 1 y 30 hojas, con identificadores únicos.")
    row_ids, block_ids, names, count = set(), set(), set(), 0
    for resource in document.get("resources", []):
        if not isinstance(resource.get("data"), str):
            raise ValidationError("Recurso de cuadrícula inválido.")
        if resource.get("name") == "SHEET_TABLE_PLUGIN":
            try:
                data = json.loads(resource["data"] or "{}")
                if not isinstance(data, dict) or any(key not in sheets for key in data):
                    raise ValueError()
                tables = [table for item in data.values() for table in (item if isinstance(item, list) else item.get("tables", []))]
                if len(tables) > 100 or len({item["id"] for item in tables}) != len(tables):
                    raise ValueError()
                for table in tables:
                    if not isinstance(table.get("name"), str) or not 1 <= len(table["name"]) <= 255:
                        raise ValueError()
                    area = table["range"]
                    if any(type(area[key]) is not int for key in ("startRow", "endRow", "startColumn", "endColumn")) or not 0 <= area["startRow"] <= area["endRow"] < 20000 or not 0 <= area["startColumn"] <= area["endColumn"] < 500:
                        raise ValueError()
                    columns = table["columns"]
                    if len(columns) != area["endColumn"] - area["startColumn"] + 1 or len({item["id"] for item in columns}) != len(columns):
                        raise ValueError()
                    for column in columns:
                        if not isinstance(column.get("displayName"), str) or len(column["displayName"]) > 255:
                            raise ValueError()
                        formula = column.get("formula", "")
                        if not isinstance(formula, str) or len(formula) > 4000 or re.search(r"\[[^]]+\]|\b(WEBSERVICE|IMPORTXML|IMPORTDATA|IMPORTRANGE|HYPERLINK)\s*\(|\|", formula, re.I):
                            raise ValueError()
            except (ValueError, KeyError, TypeError, AttributeError):
                raise ValidationError("Tabla de Excel inválida; revisa hojas, rangos e identificadores.")
            continue
        if resource.get("name") in {"__casual_sheets_charts__", "__casual_sheets_pivots__"}:
            try:
                data = json.loads(resource["data"])
                key = "charts" if resource["name"] == "__casual_sheets_charts__" else "pivots"
                models = data[key]
                if key == "charts":
                    removed = data.get("deletedParts", [])
                    if not isinstance(removed, list) or len(removed) > 100 or any(not isinstance(value, str) or not re.fullmatch(r"xl/charts/chart\d+\.xml", value) for value in removed):
                        raise ValueError()
                if not isinstance(models, list) or len(models) > 100 or len({item["id"] for item in models}) != len(models):
                    raise ValueError()
                for item in models:
                    if key == "charts":
                        for field in ("width", "height", "offsetX", "offsetY"):
                            value = item.get("pos", {}).get(field)
                            if value is not None and (type(value) not in {int, float} or not math.isfinite(value) or abs(value) > 1000000 or field in {"width", "height"} and value <= 0):
                                raise ValueError()
                    identities = [item["sheetId"]] if key == "charts" else [item["sourceSheetId"], item["targetSheetId"]]
                    if any(identity not in sheets for identity in identities):
                        raise ValueError()
                    for area in [item["source"], *([item["pos"]] if key == "charts" else [])]:
                        if any(type(area[name]) is not int for name in ("startRow", "endRow", "startColumn", "endColumn")) or not 0 <= area["startRow"] <= area["endRow"] < 20000 or not 0 <= area["startColumn"] <= area["endColumn"] < 500:
                            raise ValueError()
            except (ValueError, KeyError, TypeError):
                raise ValidationError("Gráfico o tabla dinámica inválidos; revisa hojas, rangos e identificadores.")
            continue
        if resource.get("name") == "SHEET_DRAWING_PLUGIN":
            try:
                drawings = json.loads(resource["data"])
                if not isinstance(drawings, dict) or any(identity not in sheets for identity in drawings) or sum(len(item["data"]) for item in drawings.values()) > 500:
                    raise ValueError()
                for item in drawings.values():
                    if len(set(item["order"])) != len(item["order"]) or set(item["order"]) != set(item["data"]):
                        raise ValueError()
                    for drawing in item["data"].values():
                        if drawing.get("drawingType") == 0 and not re.match(r"^(?:data:image/(?:png|jpe?g|gif);base64,|https://)", drawing.get("source", ""), re.I):
                            raise ValueError()
            except (ValueError, KeyError, TypeError):
                raise ValidationError("Imágenes de cuadrícula inválidas o más de 500 imágenes.")
            continue
        if resource.get("name") not in {"SHEET_CONDITIONAL_FORMATTING_PLUGIN", "SHEET_DEFINED_NAME_PLUGIN", "SHEET_DATA_VALIDATION_PLUGIN", "SHEET_FILTER_PLUGIN"}:
            continue
        data = json.loads(resource["data"] or "{}")
        formulas = []
        if resource["name"] == "SHEET_CONDITIONAL_FORMATTING_PLUGIN":
            if sum(len(rules) for rules in data.values()) > 250:
                raise ValidationError("Máximo de 250 reglas de formato condicional por archivo.")
            for sheet_id, rules in data.items():
                if sheet_id not in sheets:
                    raise ValidationError("El formato condicional requiere una hoja existente.")
                for item in rules:
                    for area in item["ranges"]:
                        if not 0 <= area["startRow"] <= area["endRow"] < 20000 or not 0 <= area["startColumn"] <= area["endColumn"] < 500:
                            raise ValidationError("Rango de formato condicional inválido.")
                    rule = item["rule"]
                    if rule.get("subType") == "formula":
                        formulas.append(rule["value"])
                    configuration = rule.get("config", [])
                    thresholds = configuration if isinstance(configuration, list) else [configuration.get("min", {}), configuration.get("max", {})]
                    for threshold in thresholds:
                        value = threshold if threshold.get("type") == "formula" else threshold.get("value", threshold)
                        if isinstance(value, dict) and value.get("type") == "formula":
                            formulas.append(value.get("value"))
        elif resource["name"] == "SHEET_FILTER_PLUGIN":
            for sheet_id, rule in data.items():
                area = rule["ref"]
                if sheet_id not in sheets or not 0 <= area["startRow"] <= area["endRow"] < 20000 or not 0 <= area["startColumn"] <= area["endColumn"] < 500:
                    raise ValidationError("Rango de filtro inválido.")
                criteria = rule.get("filterColumns", [])
                if len(criteria) > 500 or any(not area["startColumn"] <= item["colId"] <= area["endColumn"] for item in criteria):
                    raise ValidationError("Columnas de filtro inválidas.")
                cached = rule.get("cachedFilteredOut", [])
                if len(cached) > 20000 or any(not area["startRow"] <= row <= area["endRow"] for row in cached):
                    raise ValidationError("Filas de filtro inválidas.")
        elif resource["name"] == "SHEET_DATA_VALIDATION_PLUGIN":
            validation_cells = 0
            for sheet_id, rules in data.items():
                if sheet_id not in sheets or not isinstance(rules, list):
                    raise ValidationError("Las validaciones requieren una hoja existente.")
                for rule in rules:
                    for area in rule["ranges"]:
                        if not 0 <= area["startRow"] <= area["endRow"] < 20000 or not 0 <= area["startColumn"] <= area["endColumn"] < 500:
                            raise ValidationError("Rango de validación inválido.")
                        validation_cells += (area["endRow"] - area["startRow"] + 1) * (area["endColumn"] - area["startColumn"] + 1)
                        if validation_cells > 100000:
                            raise ValidationError("Máximo de 100 000 celdas con validación por archivo.")
                    for key in ("formula1", "formula2"):
                        value = rule.get(key)
                        if isinstance(value, str) and (value.startswith("=") or rule.get("type") == "custom"):
                            formulas.append(value)
        else:
            formulas.extend(item.get("formulaOrRefString") for item in data.values())
        if any(not isinstance(formula, str) or len(formula) > 4000 or re.search(r"\[[^]]+\]|\b(WEBSERVICE|IMPORTXML|IMPORTDATA|IMPORTRANGE|HYPERLINK)\s*\(|\|", formula, re.I) for formula in formulas):
            raise ValidationError("Las fórmulas de los recursos no permiten conexiones externas.")
    for key in order:
        sheet = sheets[key]
        if sheet.get("id") != key or not isinstance(sheet.get("name"), str) or not 1 <= len(sheet["name"]) <= 31 or re.search(r"[\\/*?:\[\]]", sheet["name"]) or sheet["name"].casefold() in names or sheet["name"].upper().startswith("__BOLD"):
            raise ValidationError("Los nombres de hoja deben ser válidos y diferentes.")
        names.add(sheet["name"].casefold())
        if not isinstance(sheet.get("rowCount"), int) or not 1 <= sheet["rowCount"] <= 20000 or not isinstance(sheet.get("columnCount"), int) or not 1 <= sheet["columnCount"] <= 500:
            raise ValidationError("Máximo de 20 000 filas y 500 columnas por hoja.")
        if not isinstance(sheet.get("cellData"), dict):
            raise ValidationError("Datos de cuadrícula inválidos.")
        for row, cells in sheet["cellData"].items():
            if not str(row).isdigit() or int(row) >= 20000 or not isinstance(cells, dict):
                raise ValidationError("Máximo de 20 000 filas por hoja.")
            for col, cell in cells.items():
                count += 1
                if not str(col).isdigit() or int(col) >= 500 or count > 100000 or not isinstance(cell, dict) or not set(cell).issubset(CELL_KEYS):
                    raise ValidationError("Celda inválida; máximo de 500 columnas y 100 000 celdas.")
                if cell.get("f") and (not isinstance(cell["f"], str) or len(cell["f"]) > 4000 or re.search(r"\[[^]]+\]|\b(WEBSERVICE|IMPORTXML|IMPORTDATA|IMPORTRANGE|HYPERLINK)\s*\(|\|", cell["f"], re.I)):
                    raise ValidationError("Las fórmulas con conexiones externas no están permitidas.")
                if "v" in cell and not isinstance(cell["v"], (str, int, float, bool, type(None))):
                    raise ValidationError("Valor de celda inválido.")
                for link in (cell.get("p") or {}).get("body", {}).get("customRanges", []):
                    url = link.get("properties", {}).get("url")
                    if url and (not isinstance(url, str) or not re.match(r"^(https?://|#)", url, re.I)):
                        raise ValidationError("Los enlaces requieren HTTP, HTTPS o una referencia interna.")
                if isinstance(cell.get("v"), (int, float)) and not math.isfinite(cell["v"]):
                    raise ValidationError("Los números deben ser finitos.")
        for block in sheet.get("__bold", {}).get("blocks", []):
            try:
                uuid.UUID(block["id"])
                for row_id in block["rowIds"]:
                    uuid.UUID(row_id)
            except (KeyError, ValueError, TypeError) as exc:
                raise ValidationError("Identificadores del bloque inválidos.") from exc
            if block["id"] in block_ids or len(set(block["rowIds"])) != len(block["rowIds"]) or row_ids.intersection(block["rowIds"]) or block.get("type") not in BLOCK_TYPES:
                raise ValidationError("Los bloques y las filas necesitan identificadores permanentes únicos.")
            block_ids.add(block["id"])
            row_ids.update(block["rowIds"])
            if not isinstance(block.get("startRow"), int) or not 0 <= block["startRow"] < 20000 or not 1 <= len(block.get("columns", [])) <= 100:
                raise ValidationError("Rango de bloque inválido.")
            cols = block["columns"]
            if len({col["name"].strip().casefold() for col in cols}) != len(cols):
                raise ValidationError("Los encabezados del bloque deben ser diferentes.")
            if not isinstance(block.get("task"), dict) or not isinstance(block["task"].get("enabled"), bool) or not isinstance(block["task"].get("status_map", {}), dict):
                raise ValidationError("Conexión de tareas inválida.")
            if len({col["id"] for col in cols}) != len(cols) or any(col.get("type") not in TYPES or not re.fullmatch(r"[a-zA-Z0-9_-]{1,80}", col.get("id", "")) for col in cols):
                raise ValidationError("Columnas inválidas.")
            for col in cols:
                if not isinstance(col.get("name"), str) or not 1 <= len(col["name"].strip()) <= 160:
                    raise ValidationError("Nombre de columna inválido.")
                options = col.get("options", [])
                if len(options) > 100 or len({item["value"] for item in options}) != len(options) or any(not re.fullmatch(r"#[0-9a-fA-F]{6}", item.get("color", "#8a96a8")) for item in options):
                    raise ValidationError("Opciones o colores del desplegable inválidos.")
            for index, col in enumerate(cols, 1):
                if cell_at(sheet, block["startRow"], index).get("custom", {}).get("boldColumn") != col["id"] or cell_at(sheet, block["startRow"], index).get("v") != col["name"]:
                    raise ValidationError("Las columnas requieren identificadores permanentes. Usa Configurar para añadir o quitar campos.")
            if block["type"] in {"costs", "comparison"} and (not re.fullmatch(r"[A-Z]{3}", block.get("currency", "")) or not {"product", "price", "quantity", "total"}.issubset({col["id"] for col in cols}) or not all(isinstance(block.get(key, 0), (int, float)) and 0 <= block.get(key, 0) <= 100 for key in ("tax", "discount"))):
                raise ValidationError("Selecciona una moneda y porcentajes entre 0 y 100.")
            if block["type"] == "comparison" and not {"previous", "difference"}.issubset({col["id"] for col in cols}):
                raise ValidationError("La comparación necesita columnas Anterior y Diferencia.")
            if block["type"] in {"costs", "comparison"}:
                required = {"product": "text", "price": "currency", "quantity": "number", "total": "formula", "previous": "currency", "difference": "formula"}
                if any(col["id"] in required and col["type"] != required[col["id"]] for col in cols):
                    raise ValidationError("Conserva los tipos de las columnas de cálculo para mantener precios, cantidades y totales válidos.")
            conversion = block.get("conversion", {})
            if conversion and (not re.fullmatch(r"[A-Z]{3}", conversion.get("currency", "")) or not isinstance(conversion.get("rate"), (int, float)) or not 0 < conversion["rate"] < 1000000):
                raise ValidationError("Selecciona la moneda destino y un tipo de cambio positivo.")
            if block["type"] in {"costs", "comparison"}:
                total_index = 1 + next(i for i, col in enumerate(cols) if col["id"] == "total")
                if cell_at(sheet, block["startRow"] + len(block["rowIds"]) + 1, 0).get("v") != "subtotal:" + block["id"]:
                    raise ValidationError("El subtotal necesita su identificador técnico.")
                if cell_at(sheet, block["startRow"] + len(block["rowIds"]) + 1, total_index).get("f") != subtotal_formula(block):
                    raise ValidationError("El subtotal es automático. Cambia descuento, impuesto y conversión en Configurar; usa Resumen para otra fórmula.")
            if cell_at(sheet, block["startRow"], 0).get("v") != "block:" + block["id"]:
                raise ValidationError("No puedes borrar el encabezado técnico. Elimina el bloque desde su menú.")
            for index, row_id in enumerate(block["rowIds"], block["startRow"] + 1):
                if cell_at(sheet, index, 0).get("v") != row_id:
                    raise ValidationError("Ordena el rango completo, incluyendo la columna técnica oculta, para conservar las tareas.")
                for col_index, col in enumerate(cols, 1):
                    if block.get("task", {}).get("enabled") and col["id"] in {"title", "responsible", "collaborators", "priority", "due_date", "status", "description", "note"} and cell_at(sheet, index, col_index).get("f"):
                        raise ValidationError("Las propiedades conectadas a tareas requieren valores directos; coloca cálculos en una columna de fórmula.")
                    value = cell_at(sheet, index, col_index).get("v")
                    if value in (None, "") or cell_at(sheet, index, col_index).get("f"):
                        continue
                    kind = col["type"]
                    if kind in {"number", "currency"} and (isinstance(value, bool) or not isinstance(value, (int, float))):
                        raise ValidationError("La columna «" + col["name"] + "» requiere un número.")
                    if kind == "date" and (not isinstance(value, str) or not parse_date(value)):
                        raise ValidationError("La columna «" + col["name"] + "» requiere una fecha válida.")
                    if kind == "checkbox" and not isinstance(value, bool):
                        raise ValidationError("Una casilla solo admite verdadero o falso.")
                    if kind == "dropdown" and value not in {item["value"] for item in col.get("options", [])}:
                        raise ValidationError("Selecciona una opción válida para «" + col["name"] + "».")
                    if kind in {"responsible", "collaborators"}:
                        if not isinstance(value, str):
                            raise ValidationError("Selecciona personas desde el directorio.")
                        for person_id in value.split(","):
                            uuid.UUID(person_id)
    validate_money_formulas(document)
    return document


def validate_money_formulas(document):
    references = re.compile(r"(?:(?:'([^']+)'|([A-Za-z_][\w]*))!)?\$?([A-Z]{1,3})\$?(\d+)?(?::\$?([A-Z]{1,3})\$?(\d+)?)?")
    number = lambda value: sum((ord(letter) - 64) * 26 ** index for index, letter in enumerate(reversed(value))) - 1
    named = {sheet["name"].casefold(): sheet["id"] for sheet in document["sheets"].values()}
    declared, formulas, indexed, conversions = {}, {}, {}, {}
    for sheet, block in blocks(document):
        if block["type"] not in {"costs", "comparison"}:
            continue
        indices = [index + 1 for index, column in enumerate(block["columns"]) if column["id"] in {"price", "total", "previous", "difference"}]
        for row in range(block["startRow"] + 1, block["startRow"] + len(block["rowIds"]) + 1):
            for col in indices:
                declared[(sheet["id"], row, col)] = {block["currency"]}
        total = 1 + next(index for index, column in enumerate(block["columns"]) if column["id"] == "total")
        address = (sheet["id"], block["startRow"] + len(block["rowIds"]) + 1, total)
        declared[address] = {block.get("conversion", {}).get("currency") or block["currency"]}
        if block.get("conversion"):
            conversions[address] = block["currency"]
    for sheet in document["sheets"].values():
        for row, cells in sheet["cellData"].items():
            for col, cell in cells.items():
                if cell.get("f"):
                    formulas[(sheet["id"], int(row), int(col))] = cell["f"]
    for sheet, row, col in set(declared) | set(formulas):
        indexed.setdefault((sheet, col), []).append(row)
    indexed = {key: sorted(rows) for key, rows in indexed.items()}
    cache = {}
    resource = next((item for item in document.get("resources", []) if item.get("name") == "SHEET_DEFINED_NAME_PLUGIN"), {})
    defined = list(json.loads(resource.get("data") or "{}").values())

    def expand_names(formula, sheet, visiting=frozenset()):
        for item in sorted(defined, key=lambda item: item.get("localSheetId") != sheet):
            name, ref = item.get("name"), item.get("formulaOrRefString")
            if not name or not ref or item.get("localSheetId") not in {None, "AllDefaultWorkbook", sheet} or name in visiting:
                continue
            pattern = r"(?<![\w'])" + re.escape(name) + r"(?![\w']|\s*[(!])"
            if re.search(pattern, formula, re.I):
                if len(visiting) >= 20:
                    raise ValidationError("Los rangos con nombre exceden 20 dependencias.")
                formula = re.sub(pattern, lambda _: "(" + expand_names(ref, sheet, visiting | {name}).lstrip("=") + ")", formula, flags=re.I)
        return formula

    def dependencies(address):
        result = []
        expression = expand_names(re.sub(r'"[^"]*"', '', formulas[address]), address[0]).upper()
        for match in references.finditer(expression):
            if not match[4] and not match[5]:
                continue
            source = named.get((match[1] or match[2]).casefold()) if match[1] or match[2] else address[0]
            for col in range(number(match[3]), min(499, number(match[5] or match[3])) + 1):
                rows = indexed.get((source, col), [])
                start, end = int(match[4] or 1) - 1, int(match[6] or match[4] or 20000) - 1
                result.extend((source, row, col) for row in rows[bisect_left(rows, start):bisect_right(rows, end)])
        return result

    def currency_at(address, visiting):
        if address in declared:
            return declared[address]
        if address in cache:
            return cache[address]
        if address in visiting:
            return set()
        if len(visiting) > 200:
            raise ValidationError("La cadena de fórmulas excede 200 dependencias.")
        visiting = visiting | {address}
        result = set().union(*(currency_at(other, visiting) for other in dependencies(address))) if address in formulas else set()
        cache[address] = result
        return result

    multiple = len(set().union(*declared.values())) > 1 if declared else False
    for address, formula in formulas.items():
        expanded = expand_names(formula, address[0])
        if multiple and re.search(r"\b(INDIRECT|OFFSET)\s*\(|(?<!\w)\d+:\d+(?!\w)", expanded, re.I):
            raise ValidationError("Usa referencias directas para comprobar las monedas; INDIRECT y OFFSET no permiten validar conversiones.")
        currencies = set().union(*(currency_at(other, {address}) for other in dependencies(address)))
        if len(currencies) > 1:
            raise ValidationError("No sumes monedas diferentes. Configura una conversión explícita y usa los subtotales convertidos.")
        expected = {conversions[address]} if address in conversions else declared.get(address)
        if currencies and expected and currencies != expected:
            raise ValidationError("La fórmula devuelve una moneda diferente a la del bloque. Configura una conversión explícita.")


def validate_document(document):
    try:
        return _validate_document(document)
    except (KeyError, TypeError, AttributeError, ValueError, OverflowError) as exc:
        raise ValidationError("La estructura del archivo contiene datos inválidos.") from exc


def reconcile_markers(document):
    for sheet, block in blocks(document):
        headers = [int(row) for row, cells in sheet["cellData"].items() if cells.get("0", {}).get("v") == "block:" + block["id"]]
        if len(headers) != 1:
            raise ValidationError("Identificador de bloque perdido. Conserva el borrador y elimina bloques desde su menú.")
        block["startRow"] = headers[0]
        columns = {column["id"]: column for column in block["columns"]}
        header = sheet["cellData"][str(headers[0])]
        ids = [header.get(str(index), {}).get("custom", {}).get("boldColumn") for index in range(1, len(columns) + 1)]
        if len(set(ids)) != len(columns) or set(ids) != set(columns):
            raise ValidationError("Columnas del bloque incompletas. Añade o quita campos desde Configurar.")
        block["columns"] = [columns[key] for key in ids]
        for index, column in enumerate(block["columns"], 1):
            column["name"] = header[str(index)].get("v", "")
        known = set(block["rowIds"])
        found = [(int(row), cells.get("0", {}).get("v")) for row, cells in sheet["cellData"].items() if cells.get("0", {}).get("v") in known]
        found.sort()
        if len(found) != len(known) or [row for row, _ in found] != list(range(headers[0] + 1, headers[0] + 1 + len(known))):
            raise ValidationError("Las filas del bloque deben mantenerse juntas. Usa sus controles para añadir o eliminar filas.")
        block["rowIds"] = [row_id for _, row_id in found]
    return document
