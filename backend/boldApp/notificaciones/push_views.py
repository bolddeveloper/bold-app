from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.cache import never_cache
from rest_framework import serializers
from rest_framework.exceptions import NotAuthenticated, NotFound
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle
from rest_framework.views import APIView

from boldApp.autenticacion.models import AuthSession
from boldApp.autenticacion.notification_settings import DEFAULTS
from boldApp.core.permissions import HasActiveAssignment
from .models import PushDevice, PushDelivery
from .push import PushSubscriptionInput, bind_device, configured, enabled_for, session_valid, visible_notice


class PushThrottle(UserRateThrottle):
    rate = "120/min"


@method_decorator(never_cache, name="dispatch")
class PushView(APIView):
    permission_classes = [HasActiveAssignment]
    throttle_classes = [PushThrottle]

    def active_session(self):
        if not isinstance(self.request.auth, AuthSession) or not session_valid(self.request.auth, self.request.assignment):
            raise NotAuthenticated("Inicia sesión para configurar este dispositivo.")
        return self.request.auth


class PushConfigView(PushView):
    def get(self, request):
        self.active_session()
        return Response({"enabled": configured(), "public_key": settings_public_key()})


def settings_public_key():
    from django.conf import settings
    return settings.WEB_PUSH_PUBLIC_KEY if configured() else ""


class PushDeviceView(PushView):
    def post(self, request):
        session = self.active_session()
        if not configured():
            raise serializers.ValidationError("Las notificaciones en segundo plano aún no están configuradas.")
        form = PushSubscriptionInput(data=request.data)
        form.is_valid(raise_exception=True)
        device = bind_device(session, request.assignment, form.validated_data)
        return Response({"device_id": str(device.pk), "binding": str(device.binding), "assignment_id": str(device.assignment_id)})

    def delete(self, request, device_id):
        session = self.active_session()
        PushDevice.objects.filter(pk=device_id, session=session, assignment=request.assignment).update(revoked_at=timezone.now())
        return Response(status=204)


class PushResolveInput(serializers.Serializer):
    device_id = serializers.UUIDField()
    notification_id = serializers.UUIDField()
    binding = serializers.UUIDField()


class PushResolveView(PushView):
    def get(self, request):
        session = self.active_session()
        form = PushResolveInput(data=request.query_params)
        form.is_valid(raise_exception=True)
        values = form.validated_data
        if not configured() or not PushDevice.objects.filter(pk=values["device_id"], binding=values["binding"],
                session=session, assignment=request.assignment, revoked_at__isnull=True).exists():
            raise NotFound()
        if not PushDelivery.objects.filter(device_id=values["device_id"], binding=values["binding"],
                notification_id=values["notification_id"], expires_at__gt=timezone.now()).exists():
            raise NotFound()
        notice = visible_notice(request, values["notification_id"])
        if not notice or not enabled_for(request.user, notice):
            raise NotFound()
        prefs = {**DEFAULTS, **request.user.notification_settings}
        # Generic content only, even after authorization. Lock-screen privacy is default.
        return Response({"allowed": True, "actor_is_owner": notice.metadata.get("actor_is_owner") is True,
            "sound": bool(prefs["enabled"] and prefs["volume"] > 0)})
