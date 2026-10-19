from copy import deepcopy
import json

from .operations import Conflict

MISSING = object()


def resource_map(resources, document=None):
    result = {}
    for resource in resources if isinstance(resources, list) else []:
        try:
            data = json.loads(resource["data"])
        except (ValueError, KeyError, TypeError):
            data = resource.get("data", "")
        if resource.get("name") == "SHEET_RANGE_THEME_MODEL_PLUGIN" and isinstance(data, dict):
            # Tables restore these derived rules themselves, with new runtime IDs.
            data["rangeThemeStyleRuleMap"] = {key: value for key, value in data.get("rangeThemeStyleRuleMap", {}).items() if not value.get("themeName", "").startswith("table-")}
        if resource.get("name") == "SHEET_DATA_VALIDATION_PLUGIN" and isinstance(data, dict):
            types = {"responsible": "list", "collaborators": "listMultiple", "dropdown": "list", "checkbox": "checkbox"}
            for sheet_id, rules in data.items():
                blocks = (document or {}).get("sheets", {}).get(sheet_id, {}).get("__bold", {}).get("blocks", [])
                def managed(rule):
                    if str(rule.get("uid", "")).startswith("bold-validation-"):
                        return True
                    # The column configuration owns these lists, including old random runtime IDs.
                    return bool(rule.get("ranges")) and all(any(
                        types.get(column.get("type")) == rule.get("type")
                        and area.get("startColumn") == area.get("endColumn") == index + 1
                        and block["startRow"] < area.get("startRow", -1) <= area.get("endRow", -1) <= block["startRow"] + len(block["rowIds"])
                        for block in blocks for index, column in enumerate(block["columns"])) for area in rule["ranges"])
                data[sheet_id] = [rule for rule in rules if not managed(rule)]
        def populated(value):
            if isinstance(value, dict):
                return any(populated(item) for item in value.values())
            if isinstance(value, list):
                return any(populated(item) for item in value)
            return value is not None and value != ""
        if populated(data):
            result[resource["name"]] = data
    return result


def saved_document(document):
    if not isinstance(document, dict):
        return document
    document = deepcopy(document)
    for sheet in document.get("sheets", {}).values():
        for cells in sheet.get("cellData", {}).values():
            for cell in cells.values():
                if cell.get("v") is None or cell.get("v") == "":
                    cell.pop("v", None)
        # ah is the renderer's calculated height; h and ia are user configuration.
        rows = {key: {field: value for field, value in row.items() if field != "ah"} for key, row in sheet.get("rowData", {}).items()}
        sheet["rowData"] = {key: row for key, row in rows.items() if row}
    if "resources" in document:
        document["resources"] = [{"name": name, "data": json.dumps(data, ensure_ascii=False, separators=(",", ":")) if not isinstance(data, str) else data} for name, data in sorted(resource_map(document["resources"], document).items())]
    return document


def merge_resources(base, local, remote, path, chart_preference=None, prefer_local=False, conflicts=None):
    maps = [resource_map(value) for value in (base, local, remote)]
    name = "__casual_sheets_charts__"
    original, current, incoming = [value.get(name, MISSING) for value in maps]
    if chart_preference in {"local", "remote"} and current != original and incoming != original and current != incoming:
        if conflicts is not None:
            conflicts.append(path + "/" + name)
        selected = current if chart_preference == "local" else incoming
        for value in maps:
            if selected is MISSING:
                value.pop(name, None)
            else:
                value[name] = deepcopy(selected)
    merged = merge_documents(*maps, path, prefer_local=prefer_local, cell_conflicts=conflicts)
    return [{"name": name, "data": json.dumps(data, ensure_ascii=False, separators=(",", ":")) if not isinstance(data, str) else data} for name, data in sorted(merged.items())]


