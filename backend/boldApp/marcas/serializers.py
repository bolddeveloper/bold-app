from rest_framework import serializers
from boldApp.core.avatar import validate_avatar
from .models import Brand


class BrandDetailsSerializer(serializers.Serializer):
    client_name = serializers.CharField(max_length=160, allow_blank=True, required=False, default="")
    client_role = serializers.CharField(max_length=120, allow_blank=True, required=False, default="")
    client_email = serializers.EmailField(allow_blank=True, required=False, default="")
    client_phone = serializers.CharField(max_length=50, allow_blank=True, required=False, default="")
    communication = serializers.CharField(max_length=500, allow_blank=True, required=False, default="")
    paid_ads = serializers.BooleanField(required=False, default=False)
    budget = serializers.CharField(max_length=120, allow_blank=True, required=False, default="")
    audiovisual = serializers.BooleanField(required=False, default=False)
    designer = serializers.CharField(max_length=160, allow_blank=True, required=False, default="")
    trafficker = serializers.CharField(max_length=160, allow_blank=True, required=False, default="")
    notes = serializers.CharField(max_length=3000, allow_blank=True, required=False, default="")
    extra = serializers.DictField(child=serializers.CharField(max_length=500, allow_blank=True), required=False, default=dict)

    def validate_extra(self, value):
        if len(value) > 20 or any(not key.strip() or len(key) > 80 for key in value):
            raise serializers.ValidationError("Máximo 20 características, con títulos de hasta 80 caracteres.")
        return value


class BrandSerializer(serializers.ModelSerializer):
    details = BrandDetailsSerializer(required=False)
    project_ids = serializers.ListField(child=serializers.UUIDField(), max_length=500, required=False)
    task_ids = serializers.ListField(child=serializers.UUIDField(), max_length=1000, required=False)
    revision = serializers.IntegerField(min_value=1, required=False)
    member_ids = serializers.SerializerMethodField()
    owner_name = serializers.CharField(source="owner.employee.full_name", read_only=True)
    unit_name = serializers.CharField(source="unit.name", read_only=True)

    class Meta:
        model = Brand
        fields = ["id", "name", "description", "logo", "details", "project_ids", "task_ids", "revision", "owner", "owner_name", "unit", "unit_name", "member_ids", "created_at", "updated_at", "archived_at"]
        read_only_fields = ["owner", "unit", "archived_at", "created_at", "updated_at"]
        extra_kwargs = {"description": {"max_length": 5000}, "logo": {"max_length": 420000}}

    def get_member_ids(self, obj):
        return [str(row.pk) for row in obj.members.all()]

    def validate_logo(self, value):
        return validate_avatar(value, "logo de la marca")

    def validate_details(self, value):
        return {**self.instance.details, **value} if self.instance else value

    def validate(self, values):
        if self.instance and "revision" not in values:
            raise serializers.ValidationError({"revision": "Indica la versión que estás editando."})
        from boldApp.tareas.workspace_library import json_folders, validate_new_links
        if "project_ids" in values or "task_ids" in values:
            folders = json_folders([{"projectIds": values.get("project_ids", self.instance.project_ids if self.instance else []), "taskIds": values.get("task_ids", self.instance.task_ids if self.instance else [])}])
            previous = [{"projectIds": self.instance.project_ids, "taskIds": self.instance.task_ids}] if self.instance else []
            validate_new_links(self.context["request"], folders, previous)
            for field, key in (("project_ids", "projectIds"), ("task_ids", "taskIds")):
                if field in values:
                    values[field] = folders[0][key]
        return values
