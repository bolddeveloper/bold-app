"""Durable collaboration transactions. Access is checked after acquiring locks."""
import uuid
from datetime import timedelta
from types import SimpleNamespace
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import transaction
from django.db.models import F, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from boldApp.autenticacion.models import AuthSession
from boldApp.core.models import PositionAssignment
from .channel_access import ChannelPolicy
from .channel_events import publish_channel
from .page_models import ChannelPage, PageCollaboration, PageUpdateReceipt
from .page_content import digest, project_blocks
from .page_crdt import decode, encode, load_document, seed_document, document_content, apply_update, document_delta
from .page_views import page_data, record
from .models import DepartmentChannel


def page_group(identity):
    return "slack_page_" + str(identity)


def broadcast(page_id, event):
    def dispatch():
        layer = get_channel_layer()
        if layer:
            async_to_sync(layer.group_send)(page_group(page_id), event)
    transaction.on_commit(dispatch, robust=True)


def context(session_id, assignment_id, page_id, *, lock=False, write=False):
    now = timezone.now()
    session = AuthSession.objects.select_related("user_account__employee").filter(pk=session_id, revoked_at__isnull=True,
        expires_at__gt=now, credentials_version=F("user_account__credentials_version"), user_account__is_active=True,
        user_account__employee__is_active=True).filter(Q(idle_expires_at__isnull=True) | Q(idle_expires_at__gt=now)).first()
    if not session:
        raise PermissionDenied("Tu sesión ya no está disponible.")
    assignment = get_object_or_404(PositionAssignment.objects.select_related("employee__user_account", "position__unit", "position__job_role"),
        pk=assignment_id, employee_id=session.user_account.employee_id, is_active=True, released_at__isnull=True)
    channel_id = ChannelPage.objects.filter(pk=page_id).values_list("channel_id", flat=True).first()
    channels = DepartmentChannel.objects.select_related("unit", "creator")
    channel = get_object_or_404(channels.select_for_update(of=("self",)) if lock else channels, pk=channel_id)
    request = SimpleNamespace(auth=session, user=session.user_account, assignment=assignment, META={}, method="WEBSOCKET", path="/ws/pages/")
    policy = ChannelPolicy(assignment, request)
    policy.prime([channel])
    for permission in ("slack.channel.read", "slack.page.read"):
        if not policy.allows(permission, channel.unit, channel.pk):
            raise NotFound("La página no está disponible con tus permisos actuales.")
    page = get_object_or_404(channel.pages.select_related("updated_by"), pk=page_id)
    if write and (channel.archived_at or page.archived_at or not policy.allows("slack.page.update", channel.unit, channel.pk)):
        raise PermissionDenied("La página es de solo lectura con tus permisos actuales.")
    return page, channel, policy, request


def room_for(page):
    room = PageCollaboration.objects.filter(page=page).first()
    if room is None:
        room = PageCollaboration.objects.create(page=page, state=seed_document(page).get_update())
    return room


def reset_collaboration(page):
    if PageCollaboration.objects.filter(page=page).exists():
        room = PageCollaboration.objects.get(page=page)
        room.epoch, room.state = uuid.uuid4(), seed_document(page).get_update()
        room.save()
        broadcast(page.pk, {"type": "page.reset", "page_id": str(page.pk), "epoch": str(room.epoch)})


@transaction.atomic
def initial_state(session_id, assignment_id, page_id):
    page, channel, policy, request = context(session_id, assignment_id, page_id, lock=True)
    room = room_for(page)
    doc = load_document(room.state)
    return {"type": "sync", "epoch": str(room.epoch), "update": encode(bytes(room.state)), "state": encode(doc.get_state()),
            "page": page_data(page, channel, policy), "self": {"employee_id": str(policy.assignment.employee_id),
                "name": policy.assignment.employee.full_name, "avatar_url": policy.assignment.employee.user_account.avatar_url}}


