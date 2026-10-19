"""Private, bounded hints over the existing authenticated session socket."""
import logging
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from boldApp.core.events import build_event_envelope
from .models import DirectConversation, DirectMessage
from .presenters import message_data, people, person_data
from .unread import summaries

log = logging.getLogger(__name__)


def publish_change(conversation, kind, message_ids):
    participants = (str(conversation.first_employee_id), str(conversation.second_employee_id))
    event = {"type": "messaging.changed", "conversation_id": str(conversation.pk), "kind": kind, "message_ids": [str(value) for value in message_ids]}

    def dispatch():
        layer = get_channel_layer()
        if layer is None:
            return
        try:
            for employee_id in participants:
                async_to_sync(layer.group_send)(f"messaging_employee_{employee_id}", event)
        except Exception:
            # A push outage must never turn an already-committed send into a 500.
            log.warning("Private chat push unavailable; persisted history remains available")
    transaction.on_commit(dispatch, robust=True)


def _conversations(employee_id):
    return DirectConversation.objects.filter(Q(first_employee_id=employee_id) | Q(second_employee_id=employee_id),
        first_employee__in=people().values("pk"), second_employee__in=people().values("pk"))


@transaction.atomic
def private_event(employee_id, event):
    conversation = _conversations(employee_id).select_for_update().filter(pk=event["conversation_id"]).first()
    if not conversation:
        return None
    rows = list(conversation.messages.filter(pk__in=event["message_ids"][:100]))
    if not rows:
        return None
    now = timezone.now()
    if event["kind"] == "receipt.updated":
        payload = {"conversation_id": str(conversation.pk), "receipts": [
            {"id": str(row.pk), "delivered_at": row.delivered_at, "read_at": row.read_at} for row in rows]}
    else:
        peer_id = conversation.second_employee_id if str(conversation.first_employee_id) == str(employee_id) else conversation.first_employee_id
        peer = people().get(pk=peer_id)
        payload = {"conversation_id": str(conversation.pk), "peer": person_data(peer), "updated_at": conversation.updated_at,
                   "messages": [message_data(row, employee_id, now) for row in rows]}
    payload["unread"] = summaries(DirectConversation.objects.filter(pk=conversation.pk), employee_id)[0]
    return build_event_envelope("messaging." + event["kind"], "direct_conversation", conversation.pk, payload)


def pending_event(employee_id):
    # At most 100 unacknowledged messages per connection. Older messages are
    # acknowledged when actually fetched from paginated history, never by presence.
    conversations = _conversations(employee_id)
    rows = list(DirectMessage.objects.filter(conversation__in=conversations, delivered_at__isnull=True)
                .exclude(author_id=employee_id).order_by("-created_at", "-id")[:100])
    if not rows:
        return None
    now = timezone.now()
    return build_event_envelope("messaging.sync", "employee", employee_id,
                                {"messages": [message_data(row, employee_id, now) for row in reversed(rows)]})
