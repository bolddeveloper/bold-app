from django.urls import re_path

from .consumers import TaskEventsConsumer


# Define las rutas WebSocket de boldApp: un canal en vivo por workspace.
websocket_urlpatterns = [
    re_path(r"^ws/workspace/(?P<workspace_id>[^/]+)/$", TaskEventsConsumer.as_asgi()),
]
