import uuid
import logging
from datetime import datetime, timezone

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import transaction


NOTIFICATION_CREATED = "notification.created"


def dispatch_invalidation(assignment_id):
    """Private hint only; every tab still obtains its authorized projection."""
    def send():
        try:
            layer = get_channel_layer()
            if layer:
                async_to_sync(layer.group_send)(f"notifications_assignment_{assignment_id}", {"type": "notification.invalidated"})
        except Exception:
            logging.getLogger(__name__).warning("Notification state push unavailable; recovery remains scheduled")
    transaction.on_commit(send, robust=True)


def build_notification_envelope(notification):
    return {
        "event_version": 2,
        "event_id": str(uuid.uuid4()),
        "event_type": NOTIFICATION_CREATED,
        "entity_type": "notification",
        "entity_id": str(notification.id),
        "occurred_at": datetime.now(timezone.utc).isoformat(),
        "payload": {
            "id": str(notification.id),
            "type": notification.type,
            "title": notification.title,
            "module": notification.module,
            "route": notification.route,
            "is_read": notification.is_read,
            "actor_is_owner": notification.metadata.get("actor_is_owner") is True,
        },
        "source": "bold_notifications",
    }


def dispatch_notification(notification):
    try:
        channel_layer = get_channel_layer()
        if channel_layer is not None:
            async_to_sync(channel_layer.group_send)(
                f"notifications_assignment_{notification.recipient_assignment_id}",
                {"type": "notification.created", "envelope": build_notification_envelope(notification)},
            )
    finally:
        from .push import wake_worker
        wake_worker()
