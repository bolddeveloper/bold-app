from rest_framework import serializers


class StrictInputSerializer(serializers.Serializer):
    def to_internal_value(self, data):
        if isinstance(data, dict):
            unknown = set(data) - set(self.fields)
            if unknown:
                raise serializers.ValidationError({key: "Este campo no se puede modificar." for key in sorted(unknown)})
        return super().to_internal_value(data)


class OpenConversationSerializer(StrictInputSerializer):
    employee_id = serializers.UUIDField()


class SendMessageSerializer(StrictInputSerializer):
    body = serializers.CharField(max_length=5000, allow_blank=True, trim_whitespace=True)
    client_id = serializers.UUIDField()
    file = serializers.FileField(required=False, max_length=200)

    def validate(self, data):
        if not data["body"] and not data.get("file"):
            raise serializers.ValidationError("Escribe un mensaje o adjunta una imagen o nota de voz.")
        return data


class EditMessageSerializer(StrictInputSerializer):
    body = serializers.CharField(max_length=5000, allow_blank=True, trim_whitespace=True)
    version = serializers.IntegerField(min_value=1)


class ReceiptSerializer(StrictInputSerializer):
    message_ids = serializers.ListField(child=serializers.UUIDField(), min_length=1, max_length=100)
    state = serializers.ChoiceField(choices=["delivered", "read"])


class PreferencesSerializer(StrictInputSerializer):
    enter_behavior = serializers.ChoiceField(choices=["send", "newline"])