@transaction.atomic
def synchronize(session_id, assignment_id, page_id, payload):
    page, channel, policy, request = context(session_id, assignment_id, page_id, lock=True)
    room = room_for(page)
    if payload.get("epoch") != str(room.epoch):
        return initial_state(session_id, assignment_id, page_id)
    doc = load_document(room.state)
    delta = document_delta(doc, decode(payload.get("state"), 16384))
    return {"type": "sync_delta", "epoch": str(room.epoch), "update": encode(delta), "state": encode(doc.get_state()),
            "version": page.version, "can_edit": not page.archived_at and not channel.archived_at and policy.allows("slack.page.update", channel.unit, channel.pk),
            "tasks": project_blocks([r for r in page.blocks if r["type"] == "task"], policy)}


@transaction.atomic
def commit_update(session_id, assignment_id, page_id, payload, connection_id):
    if not isinstance(payload, dict) or set(payload) - {"type", "epoch", "client_id", "update", "state", "references"}:
        raise ValidationError("Actualización no válida.")
    try:
        token, epoch = uuid.UUID(str(payload.get("client_id"))), uuid.UUID(str(payload.get("epoch")))
    except (ValueError, TypeError):
        raise ValidationError("Identificador de actualización no válido.")
    update, state = decode(payload.get("update")), decode(payload.get("state"), 16384)
    page, channel, policy, request = context(session_id, assignment_id, page_id, lock=True, write=True)
    room = room_for(page)
    if epoch != room.epoch:
        return {"type": "reset_required"}
    receipt_hash = digest(payload)
    previous = page.collaboration_receipts.filter(epoch=epoch, actor_id=policy.assignment.employee_id, client_id=token).first()
    if previous and previous.digest != receipt_hash:
        raise ValidationError("El identificador de actualización ya existe con otro contenido.")
    doc = load_document(room.state)
    before = doc.get_state()
    if not previous:
        apply_update(doc, update)
        title, icon, blocks, encoded = document_content(doc, page, policy.assignment, request, payload.get("references"))
        changed = before != doc.get_state() or (title, icon, blocks) != (page.title, page.icon, page.blocks)
        if changed:
            # Periodic immutable checkpoints, not a full page per keystroke.
            latest = page.revisions.order_by("-version").only("version", "created_at").first()
            if latest and latest.version < page.version and timezone.now() - latest.created_at >= timedelta(seconds=30):
                record(page, page.updated_by_id, uuid.uuid4(), digest({"checkpoint": page.version}))
            title_changed = title != page.title
            refs_changed = [(r["id"], r.get("task_id")) for r in blocks if r["type"] == "task"] != [(r["id"], r.get("task_id")) for r in page.blocks if r["type"] == "task"]
            page.title, page.icon, page.blocks = title, icon, blocks
            page.version += 1
            page.updated_by_id = policy.assignment.employee_id
            page.save()
            room.state = encoded
            room.save()
            broadcast(page.pk, {"type": "page.update", "page_id": str(page.pk), "epoch": str(epoch), "update": encode(update),
                "version": page.version, "connection": connection_id, "references_changed": refs_changed})
            if title_changed:
                publish_channel(channel, "page.title_changed")
        PageUpdateReceipt.objects.create(page=page, epoch=epoch, actor_id=policy.assignment.employee_id, client_id=token,
            digest=receipt_hash, version=page.version)
    delta = document_delta(doc, state)
    return {"type": "ack", "client_id": str(token), "epoch": str(epoch), "version": page.version,
            "update": encode(delta), "state": encode(doc.get_state()), "updated_by": page.updated_by.full_name,
            "updated_at": page.updated_at.isoformat(), "tasks": project_blocks([r for r in page.blocks if r["type"] == "task"], policy)}


def authorized_event(session_id, assignment_id, page_id, event):
    page, channel, policy, request = context(session_id, assignment_id, page_id)
    room = PageCollaboration.objects.get(page=page)
    result = {"type": "update", "epoch": event["epoch"], "update": event["update"], "version": event["version"],
              "can_edit": not page.archived_at and not channel.archived_at and policy.allows("slack.page.update", channel.unit, channel.pk)}
    if str(room.epoch) != event["epoch"]:
        return {"type": "reset_required"}
    if event.get("references_changed"):
        result["tasks"] = project_blocks([r for r in page.blocks if r["type"] == "task"], policy)
    return result
