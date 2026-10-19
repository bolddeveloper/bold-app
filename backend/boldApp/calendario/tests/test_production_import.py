import tempfile
from pathlib import Path
from zipfile import ZipFile

from django.test import SimpleTestCase
from boldApp.calendario.production_import import production_events


class ProductionImportTests(SimpleTestCase):
    def test_month_boundary_date_anomaly_and_text_in_date_row(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "source.xlsx"
            with ZipFile(path, "w") as archive:
                archive.writestr("xl/workbook.xml", '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Agenda" r:id="r1"/></sheets></workbook>')
                archive.writestr("xl/_rels/workbook.xml.rels", '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>')
                archive.writestr("xl/worksheets/sheet1.xml", '''<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
                    <row r="1"><c r="B1"><v>45658</v></c></row>
                    <row r="2"><c r="D2"><v>1</v></c><c r="E2"><v>2</v></c><c r="F2"><v>5</v></c><c r="G2"><v>4</v></c><c r="H2"><v>5</v></c></row>
                    <row r="3"><c r="D3" t="inlineStr"><is><t>Inicio</t></is></c></row>
                    <row r="4"><c r="B4"><v>27</v></c><c r="C4"><v>28</v></c><c r="D4" t="inlineStr"><is><t>Actividad sobre la fila de fechas</t></is></c><c r="E4"><v>30</v></c><c r="F4"><v>31</v></c><c r="G4"><v>1</v></c><c r="H4"><v>2</v></c></row>
                    <row r="5"><c r="A5" t="inlineStr"><is><t>Nota original</t></is></c><c r="F5" t="inlineStr"><is><t>Cierre</t></is></c><c r="G5" t="inlineStr"><is><t>Sábado</t></is></c></row>
                    </sheetData></worksheet>''')
            data = production_events(path)
        events = {row["source_cell"]: row for row in data["events"]}
        self.assertEqual(events["D3"]["start"]["date"], "2025-01-01")
        self.assertEqual(events["D4"]["start"]["date"], "2025-01-29")
        self.assertEqual(events["F5"]["start"]["date"], "2025-01-31")
        self.assertEqual(events["G5"]["start"]["date"], "2025-02-01")
        self.assertIn("Nota original", events["F5"]["description"])
        self.assertEqual(len(data["warnings"]), 1)
