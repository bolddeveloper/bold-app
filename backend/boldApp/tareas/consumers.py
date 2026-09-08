from channels.generic.websocket import AsyncJsonWebsocketConsumer


# Define el consumer que transmite eventos de tareas en vivo a los clientes
# conectados de un mismo workspace. Sin autenticacion todavia (mismo alcance
# que el resto del esqueleto DRF).
class TaskEventsConsumer(AsyncJsonWebsocketConsumer):

    async def connect(self):
        self.workspace_group_name = f"workspace_{self.scope['url_route']['kwargs']['workspace_id']}"
        await self.channel_layer.group_add(self.workspace_group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.workspace_group_name, self.channel_name)

    # Reenvia al cliente el sobre de evento recibido del grupo de canal
    # (encolado desde dispatch_task_event, sin modificarlo).
    async def task_event(self, event):
        await self.send_json(event["envelope"])
