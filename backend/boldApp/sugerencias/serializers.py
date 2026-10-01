from rest_framework import serializers

from .models import Suggestion


class SuggestionSerializer(serializers.ModelSerializer):
    author_name = serializers.CharField(source="author_assignment.employee.full_name", read_only=True)
    unit_name = serializers.CharField(source="unit.name", read_only=True)
    reviewed_by_name = serializers.CharField(source="reviewed_by_assignment.employee.full_name", read_only=True)

    class Meta:
        model = Suggestion
        fields = [
            "id", "author_assignment", "author_name", "unit", "unit_name",
            "category", "message", "source_module", "source_view", "status",
            "internal_note", "reviewed_by_assignment", "reviewed_by_name",
            "reviewed_at", "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "author_assignment", "unit", "status", "internal_note",
            "reviewed_by_assignment", "reviewed_at", "created_at", "updated_at",
        ]

    def validate_message(self, value):
        value = " ".join(value.split())
        if len(value) < 10:
            raise serializers.ValidationError("Describe la sugerencia con al menos 10 caracteres.")
        return value

    def validate_source_module(self, value):
        return value.strip().lower()


class SuggestionReviewSerializer(serializers.ModelSerializer):
    class Meta:
        model = Suggestion
        fields = ["status", "internal_note"]

    def validate_internal_note(self, value):
        return value.strip()


class SuggestionAuthorUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Suggestion
        fields = ["category", "message", "source_module", "source_view"]

    def validate_message(self, value):
        value = " ".join(value.split())
        if len(value) < 10:
            raise serializers.ValidationError("Describe la sugerencia con al menos 10 caracteres.")
        return value

    def validate_source_module(self, value):
        return value.strip().lower()
