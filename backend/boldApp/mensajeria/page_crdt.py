"""Yjs-compatible documents with protected task references kept OUT of the CRDT."""
import base64
import binascii
import uuid
from pycrdt import Array, Doc, Map, Text
from rest_framework.exceptions import ValidationError
from .page_content import ICONS, validate_blocks
from .page_formatting import read_text, seed_formats

MAX_UPDATE_BYTES = 262144
MAX_STATE_BYTES = 4 * 1024 * 1024


def encode(value):
    return base64.b64encode(value).decode("ascii")


def decode(value, limit=MAX_UPDATE_BYTES):
    if not isinstance(value, str) or len(value) > ((limit + 2) // 3) * 4:
        raise ValidationError("La actualización supera el tamaño permitido.")
    try:
        result = base64.b64decode(value, validate=True)
    except (ValueError, binascii.Error):
        raise ValidationError("Actualización de colaboración no válida.")
    if len(result) > limit:
        raise ValidationError("La actualización supera el tamaño permitido.")
    return result


def empty_doc():
    return Doc({"title": Text(), "meta": Map(), "blocks": Map(), "order": Array()})


def seed_document(page):
    doc = empty_doc()
    with doc.transaction():
        doc["title"] += page.title
        doc["meta"]["icon"] = page.icon
        for block in page.blocks:
            # No task_id, task title or authorized projection can enter Yjs state.
            values = {key: value for key, value in block.items() if key not in {"id", "task_id", "task", "page_id", "page", "formats"}}
            if "text" in values:
                values["text"] = Text(values["text"])
            doc["blocks"][block["id"]] = Map(values)
            if block.get('formats'):
                seed_formats(doc['blocks'][block['id']]['text'],block['text'],block['formats'])
            doc["order"].append(block["id"])
    return doc


def load_document(state):
    doc = empty_doc()
    apply_update(doc, bytes(state))
    return doc


def apply_update(doc, update):
    try:
        doc.apply_update(update)
    except BaseException as error:
        # Rust parser panics are BaseException subclasses, not ordinary ValueError.
        if isinstance(error, (KeyboardInterrupt, SystemExit)):
            raise
        raise ValidationError("No se pudo interpretar la actualización de colaboración.") from error


def document_delta(doc, state):
    try:
        return doc.get_update(state)
    except BaseException as error:
        if isinstance(error, (KeyboardInterrupt, SystemExit)):
            raise
        raise ValidationError("Estado de sincronización no válido.") from error


def document_content(doc, page, assignment, request, references=None):
    if set(doc) != {"title", "meta", "blocks", "order"} or set(doc["meta"]) != {"icon"}:
        raise ValidationError("La estructura del documento no es válida.")
    title, _ = read_text(doc['title'],plain=True)
    icon = doc["meta"].get("icon")
    if len(title) > 160 or icon not in ICONS:
        raise ValidationError("El título admite 160 caracteres y un icono del catálogo.")
    blocks, order = doc["blocks"], doc["order"].to_py()
    if len(blocks) > 200 or len(order) > 1000 or not all(isinstance(key, str) for key in order):
        raise ValidationError("La página admite hasta 200 bloques.")
    refs = references or {}
    if not isinstance(refs, dict) or len(refs) > 200:
        raise ValidationError("Referencias protegidas no válidas.")
    # Concurrent moves can put a block ID twice in the shared order. Taking its
    # first occurrence is deterministic on every replica and never duplicates it.
    identities = list(dict.fromkeys(order + sorted(set(blocks) - set(order))))
    values = []
    for identity in identities:
        if identity not in blocks:
            continue
        try:
            if str(uuid.UUID(identity)) != identity:
                raise ValueError()
        except ValueError:
            raise ValidationError("Identificador de bloque no válido.")
        shared = blocks[identity]
        if not isinstance(shared, Map):
            raise ValidationError("Bloque de colaboración no válido.")
        row = shared.to_py()
        # Yjs encodes ordinary JavaScript numbers as floating-point values.
        # Preserve strict REST validation while accepting integral CRDT levels.
        if type(row.get("level")) is float and row["level"] in (1.0, 2.0, 3.0):
            row["level"] = int(row["level"])
        if set(row) - {"type", "text", "checked", "level", "language"}:
            raise ValidationError("El estado compartido contiene campos no admitidos.")
        if "text" in row and not isinstance(shared["text"], Text):
            raise ValidationError("El texto debe conservar su tipo colaborativo.")
        if 'text' in row:
            text,formats=read_text(shared['text'],plain=row.get('type') in ('code','page'))
            row['text']=text
            if formats:row['formats']=formats
        row["id"] = identity
        if row.get("type") == "task" and identity in refs:
            row["task_id"] = refs[identity]
        if row.get('type')=='page' and identity in refs:
            row['page_id']=refs[identity]
        values.append(row)
    if set(refs) - {row["id"] for row in values if row["type"] in ("task", "page")}:
        raise ValidationError("Las referencias no pertenecen a los bloques de esta página.")
    normalized = validate_blocks(values, assignment, request, page.blocks)
    state = doc.get_update()
    if len(state) > MAX_STATE_BYTES:
        raise ValidationError("El historial colaborativo alcanzó su límite. Conserva el borrador y solicita reiniciar la colaboración desde una versión guardada.")
    return title.strip() or "Página sin título", icon, normalized, state
