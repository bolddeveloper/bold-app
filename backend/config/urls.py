"""Enrutador principal del proyecto boldApp."""

from django.contrib import admin
from django.urls import include, path


# Define las rutas raiz: admin de Django y la API del modulo boldApp.
urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("boldApp.urls")),
]
