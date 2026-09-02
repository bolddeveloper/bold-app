import json
import uuid
from datetime import datetime, timezone

from rest_framework.utils.encoders import JSONEncoder as DRFJSONEncoder


# Define los tipos de evento, calcados de task_event_types en
# frontend/modulos/tareas/src/services/task_events.js para que el sobre
# que arma el backend sea compatible con el contrato ya definido por el PWA.
TASK_CREATED = "task.created"
TASK_UPDATED = "task.updated"
TASK_STATUS_CHANGED = "task.status_changed"
TASK_DELETED = "task.deleted"
COMMENT_CREATED = "comment.created"
WEBHOOK_TEST = "webhook.test"

EVENT_TYPE_CHOICES = [
    TASK_CREATED,
    TASK_UPDATED,
    TASK_STATUS_CHANGED,
    TASK_DELETED,
    COMMENT_CREATED,
]


# Normaliza el payload a tipos planos de JSON (str/int/float/bool/None/
# list/dict). Los serializers de DRF devuelven UUID/Decimal crudos en los
# campos de relacion, que ni el serializador JSON real de Celery (fuera del
# modo eager) ni el channel layer (msgpack) saben codificar.
def _sanitize_payload(payload):
    return json.loads(json.dumps(payload, cls=DRFJSONEncoder))


# Arma el sobre normalizado del evento, con la misma forma que
# create_task_event() en el frontend: event_id, event_type, entity_type,
# entity_id, occurred_at, payload y source.
def build_event_envelope(event_type, entity_type, entity_id, payload):
    return {
        "event_id": str(uuid.uuid4()),
        "event_type": event_type,
        "entity_type": entity_type,
        "entity_id": str(entity_id),
        "occurred_at": datetime.now(timezone.utc).isoformat(),
        "payload": _sanitize_payload(payload),
        "source": "bold_backend",
    }


# Encola la entrega del evento hacia cada WebhookEndpoint activo del workspace
# que este suscrito a ese event_type (o a todos, si event_types esta vacio),
# y lo transmite en vivo por WebSocket a los clientes conectados al mismo
# workspace. Un solo punto de disparo alimenta ambos caminos.
def dispatch_task_event(workspace_id, event_type, entity_type, entity_id, payload):
    from asgiref.sync import async_to_sync
    from channels.layers import get_channel_layer

    from .models import WebhookEndpoint
    from .webhook_tasks import deliver_webhook

    envelope = build_event_envelope(event_type, entity_type, entity_id, payload)

    endpoints = WebhookEndpoint.objects.filter(workspace_id=workspace_id, is_active=True)
    for endpoint in endpoints:
        if endpoint.event_types and event_type not in endpoint.event_types:
            continue
        deliver_webhook.delay(str(endpoint.id), envelope)

    channel_layer = get_channel_layer()
    if channel_layer is not None:
        async_to_sync(channel_layer.group_send)(
            f"workspace_{workspace_id}",
            {"type": "task.event", "envelope": envelope},
        )

    return envelope
