"""Bounded, plain-text blocks and live task projections (never HTML snapshots)."""
import hashlib
import json
import uuid
from rest_framework.exceptions import ValidationError
from .channel_tasks import TaskReferences

ICONS = ("note", "book", "checklist", "idea")
TYPES = ("paragraph", "heading", "bullet", "check", "task")


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def validate_blocks(blocks, assignment, request, previous=()):
    if not isinstance(blocks, list) or len(blocks) > 200 or len(json.dumps(blocks, ensure_ascii=False).encode()) > 100_000:
        raise ValidationError("La página admite hasta 200 bloques y 100 KB de contenido.")
    old = {row["id"]: row for row in previous}
    seen, result = set(), []
    refs = TaskReferences(assignment, request)
    for row in blocks:
        if not isinstance(row, dict) or set(row) - {"id", "type", "text", "checked", "level", "task_id"}:
            raise ValidationError("Bloque no válido.")
        try:
            identity = str(uuid.UUID(str(row.get("id", ""))))
        except (ValueError, TypeError, AttributeError):
            raise ValidationError("Cada bloque necesita un identificador válido.")
        kind = row.get("type")
        if identity in seen or kind not in TYPES:
            raise ValidationError("Los bloques deben tener identificadores únicos y un tipo admitido.")
        seen.add(identity)
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
        else:
            text = row.get("text", "")
            if not isinstance(text, str) or len(text) > 4000:
                raise ValidationError("Cada bloque admite hasta 4000 caracteres.")
            block["text"] = text
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
    if len(json.dumps(result, ensure_ascii=False).encode()) > 100_000:
        raise ValidationError("La página supera los 100 KB de contenido.")
    return result


def project_blocks(blocks, policy):
    refs = TaskReferences(policy.assignment, policy.request)
    refs.prime(uuid.UUID(row["task_id"]) for row in blocks if row["type"] == "task")
    result = []
    for row in blocks:
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
