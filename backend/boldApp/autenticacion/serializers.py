from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

from .services import normalize_email


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(trim_whitespace=False, max_length=1024)

    def validate_email(self, value):
        try:
            return normalize_email(value)
        except ValueError as error:
            raise serializers.ValidationError(str(error)) from error


class MFAVerifySerializer(serializers.Serializer):
    challenge = serializers.CharField(max_length=200)
    code = serializers.CharField(max_length=40)


class PasswordSerializer(serializers.Serializer):
    password = serializers.CharField(trim_whitespace=False, max_length=1024)

    def validate_password(self, value):
        validate_password(value, self.context.get("user"))
        return value


class PasswordChangeSerializer(PasswordSerializer):
    current_password = serializers.CharField(trim_whitespace=False, max_length=1024)


class RecoveryRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()


class RecoveryConfirmSerializer(PasswordSerializer):
    token = serializers.CharField(max_length=200)


class TOTPConfirmSerializer(serializers.Serializer):
    method_id = serializers.UUIDField()
    code = serializers.CharField(max_length=10)


class MFADisableSerializer(serializers.Serializer):
    current_password = serializers.CharField(trim_whitespace=False, max_length=1024)
    code = serializers.CharField(max_length=40)


class WebSocketTicketSerializer(serializers.Serializer):
    assignment = serializers.UUIDField(required=False, allow_null=True)
    unit = serializers.UUIDField(required=False, allow_null=True)
    channel = serializers.ChoiceField(choices=["tasks", "core"], default="tasks")
