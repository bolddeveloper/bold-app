import json
import uuid
from datetime import datetime, timezone

from rest_framework.utils.encoders import JSONEncoder as DRFJSONEncoder


# Define los tipos de evento que emite el nucleo. El sobre tiene la misma
# forma que build_event_envelope() en boldApp/tareas/webhook_events.py a
# proposito: cuando tareas se reescriba para integrarse con el nucleo, ambos
# modulos podran compartir un unico mecanismo de entrega (webhooks salientes
# + WebSocket) sin cambiar el contrato del sobre.
POSITION_ASSIGNMENT_ACTIVATED = "core.position_assignment.activated"
POSITION_ASSIGNMENT_RELEASED = "core.position_assignment.released"
ACCESS_GRANT_CREATED = "core.access_grant.created"
ACCESS_GRANT_REVOKED = "core.access_grant.revoked"
PERMISSION_AUDIT_LOGGED = "core.permission_audit.logged"

EVENT_TYPE_CHOICES = [
    POSITION_ASSIGNMENT_ACTIVATED,
    POSITION_ASSIGNMENT_RELEASED,
    ACCESS_GRANT_CREATED,
    ACCESS_GRANT_REVOKED,
    PERMISSION_AUDIT_LOGGED,
]

# Nombre del grupo de canal (Channels) al que se transmiten todos los
# eventos del nucleo. A diferencia de tareas (un grupo por workspace), el
# nucleo no tiene todavia un concepto de espacio de trabajo propio, asi que
# usa un unico grupo global.
CORE_EVENTS_GROUP = "core_events"


# Normaliza el payload a tipos planos de JSON, igual que en el modulo de tareas.
def _sanitize_payload(payload):
    return json.loads(json.dumps(payload, cls=DRFJSONEncoder))


def build_event_envelope(event_type, entity_type, entity_id, payload):
    return {
        "event_version": 2,
        "event_id": str(uuid.uuid4()),
        "event_type": event_type,
        "entity_type": entity_type,
        "entity_id": str(entity_id),
        "occurred_at": datetime.now(timezone.utc).isoformat(),
        "payload": _sanitize_payload(payload),
        "source": "bold_backend",
    }


# Transmite el evento en vivo por WebSocket a los clientes conectados a
# ws/core/. El nucleo no gestiona endpoints de webhook salientes propios
# todavia (no hay tabla de suscriptores en su diagrama); cuando el modulo de
# tareas se reescriba, ambos podran compartir el WebhookEndpoint/
# deliver_webhook que ya existe alli en vez de duplicar esa infraestructura.
def dispatch_core_event(event_type, entity_type, entity_id, payload):
    from asgiref.sync import async_to_sync
    from channels.layers import get_channel_layer

    envelope = build_event_envelope(event_type, entity_type, entity_id, payload)

    channel_layer = get_channel_layer()
    if channel_layer is not None:
        async_to_sync(channel_layer.group_send)(
            CORE_EVENTS_GROUP,
            {"type": "core.event", "envelope": envelope},
        )

    return envelope
