from django.urls import path

from .views import ConnectionsView, consent


urlpatterns = [
    path("consent/", consent, name="mcp-consent"),
    path("connections/", ConnectionsView.as_view(), name="mcp-connections"),
    path("connections/<uuid:authorization_id>/", ConnectionsView.as_view(), name="mcp-revoke-connection"),
]
