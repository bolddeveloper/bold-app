from channels.generic.websocket import AsyncJsonWebsocketConsumer

from .events import CORE_EVENTS_GROUP


# Define el consumer que transmite eventos del nucleo (asignaciones,
# accesos especiales, auditoria) en vivo a los clientes conectados. Sin
# autenticacion todavia, igual que TaskEventsConsumer en boldApp/tareas.
class CoreEventsConsumer(AsyncJsonWebsocketConsumer):

    async def connect(self):
        await self.channel_layer.group_add(CORE_EVENTS_GROUP, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(CORE_EVENTS_GROUP, self.channel_name)

    # Reenvia al cliente el sobre de evento recibido del grupo de canal
    # (encolado desde dispatch_core_event, sin modificarlo).
    async def core_event(self, event):
        await self.send_json(event["envelope"])
