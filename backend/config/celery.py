"""
Bootstrap de Celery para el proyecto boldApp.

Sigue la convencion oficial de Django+Celery: este modulo crea la instancia
de la app de Celery y la registra en config/__init__.py para que el
decorador @shared_task funcione en cualquier modulo de boldApp.
"""

import os

from celery import Celery


os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

app = Celery("boldapp")


# Define que Celery lea su configuracion desde settings.py (prefijo CELERY_).
app.config_from_object("django.conf:settings", namespace="CELERY")


# Define el autodescubrimiento de tareas (@shared_task) en las apps instaladas.
app.autodiscover_tasks()
