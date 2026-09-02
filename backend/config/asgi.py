"""
Configuracion ASGI del proyecto boldApp.

Sirve tanto HTTP (la API REST de Django) como WebSocket (push en vivo de
eventos de tareas) desde el mismo proceso, usando Django Channels.
"""

import os

import django
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.security.websocket import OriginValidator
from django.core.asgi import get_asgi_application


os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

# Se importa despues de django.setup() porque routing.py importa modelos
# (a traves de consumers.py) que necesitan las apps ya cargadas.
from boldApp.routing import websocket_urlpatterns  # noqa: E402
from django.conf import settings  # noqa: E402


# Define el enrutador de protocolos: HTTP va a la app de Django de siempre,
# WebSocket va a las rutas de boldApp. Se usa OriginValidator (no
# AllowedHostsOriginValidator) porque el frontend vive en un origen distinto
# al backend en Render, y la validacion debe mirar la misma lista de
# origenes que ya usa CORS, no ALLOWED_HOSTS (que describe al propio backend).
application = ProtocolTypeRouter({
    "http": get_asgi_application(),
    "websocket": OriginValidator(
        URLRouter(websocket_urlpatterns),
        settings.CORS_ALLOWED_ORIGINS if settings.CORS_ALLOWED_ORIGINS else ["*"],
    ),
})
