import base64
import binascii
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView

EVENT_TYPES = (
    "task.assigned", "task.collaborator_added", "task.updated", "task.status_changed", "task.due_changed",
    "project.created", "project.assigned", "project.member_added", "project.updated",
    "comment.created", "comment.mentioned",
    "calendar.meeting_reminder",
)
DEFAULTS = {"enabled": True, "sound": "post", "volume": 60, "custom_audio": "", "custom_name": "", "desktop_enabled": False,
            "events": dict.fromkeys(EVENT_TYPES, True)}


def event_preferences(settings):
    return {**DEFAULTS["events"], **(settings or {}).get("events", {})}

class NotificationSettingsSerializer(serializers.Serializer):
    events = serializers.DictField(child=serializers.BooleanField(), required=False)
    enabled = serializers.BooleanField(required=False)
    desktop_enabled = serializers.BooleanField(required=False)
    sound = serializers.ChoiceField(choices=["samsung", "post", "melody", "delivered", "facebook", "custom"], required=False)
    volume = serializers.IntegerField(min_value=0, max_value=100, required=False)
    custom_name = serializers.CharField(max_length=120, allow_blank=True, required=False)
    custom_audio = serializers.CharField(max_length=700000, allow_blank=True, required=False)

    def validate_events(self, value):
        if set(value) - set(EVENT_TYPES):
            raise serializers.ValidationError("Tipo de evento desconocido.")
        return value

    def validate_custom_audio(self, value):
        if not value:
            return value
        try:
            header, encoded = value.split(",", 1)
            if header not in ["data:audio/mpeg;base64", "data:audio/wav;base64", "data:audio/ogg;base64"]:
                raise ValueError()
            data = base64.b64decode(encoded, validate=True)
            valid = (header.startswith("data:audio/mpeg") and (data.startswith(b"ID3") or len(data) > 1 and data[0] == 255 and data[1] & 224 == 224)
                     or header.startswith("data:audio/wav") and data.startswith(b"RIFF") and data[8:12] == b"WAVE"
                     or header.startswith("data:audio/ogg") and data.startswith(b"OggS"))
            if not valid or not data or len(data) > 500 * 1024:
                raise ValueError()
        except (ValueError, binascii.Error):
            raise serializers.ValidationError("Sube un archivo MP3, WAV u OGG válido de hasta 500 KB.")
        return value

    def validate(self, attrs):
        if set(self.initial_data) - set(self.fields):
            raise serializers.ValidationError("Preferencia de notificación inválida.")
        settings = {**DEFAULTS, **self.context["existing"], **attrs}
        settings["events"] = {**event_preferences(self.context["existing"]), **attrs.get("events", {})}
        if settings["sound"] == "custom" and not settings["custom_audio"]:
            raise serializers.ValidationError("Sube un sonido antes de seleccionar Personalizado.")
        if settings["sound"] in ["soft", "bell", "double"]:
            settings["sound"] = DEFAULTS["sound"]
        return settings

class NotificationSettingsView(APIView):
    def get(self, request):
        settings = {**DEFAULTS, **request.user.notification_settings}
        settings["events"] = event_preferences(request.user.notification_settings)
        if settings["sound"] in ["soft", "bell", "double"]:
            settings["sound"] = DEFAULTS["sound"]
        return Response(settings)

    def patch(self, request):
        serializer = NotificationSettingsSerializer(data=request.data, context={"existing": request.user.notification_settings})
        serializer.is_valid(raise_exception=True)
        request.user.notification_settings = serializer.validated_data
        request.user.save(update_fields=["notification_settings", "updated_at"])
        return Response(serializer.validated_data)
