"""Bounded document envelopes, never an antivirus or an in-app renderer.

No archive extraction, subprocess, network fetch, conversion or macro execution.
Downloads remain attachments; the original bytes are retained for integrity.
"""
import csv
import io
import re
import stat
import struct
import unicodedata
import zipfile
import zlib
from pathlib import PurePosixPath
from xml.etree import ElementTree as ET

from rest_framework.exceptions import ValidationError

DOCUMENT_MIMES = {
    "pdf": "application/pdf", "txt": "text/plain", "csv": "text/csv",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}
MAX_TEXT = 2 * 1024 * 1024
MAX_PARTS = 2048
MAX_EXPANDED = 32 * 1024 * 1024
MAX_PART = 8 * 1024 * 1024
MAX_XML = 6 * 1024 * 1024
MAX_NODES = 100_000
CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
MAIN = {
    "docx": ("word/document.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml", "wordprocessingml", "document"),
    "xlsx": ("xl/workbook.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml", "spreadsheetml", "workbook"),
    "pptx": ("ppt/presentation.xml", "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml", "presentationml", "presentation"),
}


def invalid(reason):
    raise ValidationError("Documento no admitido: " + reason)


def xml_part(raw):
    if len(raw) > MAX_XML:
        invalid("una parte XML supera los 6 MB. Guarda una copia más pequeña.")
    try:
        text = raw.decode("utf-8-sig")
        if re.search(r"<!\s*(?:DOCTYPE|ENTITY)\b", text, re.I):
            invalid("el XML no puede contener DTD ni entidades declaradas.")
        encoding = re.search(r'<\?xml\b[^>]*\bencoding\s*=\s*[\'"]([^\'"]+)', text[:512], re.I)
        if encoding and encoding[1].lower() not in ("utf-8", "utf8", "us-ascii"):
            invalid("usa XML UTF-8 en los archivos Office.")
        root = ET.fromstring(raw)
    except (UnicodeError, ET.ParseError) as exc:
        raise ValidationError("Documento no admitido: una parte XML es inválida o no es UTF-8.") from exc
    stack, count = [(root, 1)], 0
    while stack:
        node, depth = stack.pop()
        count += 1
        if count > MAX_NODES or depth > 80:
            invalid("el XML excede los límites de complejidad.")
        stack.extend((child, depth + 1) for child in node)
    return root


def office(content, extension):
    main, main_type, family, root_tag = MAIN[extension]
    try:
        if not content.startswith(b"PK\x03\x04"):
            invalid("Office moderno debe usar un contenedor ZIP, sin cabeceras ejecutables.")
        # Bound the central directory before ZipFile allocates a ZipInfo for
        # every entry. Do not trust a small declared entry count on its own.
        end = content.rfind(b"PK\x05\x06", max(0, len(content) - 65557))
        if end < 0 or len(content) - end < 22:
            invalid("el directorio del paquete Office no es válido.")
        _, disk, central_disk, on_disk, declared, central_size, offset, comment = struct.unpack_from("<4s4H2LH", content, end)
        if disk or central_disk or on_disk != declared or not 0 < declared <= MAX_PARTS or central_size > 2 * 1024 * 1024 or offset + central_size != end or end + 22 + comment != len(content):
            invalid("el directorio del paquete excede los límites o utiliza ZIP dividido/ZIP64.")
        position, count = offset, 0
        while position < end:
            if content[position:position + 4] != b"PK\x01\x02" or position + 46 > end:
                invalid("el directorio del paquete está dañado.")
            lengths = struct.unpack_from("<3H", content, position + 28)
            if not lengths[0] or lengths[0] > 500 or lengths[1] > 4096 or lengths[2] > 4096:
                invalid("los metadatos de una parte exceden los límites.")
            position += 46 + sum(lengths)
            count += 1
            if count > MAX_PARTS or position > end:
                invalid("el directorio del paquete excede los límites.")
        if position != end or count != declared:
            invalid("el número de partes declarado no coincide con el paquete.")
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            entries = archive.infolist()
            if not entries or len(entries) > MAX_PARTS:
                invalid("el paquete Office supera 2.048 partes.")
            names, total, parsed = set(), 0, {}
            for info in entries:
                name = info.filename
                parts = PurePosixPath(name).parts
                canonical = unicodedata.normalize("NFC", name).casefold()
                if (not name or name != info.orig_filename or len(name) > 500 or name.startswith("/") or "\\" in name or ":" in name or
                    any(part in (".", "..") for part in name.split("/")) or any(unicodedata.category(c).startswith("C") for c in name) or canonical in names):
                    invalid("el paquete contiene rutas o nombres de parte inválidos.")
                names.add(canonical)
                if (info.flag_bits & 1 or info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED) or
                    stat.S_ISLNK(info.external_attr >> 16)):
                    invalid("no se permiten partes cifradas, enlaces o compresión especial.")
                total += info.file_size
                if info.file_size > MAX_PART or total > MAX_EXPANDED or info.file_size > max(1, info.compress_size) * 200:
                    invalid("el paquete excede 32 MB expandidos, 8 MB por parte o una compresión de 200:1.")
                lower = name.lower()
                if (any(part.lower() in ("activex", "embeddings", "externallinks") for part in parts) or
                    "vbaproject" in lower or PurePosixPath(lower).suffix in (".exe", ".dll", ".com", ".scr", ".msi", ".ps1", ".bat", ".cmd", ".vbs", ".js", ".jar")):
                    invalid("guarda una copia Office sin macros, objetos incrustados ni vínculos de datos externos.")
                if info.is_dir():
                    continue
                # Read every bounded member to verify its actual length and CRC.
                with archive.open(info) as source:
                    raw = source.read(MAX_PART + 1)
                if len(raw) != info.file_size or len(raw) > MAX_PART:
                    invalid("una parte del paquete tiene un tamaño incoherente.")
                if lower.endswith((".xml", ".rels")):
                    node = xml_part(raw)
                    if name in ("[Content_Types].xml", "_rels/.rels", main):
                        parsed[name] = node
                    if lower.endswith(".rels"):
                        if node.tag != "{" + REL_NS + "}Relationships":
                            invalid("las relaciones del paquete son inválidas.")
                        for rel in node:
                            relation = rel.get("Type", "").lower()
                            if any(word in relation for word in ("vba", "activex", "oleobject", "altchunk", "attachedtemplate", "externallink")):
                                invalid("el paquete contiene relaciones activas o vínculos de datos no admitidos.")
                            if rel.get("TargetMode", "").lower() == "external":
                                # Passive hyperlinks are retained; no content is fetched.
                                from .resource_links_v1 import resource_links
                                target = rel.get("Target", "")
                                links = resource_links(target)
                                if rel.get("Type", "") not in ("http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink", "http://purl.oclc.org/ooxml/officeDocument/relationships/hyperlink") or len(links) != 1 or links[0]["href"] != target:
                                    invalid("solo se admiten hipervínculos http/https como relaciones externas.")
            types, relationships, document = (parsed.get(key) for key in ("[Content_Types].xml", "_rels/.rels", main))
            if types is None or relationships is None or document is None or types.tag != "{" + CT_NS + "}Types":
                invalid("faltan las partes principales del documento Office.")
            declarations = [node.get("ContentType", "") for node in types]
            if any(any(word in value.lower() for word in ("macroenabled", "vbaproject", "activex", "oleobject")) for value in declarations):
                invalid("no se admiten contenidos Office con macros u objetos activos.")
            matches = [node for node in types if node.tag == "{" + CT_NS + "}Override" and node.get("PartName") == "/" + main]
            if len(matches) != 1 or matches[0].get("ContentType") != main_type:
                invalid("el tipo principal no coincide con la extensión Office.")
            roots = [node for node in relationships if node.get("Type", "") in ("http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument", "http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument")]
            if len(roots) != 1 or roots[0].get("Target", "").lstrip("/") != main or roots[0].get("TargetMode", "").lower() == "external":
                invalid("la relación principal del documento Office no es válida.")
            namespaces = (f"http://schemas.openxmlformats.org/{family}/2006/main", f"http://purl.oclc.org/ooxml/{family}/main")
            if document.tag not in ("{" + ns + "}" + root_tag for ns in namespaces):
                invalid("la estructura principal no coincide con el documento Office.")
    except (zipfile.BadZipFile, zlib.error, struct.error, RuntimeError, OSError, NotImplementedError, EOFError, ValueError) as exc:
        raise ValidationError("Documento no admitido: el contenedor Office está dañado o no es válido.") from exc


