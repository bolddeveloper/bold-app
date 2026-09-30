import uuid
from datetime import datetime, timezone

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer


NOTIFICATION_CREATED = "notification.created"


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
        },
        "source": "bold_notifications",
    }


def dispatch_notification(notification):
    channel_layer = get_channel_layer()
    if channel_layer is None:
        return
    async_to_sync(channel_layer.group_send)(
        f"notifications_assignment_{notification.recipient_assignment_id}",
        {"type": "notification.created", "envelope": build_notification_envelope(notification)},
    )
