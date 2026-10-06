from django.db import transaction
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView
from boldApp.core.avatar import validate_avatar
from .services import record_event


class ProfileSerializer(serializers.Serializer):
    banner_color = serializers.RegexField(regex=r"^#[0-9a-fA-F]{6}\Z", max_length=7, trim_whitespace=False, required=False)
    name = serializers.CharField(max_length=140, required=False)
    biography = serializers.CharField(max_length=500, allow_blank=True, required=False)
    avatar_url = serializers.CharField(max_length=410000, allow_null=True, allow_blank=True, required=False)

    def validate_avatar_url(self, value):
        return validate_avatar(value)

    def validate(self, attrs):
        if set(self.initial_data) - set(self.fields):
            raise serializers.ValidationError("Solo puedes modificar el nombre, foto y color de tu perfil.")
        return attrs


class ProfileView(APIView):
    def get(self, request):
        user = request.user
        return Response({"id": str(user.pk), "name": user.employee.full_name, "email": user.email,
                         "avatar_url": user.avatar_url, "biography": user.biography,
                         "banner_color": user.banner_color, "created_at": user.created_at})

    def patch(self, request):
        data = ProfileSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        user = request.user
        with transaction.atomic():
            if "name" in data.validated_data:
                user.employee.full_name = data.validated_data["name"]
                user.employee.save(update_fields=["full_name", "updated_at"])
            fields = [field for field in ("avatar_url", "biography", "banner_color") if field in data.validated_data]
            for field in fields:
                setattr(user, field, data.validated_data[field])
            if fields:
                user.save(update_fields=[*fields, "updated_at"])
            record_event("profile.updated", request=request, user=user)
        return self.get(request)