def merge_identified_lists(base, local, remote, path, prefer_local=False, conflicts=None):
    for field in ("id", "uid", "cfId"):
        if all(all(isinstance(item, dict) and field in item for item in value) for value in (base, local, remote)) and any((base, local, remote)):
            maps = [{item[field]: item for item in value} for value in (base, local, remote)]
            if any(len(mapping) != len(value) for mapping, value in zip(maps, (base, local, remote))):
                break
            merged = merge_documents(*maps, path=path, prefer_local=prefer_local, cell_conflicts=conflicts)
            common = set(maps[0]) & set(maps[1]) & set(maps[2])
            orders = [[item[field] for item in value if item[field] in common] for value in (base, local, remote)]
            merge_documents(*orders, path=path + "/orden", prefer_local=prefer_local, cell_conflicts=conflicts)
            first = remote if orders[1] == orders[0] else local
            order = list(dict.fromkeys(item[field] for value in (first, local, remote) for item in value))
            return [merged[key] for key in order if key in merged]
    raise Conflict("Hay cambios simultáneos en " + path + ". Conservamos ambas versiones; revisa el conflicto antes de continuar.")


def merge_documents(base, local, remote, path="Archivo", cell_conflicts=None, _technical_sheets=None, chart_preference=None, prefer_local=False):
    """Merge independent edits; Drive can retain local cells and record recoverable conflicts."""
    if path == "Archivo":
        base, local, remote = map(saved_document, (base, local, remote))
        _technical_sheets = {key for key, sheet in local.get("sheets", {}).items() if sheet.get("__bold", {}).get("technicalColumn") is not False} if isinstance(local, dict) else set()
    if local == remote or remote == base:
        return deepcopy(local) if local is not MISSING else MISSING
    if local == base:
        return deepcopy(remote) if remote is not MISSING else MISSING
    if base is MISSING and isinstance(local, dict) and isinstance(remote, dict):
        base = {}
    if base is MISSING and isinstance(local, list) and isinstance(remote, list):
        base = []
    parts = path.split("/")
    if len(parts) == 4 and parts[1] == "sheets" and parts[3] in {"zoomRatio", "scrollTop", "scrollLeft"} and chart_preference == "remote":
        return deepcopy(remote)
    if cell_conflicts is not None and len(parts) == 6 and parts[1] == "sheets" and parts[3] == "cellData" and (parts[5] != "0" or parts[2] not in _technical_sheets) and all(isinstance(value, dict) for value in (base, local, remote)):
        # Keep formula/text content together; cached formula results are not edits.
        content = lambda cell: {key: value for key, value in cell.items() if key in {"v", "f", "p", "si"} and (key != "v" or not cell.get("f"))}
        original, current, incoming = map(content, (base, local, remote))
        if current == incoming or current == original or incoming == original:
            try:
                return merge_documents(base, local, remote, path, prefer_local=prefer_local)
            except Conflict:
                pass
        cell_conflicts.append(path)
        return deepcopy(local)
    if all(isinstance(value, list) for value in (base, local, remote)):
        try:
            return merge_identified_lists(base, local, remote, path, prefer_local, cell_conflicts)
        except Conflict:
            if not prefer_local:
                raise
    if all(isinstance(value, dict) for value in (base, local, remote)):
        result = {}
        for key in base.keys() | local.keys() | remote.keys():
            if key == "resources" and path == "Archivo":
                result[key] = merge_resources(base.get(key, []), local.get(key, []), remote.get(key, []), path + "/resources", chart_preference, prefer_local, cell_conflicts)
                continue
            if key == "v" and local.get("f") and local.get("f") == remote.get("f"):
                result[key] = remote.get(key)
                continue
            value = merge_documents(base.get(key, MISSING), local.get(key, MISSING), remote.get(key, MISSING), path + "/" + str(key), cell_conflicts, _technical_sheets, chart_preference=chart_preference, prefer_local=prefer_local)
            if value is not MISSING:
                result[key] = value
        return result
    if prefer_local:
        if cell_conflicts is not None:
            cell_conflicts.append(path)
        return deepcopy(local) if local is not MISSING else MISSING
    raise Conflict("Hay cambios simultáneos en " + path + ". Conservamos ambas versiones; revisa el conflicto antes de continuar.")
