from copy import deepcopy
import json
from django.test import SimpleTestCase
from boldApp.hojas.drive_merge import merge_documents
from boldApp.hojas.operations import Conflict


class DriveMergeTests(SimpleTestCase):
    def resource(self, name, data):
        return {"name": name, "data": json.dumps(data)}

    def test_combines_independent_cells_without_overwriting_local_changes(self):
        base = {"cells": {"A1": {"v": "Original"}, "B1": {"v": 1}}}
        local, remote = deepcopy(base), deepcopy(base)
        local["cells"]["A1"]["v"] = "BOLD"
        remote["cells"]["B1"]["v"] = 2
        self.assertEqual(merge_documents(base, local, remote), {"cells": {"A1": {"v": "BOLD"}, "B1": {"v": 2}}})

    def test_same_cell_conflict_preserves_both_inputs(self):
        base, local, remote = {"v": 1}, {"v": 2}, {"v": 3}
        with self.assertRaises(Conflict):
            merge_documents(base, local, remote)
        self.assertEqual(local, {"v": 2})
        self.assertEqual(remote, {"v": 3})

    def test_blank_representations_do_not_erase_local_values_or_assignments(self):
        base = {"sheets": {"sheet": {"cellData": {"1": {"1": {}, "2": {"v": None}, "3": {"v": ""}, "4": {"v": 0}, "5": {"v": False}}}}}}
        local, remote = deepcopy(base), deepcopy(base)
        local["sheets"]["sheet"]["cellData"]["1"]["1"]["v"] = "person-id"
        remote["sheets"]["sheet"]["cellData"]["1"]["1"]["v"] = ""
        remote["sheets"]["sheet"]["cellData"]["1"]["2"] = {}
        remote["sheets"]["sheet"]["cellData"]["1"]["3"]["v"] = None
        cells = merge_documents(base, local, remote)["sheets"]["sheet"]["cellData"]["1"]
        self.assertEqual(cells, {"1": {"v": "person-id"}, "2": {}, "3": {}, "4": {"v": 0}, "5": {"v": False}})
        self.assertIn("v", base["sheets"]["sheet"]["cellData"]["1"]["2"])

    def test_drive_retains_local_cell_and_merges_independent_remote_changes(self):
        base = {"sheets": {"sheet": {"cellData": {"1": {"1": {"v": "medium"}, "2": {"v": "Title"}}}}}}
        local, remote = deepcopy(base), deepcopy(base)
        local["sheets"]["sheet"]["cellData"]["1"]["1"]["v"] = "low"
        remote["sheets"]["sheet"]["cellData"]["1"]["1"]["v"] = ""
        remote["sheets"]["sheet"]["cellData"]["1"]["2"]["v"] = "Drive"
        conflicts = []
        cells = merge_documents(base, local, remote, cell_conflicts=conflicts)["sheets"]["sheet"]["cellData"]["1"]
        self.assertEqual(cells, {"1": {"v": "low"}, "2": {"v": "Drive"}})
        self.assertEqual(conflicts, ["Archivo/sheets/sheet/cellData/1/1"])
        self.assertEqual(remote["sheets"]["sheet"]["cellData"]["1"]["1"]["v"], "")
        with self.assertRaises(Conflict):
            merge_documents(base, local, remote)

    def test_drive_keeps_formula_and_value_together_but_merges_independent_format(self):
        base = {"sheets": {"sheet": {"cellData": {"1": {"1": {"v": 1}, "2": {"v": "Title"}}}}}}
        local, remote = deepcopy(base), deepcopy(base)
        local["sheets"]["sheet"]["cellData"]["1"]["1"] = {"f": "=1+1", "v": 2}
        local["sheets"]["sheet"]["cellData"]["1"]["2"]["v"] = "BOLD"
        remote["sheets"]["sheet"]["cellData"]["1"]["1"]["v"] = 3
        remote["sheets"]["sheet"]["cellData"]["1"]["2"]["s"] = {"bl": 1}
        cells = merge_documents(base, local, remote, cell_conflicts=[])["sheets"]["sheet"]["cellData"]["1"]
        self.assertEqual(cells["1"], {"f": "=1+1", "v": 2})
        self.assertEqual(cells["2"], {"v": "BOLD", "s": {"bl": 1}})

    def test_drive_does_not_choose_between_different_technical_identifiers(self):
        base = {"sheets": {"sheet": {"cellData": {"1": {"0": {"v": "row-id"}}}}}}
        local, remote = deepcopy(base), deepcopy(base)
        local["sheets"]["sheet"]["cellData"]["1"]["0"]["v"] = "local-id"
        remote["sheets"]["sheet"]["cellData"]["1"]["0"]["v"] = "remote-id"
        with self.assertRaises(Conflict):
            merge_documents(base, local, remote, cell_conflicts=[])

    def test_drive_can_retain_column_a_when_it_is_not_a_technical_column(self):
        base = {"sheets": {"sheet": {"__bold": {"technicalColumn": False}, "cellData": {"1": {"0": {"v": "Original"}}}}}}
        local, remote = deepcopy(base), deepcopy(base)
        local["sheets"]["sheet"]["cellData"]["1"]["0"]["v"] = "BOLD"
        remote["sheets"]["sheet"]["cellData"]["1"]["0"]["v"] = "Drive"
        conflicts = []
        cell = merge_documents(base, local, remote, cell_conflicts=conflicts)["sheets"]["sheet"]["cellData"]["1"]["0"]
        self.assertEqual(cell["v"], "BOLD")
        self.assertEqual(conflicts, ["Archivo/sheets/sheet/cellData/1/0"])

    def test_deleting_a_cell_keeps_an_independent_change(self):
        self.assertEqual(merge_documents({"A1": 1, "B1": 2}, {"A1": 1, "B1": 3}, {"B1": 2}), {"B1": 3})

    def test_resource_order_format_and_idle_plugins_do_not_conflict(self):
        base = {"resources": [self.resource("NOTES", {"sheet": {"A1": "original"}})]}
        local = {"resources": [self.resource("IDLE", {}), self.resource("NOTES", {"sheet": {"A1": "BOLD"}})]}
        remote = {"resources": [self.resource("FILTER", {"sheet": {"range": "A1:C3"}}), {"name": "NOTES", "data": '{ "sheet": { "A1": "original" } }'}]}
        merged = {item["name"]: json.loads(item["data"]) for item in merge_documents(base, local, remote)["resources"]}
        self.assertEqual(merged, {"NOTES": {"sheet": {"A1": "BOLD"}}, "FILTER": {"sheet": {"range": "A1:C3"}}})

    def test_independent_rules_of_the_same_plugin_merge(self):
        rules = [{"uid": "one", "formula1": "1"}, {"uid": "two", "formula1": "2"}]
        base = {"resources": [self.resource("VALIDATION", {"sheet": rules})]}
        local, remote = deepcopy(base), deepcopy(base)
        local["resources"][0] = self.resource("VALIDATION", {"sheet": [{**rules[0], "formula1": "10"}, rules[1]]})
        remote["resources"][0] = self.resource("VALIDATION", {"sheet": [rules[0], {**rules[1], "formula1": "20"}]})
        merged = json.loads(merge_documents(base, local, remote)["resources"][0]["data"])
        self.assertEqual([item["formula1"] for item in merged["sheet"]], ["10", "20"])

    def test_same_resource_field_keeps_a_real_conflict(self):
        base = {"resources": [self.resource("NOTES", {"A1": "original"})]}
        local = {"resources": [self.resource("NOTES", {"A1": "BOLD"})]}
        remote = {"resources": [self.resource("NOTES", {"A1": "Drive"})]}
        with self.assertRaises(Conflict):
            merge_documents(base, local, remote)

    def test_new_rules_can_be_added_independently_to_a_new_resource(self):
        local = {"resources": [self.resource("VALIDATION", {"sheet": [{"uid": "one", "value": 1}]})]}
        remote = {"resources": [self.resource("VALIDATION", {"sheet": [{"uid": "two", "value": 2}]})]}
        rules = json.loads(merge_documents({}, local, remote)["resources"][0]["data"])["sheet"]
        self.assertEqual({item["uid"] for item in rules}, {"one", "two"})

    def test_derived_table_theme_rules_do_not_conflict_after_remount(self):
        style = {"name": "table-excel-1", "headerRowStyle": {"bg": {"rgb": "#535fc1"}}}
        def themes(id):
            return self.resource("SHEET_RANGE_THEME_MODEL_PLUGIN", {"rangeThemeStyleMapJson": {style["name"]: style}, "rangeThemeStyleRuleMap": {id: {"themeName": style["name"], "rangeInfo": {"subUnitId": "sheet"}}}})
        merged = merge_documents({"resources": [themes("base")]}, {"resources": [themes("local")]}, {"resources": [themes("remote")]})
        self.assertEqual(json.loads(merged["resources"][0]["data"])["rangeThemeStyleMapJson"][style["name"]], style)

    def test_generated_person_rules_do_not_conflict_with_drive_import(self):
        native = {"uid": "native", "type": "list", "formula1": '["A","B"]', "ranges": [{"startRow": 3, "endRow": 4, "startColumn": 5, "endColumn": 5}]}
        generated = {"uid": "random", "type": "list", "formula1": '["Samuel <samuel@bold.gt>"]', "ranges": [{"startRow": 1, "endRow": 1, "startColumn": 1, "endColumn": 1}]}
        base = {"sheets": {"sheet": {"__bold": {"blocks": [{"startRow": 0, "rowIds": ["row"], "columns": [{"type": "responsible"}]}]}}}, "resources": [self.resource("SHEET_DATA_VALIDATION_PLUGIN", {"sheet": [native, generated]})]}
        local, remote = deepcopy(base), deepcopy(base)
        local["resources"][0] = self.resource("SHEET_DATA_VALIDATION_PLUGIN", {"sheet": [native, {**generated, "uid": "new-random", "formula1": '["Samuel"]'}]})
        remote["resources"][0] = self.resource("SHEET_DATA_VALIDATION_PLUGIN", {"sheet": [native]})
        merged = merge_documents(base, local, remote)
        self.assertEqual(json.loads(merged["resources"][0]["data"])["sheet"], [native])
        local["resources"][0] = self.resource("SHEET_DATA_VALIDATION_PLUGIN", {"sheet": [{**native, "formula1": '["Local"]'}]})
        remote["resources"][0] = self.resource("SHEET_DATA_VALIDATION_PLUGIN", {"sheet": [{**native, "formula1": '["Drive"]'}]})
        with self.assertRaises(Conflict):
            merge_documents(base, local, remote)

    def test_auto_heights_merge_but_concurrent_manual_heights_still_conflict(self):
        base = {"sheets": {"sheet": {"rowData": {"1": {"h": 28, "ia": 1, "ah": 45}}, "cellData": {"1": {"1": {"v": 1}, "2": {"v": 2}}}}}}
        local, remote = deepcopy(base), deepcopy(base)
        local["sheets"]["sheet"]["rowData"]["1"]["ah"] = 60
        remote["sheets"]["sheet"]["rowData"]["1"]["ah"] = 75
        local["sheets"]["sheet"]["cellData"]["1"]["1"]["v"] = 10
        remote["sheets"]["sheet"]["cellData"]["1"]["2"]["v"] = 20
        sheet = merge_documents(base, local, remote)["sheets"]["sheet"]
        self.assertEqual(sheet["rowData"], {"1": {"h": 28, "ia": 1}})
        self.assertEqual(sheet["cellData"]["1"], {"1": {"v": 10}, "2": {"v": 20}})
        local["sheets"]["sheet"]["rowData"]["1"]["h"] = 50
        remote["sheets"]["sheet"]["rowData"]["1"]["h"] = 65
        with self.assertRaises(Conflict):
            merge_documents(base, local, remote)
