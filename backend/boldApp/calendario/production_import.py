"""Read the supplied production agenda without altering the source workbook."""
from collections import Counter
from datetime import date, datetime, timedelta
from pathlib import PurePosixPath
import re
from xml.etree import ElementTree as ET
from zipfile import ZipFile

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def production_events(path):
    events, warnings = [], []
    with ZipFile(path) as archive:
        strings = []
        if "xl/sharedStrings.xml" in archive.namelist():
            strings = ["".join(node.itertext()) for node in ET.fromstring(archive.read("xl/sharedStrings.xml")).findall("m:si", NS)]
        relationships = {node.attrib["Id"]: node.attrib["Target"] for node in ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))}
        sheets = ET.fromstring(archive.read("xl/workbook.xml")).findall("m:sheets/m:sheet", NS)
        for sheet in sheets:
            target = relationships[sheet.attrib["{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"]]
            filename = str(PurePosixPath("xl") / target) if not target.startswith("/") else target.lstrip("/")
            month, current_days = None, {}
            for row in ET.fromstring(archive.read(filename)).findall("m:sheetData/m:row", NS):
                cells = {}
                for cell in row.findall("m:c", NS):
                    value = cell.find("m:v", NS)
                    text = value.text if value is not None else "".join(cell.find("m:is", NS).itertext()) if cell.find("m:is", NS) is not None else ""
                    if cell.get("t") == "s":
                        text = strings[int(text)]
                    if text and text.strip():
                        cells[cell.attrib["r"]] = text.strip()
                serial = next((float(text) for ref, text in cells.items() if ref.startswith("B") and re.fullmatch(r"\d+(?:\.0)?", text) and 40000 < float(text) < 80000), None)
                if serial:
                    month = (datetime(1899, 12, 30) + timedelta(days=serial)).date().replace(day=1)
                    current_days = {}
                    continue
                if not month or any(text.upper() == "LUNES" for text in cells.values()):
                    continue
                numbers = {ref[0]: int(float(text)) for ref, text in cells.items() if ref[0] in "BCDEFGH" and re.fullmatch(r"\d+(?:\.0)?", text) and 1 <= float(text) <= 31}
                if numbers:
                    anchors = []
                    for column, number in numbers.items():
                        try:
                            value = date(month.year, month.month, number)
                        except ValueError:
                            continue
                        anchors.append(value - timedelta(days="BCDEFGH".index(column)))
                    if not anchors:
                        raise ValueError(f"No se pudo fechar {sheet.attrib['name']} fila {row.attrib['r']}")
                    monday = Counter(anchors).most_common(1)[0][0]
                    current_days = {column: monday + timedelta(days=index) for index, column in enumerate("BCDEFGH")}
                    for column, number in numbers.items():
                        expected = current_days[column]
                        # A small number after a month boundary refers to the following month.
                        next_month = (month.replace(day=28) + timedelta(days=4)).replace(day=1)
                        actual_month = next_month if expected >= next_month and number <= 7 else month
                        actual = date(actual_month.year, actual_month.month, number)
                        current_days[column] = actual
                        if actual != expected or actual.weekday() != "BCDEFGH".index(column):
                            warnings.append({"sheet": sheet.attrib["name"], "cell": column + row.attrib["r"], "date": actual.isoformat(), "message": "El número de día no coincide con la posición semanal. Se conserva el número del Excel."})
                note = "\n".join(text for ref, text in cells.items() if ref.startswith("A"))
                for ref, text in cells.items():
                    column = ref[0]
                    if column not in current_days or column not in "BCDEFGH" or column in numbers and re.fullmatch(r"\d+(?:\.0)?", text):
                        continue
                    day = current_days[column]
                    label = sheet.attrib["name"]
                    relevant = [warning["message"] for warning in warnings if warning["sheet"] == label and warning["cell"][0] == column and warning["date"] == day.isoformat()]
                    description = f"{text}\n\nAgenda: {label}\nOrigen: {ref}\nHorario conservado en el texto original."
                    if note:
                        description += "\nNota de la fila: " + note
                    if relevant:
                        description += "\nRevisar fecha: " + relevant[-1]
                    events.append({"source_key": label + ":" + ref, "summary": text[:200], "description": description, "start": {"date": day.isoformat()}, "end": {"date": (day + timedelta(days=1)).isoformat()}, "colorId": "7" if len(events) == 0 or label == sheets[0].attrib["name"] else "2", "source_agenda": label, "source_cell": ref})
    return {"events": events, "warnings": warnings}
