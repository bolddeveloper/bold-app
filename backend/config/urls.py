"""Enrutador principal del proyecto boldApp."""

from django.contrib import admin
from django.urls import include, path

from boldApp.core.health import health
from boldApp.workspace.google_config import ConfigurationView, VerifyView
from boldApp.workspace.image_views import ImageStorageConfigurationView, ImageStorageFoldersView, StoredImageView, WorkspaceImageDocumentView


# Define las rutas raiz: admin de Django y la API de cada modulo de boldApp.
# El nucleo (organigrama y seguridad) vive en api/core/; tareas mantiene su
# prefijo api/ actual hasta que se reescriba para integrarse con el nucleo.
urlpatterns = [
    path("api/v2/google/image-storage/", ImageStorageConfigurationView.as_view()),
    path("api/v2/google/image-storage/folders/", ImageStorageFoldersView.as_view()),
    path("api/v2/media/workspace-description/", WorkspaceImageDocumentView.as_view()),
    path("api/v2/media/images/<uuid:identity>/", StoredImageView.as_view()),
    path("api/v2/google/configuration/", ConfigurationView.as_view()),
    path("api/v2/google/configuration/verify/", VerifyView.as_view()),
    path("api/v2/workspace/", include("boldApp.workspace.urls")),
    path("health/", health, name="health"),
    path("admin/", admin.site.urls),
    path("api/v2/auth/", include("boldApp.autenticacion.urls")),
    path("api/v2/administration/", include("boldApp.administrativo.urls")),
    path("api/v2/permissions/", include("boldApp.permisos.urls")),
    path("api/v2/core/", include("boldApp.core.urls")),
    path("api/v2/notifications/", include("boldApp.notificaciones.urls")),
    path("api/v2/suggestions/", include("boldApp.sugerencias.urls")),
    path("api/v2/", include("boldApp.tareas.urls")),
    path("api/v2/calendar/", include("boldApp.calendario.urls")),
]
