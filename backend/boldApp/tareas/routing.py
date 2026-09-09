from django.urls import re_path

from .consumers import TaskEventsConsumer


# Define las rutas WebSocket de boldApp: un canal en vivo por unidad.
websocket_urlpatterns = [
    re_path(r"^ws/unit/(?P<unit_id>[^/]+)/$", TaskEventsConsumer.as_asgi()),
]
