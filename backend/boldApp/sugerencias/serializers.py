from html import unescape

from django.utils.html import strip_tags
from rest_framework import serializers

from .models import Suggestion
from .screenshots import ScreenshotsField
from boldApp.workspace.image_storage import DriveImagesMixin


def validate_message(value):
    value = value.strip()
    text = unescape(strip_tags(value.removeprefix("<!--bold-rich-text-->"))) if value.startswith("<!--bold-rich-text-->") else value
    if len(text.strip()) < 10:
        raise serializers.ValidationError("Describe la sugerencia con al menos 10 caracteres.")
    if len(text) > 2000:
        raise serializers.ValidationError("La descripción no puede superar 2.000 caracteres de texto.")
    return value


class SuggestionSerializer(DriveImagesMixin, serializers.ModelSerializer):
    message = serializers.CharField(max_length=2_000_000)
    screenshots = ScreenshotsField(required=False)
    can_manage = serializers.SerializerMethodField()
    author_name = serializers.CharField(source="author_assignment.employee.full_name", read_only=True)
    unit_name = serializers.CharField(source="unit.name", read_only=True)
    reviewed_by_name = serializers.CharField(source="reviewed_by_assignment.employee.full_name", read_only=True)

    class Meta:
        model = Suggestion
        fields = [
            "id", "author_assignment", "author_name", "unit", "unit_name",
            "category", "message", "source_module", "source_view", "status",
            "title", "priority", "environment", "screenshots", "can_manage",
            "internal_note", "reviewed_by_assignment", "reviewed_by_name",
            "reviewed_at", "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "author_assignment", "unit", "status", "internal_note",
            "reviewed_by_assignment", "reviewed_at", "created_at", "updated_at",
        ]

    def validate_message(self, value):
        return validate_message(value)

    def validate_source_module(self, value):
        return value.strip().lower()

    def get_can_manage(self, suggestion):
        view = self.context.get("view")
        return bool(view and view._can("suggestions.feedback.manage", suggestion.unit, suggestion.id))

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if not data["can_manage"]:
            data.pop("internal_note", None)
        return data


class SuggestionReviewSerializer(DriveImagesMixin, serializers.ModelSerializer):
    internal_note = serializers.CharField(max_length=2_000_000, allow_blank=True, required=False)
    class Meta:
        model = Suggestion
        fields = ["status", "internal_note", "priority"]

    def validate_internal_note(self, value):
        if len(unescape(strip_tags(value))) > 2000:
            raise serializers.ValidationError("El seguimiento no puede superar 2.000 caracteres de texto.")
        return value.strip()


class SuggestionAuthorUpdateSerializer(DriveImagesMixin, serializers.ModelSerializer):
    message = serializers.CharField(max_length=2_000_000)
    screenshots = ScreenshotsField(required=False)
    class Meta:
        model = Suggestion
        fields = ["category", "message", "source_module", "source_view", "title", "priority", "environment", "screenshots"]

    def validate_message(self, value):
        return validate_message(value)

    def validate_source_module(self, value):
        return value.strip().lower()
