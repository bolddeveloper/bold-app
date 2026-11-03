from django.db import transaction
from rest_framework import serializers
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from boldApp.core.models import UserAccount


class InterfaceSettingsSerializer(serializers.Serializer):
    theme = serializers.ChoiceField(choices=["light", "dark"], required=False)
    onboarding_step = serializers.ChoiceField(choices=["theme", "google"], required=False)
    onboarding_completed = serializers.BooleanField(required=False)
    slack_server_order = serializers.ListField(child=serializers.RegexField(
        regex=r'^(independent|(?:server:)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$',
        max_length=43), max_length=500, required=False)

    def validate_slack_server_order(self, value):
        if len(value)!=len(set(value)):
            raise serializers.ValidationError('Un servidor no puede aparecer dos veces.')
        return value

    def validate(self, attrs):
        if set(self.initial_data) - set(self.fields):
            raise serializers.ValidationError("Preferencia desconocida.")
        return attrs


class InterfaceSettingsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({"onboarding_completed": False, "onboarding_step": "theme", **request.user.interface_settings})

    def patch(self, request):
        serializer = InterfaceSettingsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            account = UserAccount.objects.select_for_update().get(pk=request.user.pk)
            account.interface_settings = {**account.interface_settings, **serializer.validated_data}
            account.save(update_fields=["interface_settings", "updated_at"])
        return Response({"onboarding_completed": False, "onboarding_step": "theme", **account.interface_settings})
