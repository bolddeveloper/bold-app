"""Configuracion ASGI del proyecto boldApp, lista para soporte en tiempo real futuro."""

import os

from django.core.asgi import get_asgi_application


os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

application = get_asgi_application()