def pdf(content):
    # Envelope checks only, deliberately without inflating PDF streams or running
    # a renderer. This does not prove that a PDF is free of active content/malware.
    if not re.match(rb"%PDF-(?:1\.[0-7]|2\.0)(?:\r\n|\r|\n)", content[:16]):
        invalid("la cabecera PDF no es válida.")
    end = re.search(rb"startxref\s+(\d{1,12})\s+%%EOF[\x00\t\r\n ]*$", content[-4096:])
    if not end:
        invalid("el PDF está incompleto o no tiene cierre y referencias válidas.")
    offset = int(end[1])
    if offset >= len(content):
        invalid("las referencias del PDF están fuera del archivo.")
    start = content[offset:offset + 2048]
    if not start.startswith(b"xref") and not (re.match(rb"\d+\s+\d+\s+obj\b", start) and re.search(rb"/Type\s*/XRef\b", start)):
        invalid("las referencias del PDF no coinciden con su posición.")


def prepare_document(name, mime, content):
    extension = PurePosixPath(str(name).replace("\\", "/")).suffix.lower().lstrip(".")
    expected = DOCUMENT_MIMES.get(extension)
    # Browsers on Windows may report CSV as legacy Excel or no MIME at all.
    aliases = {"", "application/octet-stream", expected}
    if extension == "csv":
        aliases.add("application/vnd.ms-excel")
    if not expected or mime not in aliases:
        invalid("usa PDF, TXT/CSV UTF-8, DOCX, XLSX o PPTX y una extensión coherente con su tipo.")
    if extension in MAIN:
        office(content, extension)
    elif extension == "pdf":
        pdf(content)
    else:
        if len(content) > MAX_TEXT:
            invalid("TXT y CSV tienen un límite de 2 MB.")
        try:
            text = content.decode("utf-8-sig")
            if not text.strip() or any(unicodedata.category(c) == "Cc" and c not in "\t\r\n" for c in text):
                invalid("el texto está vacío o contiene datos binarios/controles.")
            if extension == "csv":
                delimiter = ";" if text.splitlines()[0].count(";") > text.splitlines()[0].count(",") else ","
                for index, row in enumerate(csv.reader(io.StringIO(text), delimiter=delimiter, strict=True)):
                    if index >= 50_000 or len(row) > 256:
                        invalid("el CSV supera 50.000 filas o 256 columnas.")
        except (UnicodeError, csv.Error) as exc:
            raise ValidationError("Documento no admitido: usa texto UTF-8 o un CSV válido sin campos excesivos.") from exc
    return expected
