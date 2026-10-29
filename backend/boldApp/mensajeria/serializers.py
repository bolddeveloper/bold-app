from rest_framework import serializers
from rest_framework.exceptions import APIException


class StrictInputSerializer(serializers.Serializer):
    def to_internal_value(self, data):
        if isinstance(data, dict):
            unknown = set(data) - set(self.fields)
            if unknown:
                raise serializers.ValidationError({key: "Este campo no se puede modificar." for key in sorted(unknown)})
        return super().to_internal_value(data)


class OpenConversationSerializer(StrictInputSerializer):
    employee_id = serializers.UUIDField()


class DirectFileRetired(APIException):
    status_code = 409
    default_detail = 'Actualiza BOLD para enviar adjuntos mediante la preparación privada. Conserva el borrador y su intento original; no vuelvas a enviarlo como un mensaje nuevo.'
    default_code = 'upload_staging_required'


class StagedMessageInput(StrictInputSerializer):
    def to_internal_value(self, data):
        # Even a stale PWA must not run Google I/O inside message publication.
        # A conflict preserves its immutable attempt; the updated client can
        # reconcile that nonce with an already published message before retrying.
        if isinstance(data,dict) and 'file' in data:
            raise DirectFileRetired()
        return super().to_internal_value(data)


class SendMessageSerializer(StagedMessageInput):
    body = serializers.CharField(max_length=5000, allow_blank=True, trim_whitespace=True)
    client_id = serializers.UUIDField()
    upload_id = serializers.UUIDField(required=False, allow_null=True, default=None)

    def validate(self, data):
        if not data["body"] and not data['upload_id']:
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
