from django.urls import re_path

from .consumers import CoreEventsConsumer


# Define las rutas WebSocket del nucleo: un unico canal en vivo, global.
websocket_urlpatterns = [
    re_path(r"^ws/core/$", CoreEventsConsumer.as_asgi()),
]
