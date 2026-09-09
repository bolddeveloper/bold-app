"""Enrutador principal del proyecto boldApp."""

from django.contrib import admin
from django.urls import include, path


# Define las rutas raiz: admin de Django y la API de cada modulo de boldApp.
# El nucleo (organigrama y seguridad) vive en api/core/; tareas mantiene su
# prefijo api/ actual hasta que se reescriba para integrarse con el nucleo.
urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v2/core/", include("boldApp.core.urls")),
    path("api/v2/", include("boldApp.tareas.urls")),
]
