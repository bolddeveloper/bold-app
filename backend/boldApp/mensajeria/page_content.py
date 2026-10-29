"""Bounded, plain-text blocks and live task projections (never HTML snapshots)."""
import hashlib
import json
import uuid
from rest_framework.exceptions import ValidationError
from .channel_tasks import TaskReferences
from .page_formatting import TEXT_TYPES, LANGUAGES, validate_formats

ICONS = ("note", "book", "checklist", "idea")
TYPES = ("paragraph", "heading", "bullet", "check", "task", "page", "code")


def digest(value):
    try:return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()
    except (TypeError,ValueError,UnicodeError):raise ValidationError('El contenido no es JSON Unicode válido.')


def content_size(value):
    try:return len(json.dumps(value,ensure_ascii=False).encode('utf-8'))
    except (TypeError,ValueError,UnicodeError):raise ValidationError('El contenido no es JSON Unicode válido.')


def validate_blocks(blocks, assignment, request, previous=()):
    if not isinstance(blocks, list) or len(blocks) > 200 or content_size(blocks) > 100_000:
        raise ValidationError("La página admite hasta 200 bloques y 100 KB de contenido.")
    old = {row["id"]: row for row in previous}
    seen, result = set(), []
    refs = TaskReferences(assignment, request)
    page_refs = None
    for row in blocks:
        if not isinstance(row, dict) or set(row) - {"id", "type", "text", "checked", "level", "task_id", "page_id", "formats", "language"}:
            raise ValidationError("Bloque no válido.")
        try:
            identity = str(uuid.UUID(str(row.get("id", ""))))
        except (ValueError, TypeError, AttributeError):
            raise ValidationError("Cada bloque necesita un identificador válido.")
        kind = row.get("type")
        if identity in seen or kind not in TYPES:
            raise ValidationError("Los bloques deben tener identificadores únicos y un tipo admitido.")
        seen.add(identity)
        if 'formats' in row and kind not in TEXT_TYPES or 'language' in row and kind!='code':
            raise ValidationError('El formato o lenguaje no corresponde al tipo de bloque.')
        block = {"id": identity, "type": kind}
        if kind == "task":
            task_id = row.get("task_id")
            # A reader without task access may preserve an opaque existing block,
            # not replace it with a new unauthorized reference.
            if old.get(identity, {}).get("type") == "task" and (task_id is None or str(task_id) == old[identity]["task_id"]):
                task_id = old[identity]["task_id"]
            else:
                try:
                    task_id = str(uuid.UUID(str(task_id)))
                except (ValueError, TypeError, AttributeError):
                    raise ValidationError("Referencia a tarea no válida.")
                refs.require(uuid.UUID(task_id))
            block["task_id"] = task_id
        elif kind == 'page':
            page_id=row.get('page_id')
            if old.get(identity,{}).get('type')=='page' and (page_id is None or str(page_id)==old[identity]['page_id']):
                page_id=old[identity]['page_id']
            else:
                try:
                    page_id=str(uuid.UUID(str(page_id)))
                except (ValueError,TypeError,AttributeError):
                    raise ValidationError('Referencia a página no válida.')
                if page_refs is None:
                    from .channel_access import ChannelPolicy
                    from .page_links import PageReferences
                    page_refs=PageReferences(ChannelPolicy(assignment,request))
                page_refs.require(page_id)
            alias=row.get('text','')
            if not isinstance(alias,str) or len(alias)>160:
                raise ValidationError('El nombre opcional del enlace admite 160 caracteres.')
            block.update(page_id=page_id,text=alias)
        else:
            text = row.get("text", "")
            if not isinstance(text, str) or len(text) > 4000:
                raise ValidationError("Cada bloque admite hasta 4000 caracteres.")
            block["text"] = text
            if kind in TEXT_TYPES:
                formats=validate_formats(text,row.get('formats',[]))
                if formats:block['formats']=formats
            if kind=='code':
                language=row.get('language','text')
                if language not in LANGUAGES:raise ValidationError('Selecciona un lenguaje del catálogo.')
                block['language']=language
            if kind == "heading":
                level = row.get("level", 2)
                if type(level) is not int or level not in (1, 2, 3):
                    raise ValidationError("Nivel de título no válido.")
                block["level"] = level
            if kind == "check":
                checked = row.get("checked", False)
                if type(checked) is not bool:
                    raise ValidationError("Estado de casilla no válido.")
                block["checked"] = checked
        result.append(block)
    if content_size(result) > 100_000:
        raise ValidationError("La página supera los 100 KB de contenido.")
    return result


def project_blocks(blocks, policy):
    from .page_links import PageReferences
    refs = TaskReferences(policy.assignment, policy.request)
    refs.prime(uuid.UUID(row["task_id"]) for row in blocks if row["type"] == "task")
    page_refs=PageReferences(policy)
    page_refs.prime(row['page_id'] for row in blocks if row['type']=='page')
    result = []
    for row in blocks:
        if row['type']=='page':
            page=page_refs.data(row['page_id'])
            result.append({'id':row['id'],'type':'page','text':row.get('text',''),'page':page,
                           **({'page_id':row['page_id']} if page.get('available') else {})})
            continue
        if row["type"] != "task":
            result.append(row)
            continue
        task = refs.data(uuid.UUID(row["task_id"]))
        result.append({"id": row["id"], "type": "task", "task": task,
                       **({"task_id": row["task_id"]} if task.get("available") else {})})
    return result


def prime_page_cards(identities, channel, policy):
    from .page_models import ChannelPage
    identities = [identity for identity in identities if identity]
    policy.page_cards = {}
    if identities and policy.allows("slack.page.read", channel.unit, channel.pk):
        policy.page_cards = {str(row["id"]): {"available": True, "id": str(row["id"]),
            "title": row["title"], "icon": row["icon"], "archived": bool(row["archived_at"])}
            for row in ChannelPage.objects.filter(pk__in=identities, channel=channel).values("id", "title", "icon", "archived_at")}


def page_card(identity, channel, policy):
    if not policy.allows("slack.page.read", channel.unit, channel.pk):
        return {"available": False}
    if not hasattr(policy, "page_cards"):
        prime_page_cards([identity], channel, policy)
    return policy.page_cards.get(str(identity), {"available": False})
