from django.test import SimpleTestCase
from rest_framework.exceptions import ValidationError

from boldApp.hojas.document import add_block, blank, blank_sheet, cell_at, decorate, unique_sheet_name


class SheetNameTests(SimpleTestCase):
    def test_repeated_names_get_incrementing_suffixes(self):
        document = blank("Archivo")
        for expected in ("Nueva hoja", "Nueva hoja 2", "Nueva hoja 3"):
            name = unique_sheet_name(document, "Nueva hoja")
            self.assertEqual(name, expected)
            sheet = blank_sheet(name)
            document["sheets"][sheet["id"]] = sheet
            document["sheetOrder"].append(sheet["id"])
        self.assertEqual(unique_sheet_name(document, "nueva HOJA"), "nueva HOJA 4")
        self.assertEqual(unique_sheet_name(document, "Nueva hoja 3", exclude=sheet["id"]), "Nueva hoja 3")

    def test_numbered_names_fit_excel_limits_and_invalid_names_still_fail(self):
        document = blank("Archivo")
        sheet = next(iter(document["sheets"].values()))
        sheet["name"] = "A" * 31
        self.assertEqual(unique_sheet_name(document, "A" * 31), "A" * 29 + " 2")
        for invalid in ("", "A" * 32, "Hoja/IT", "__BOLD_METADATA", None):
            with self.subTest(name=invalid), self.assertRaises(ValidationError):
                unique_sheet_name(document, invalid)


class BlockAppearanceTests(SimpleTestCase):
    def test_block_defaults_show_wrapped_text_stripes_and_useful_widths(self):
        sheet = blank_sheet()
        block = add_block(sheet, "tasks")
        start = block["startRow"]
        self.assertEqual(cell_at(sheet, start, 2)["s"]["tb"], 3)
        self.assertEqual(sheet["columnData"]["2"]["w"], 320)
        self.assertNotEqual(cell_at(sheet, start + 1, 2)["s"]["bg"], cell_at(sheet, start + 2, 2)["s"]["bg"])
        self.assertEqual(sheet["rowData"][str(start + 1)]["ia"], 1)

    def test_configuring_keeps_manual_sizes_styles_data_and_formulas(self):
        sheet = blank_sheet()
        block = add_block(sheet, "costs")
        row = block["startRow"] + 1
        sheet["columnData"]["1"]["w"] = 240
        sheet["rowData"][str(row)] = {"h": 70, "ia": 0}
        sheet["cellData"][str(row)]["1"].update({"v": "Producto", "s": {"bg": {"rgb": "#112233"}}})
        formula = cell_at(sheet, row, 4)["f"]
        decorate(sheet, block)
        self.assertEqual(sheet["columnData"]["1"]["w"], 240)
        self.assertEqual(sheet["rowData"][str(row)], {"h": 70, "ia": 0})
        self.assertEqual(cell_at(sheet, row, 1)["v"], "Producto")
        self.assertEqual(cell_at(sheet, row, 1)["s"]["bg"]["rgb"], "#112233")
        self.assertEqual(cell_at(sheet, row, 4)["f"], formula)
