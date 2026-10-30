from rest_framework.routers import DefaultRouter
from django.urls import path

from .views import NotificationViewSet
from .push_views import PushConfigView, PushDeviceView, PushResolveView


router = DefaultRouter()
router.register(r"", NotificationViewSet, basename="notification")
urlpatterns = [
    path("push/config/", PushConfigView.as_view()),
    path("push/devices/", PushDeviceView.as_view()),
    path("push/devices/<uuid:device_id>/", PushDeviceView.as_view()),
    path("push/resolve/", PushResolveView.as_view()),
] + router.urls
