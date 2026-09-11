import base64
import binascii

from django.db import transaction
from rest_framework import serializers

from boldApp.core.models import OrganizationalUnit, PositionAssignment

from .models import (
    ActivityLog,
    Attachment,
    Comment,
    Notification,
    Project,
    ProjectMember,
    Section,
    Tag,
    Task,
    TaskDependency,
    TaskFollower,
    TaskProject,
    TaskStatus,
    TaskTag,
    WebhookDelivery,
    WebhookEndpoint,
)
from .webhook_events import EVENT_TYPE_CHOICES


def validate_active_assignment(assignment, field_name="assignment"):
    if assignment and (not assignment.is_active or assignment.released_at is not None):
        raise serializers.ValidationError({field_name: "La asignacion debe estar activa."})


class ProjectSerializer(serializers.ModelSerializer):
    class Meta:
        model = Project
        fields = "__all__"
        read_only_fields = ["created_by_assignment", "created_at", "updated_at", "deleted_at"]
        validators = []

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("El nombre del proyecto es obligatorio.")
        return value

    def validate_avatar_data_url(self, value):
        if not value:
            return None
        prefix = "data:image/webp;base64,"
        if not value.startswith(prefix):
            raise serializers.ValidationError("La imagen del proyecto debe ser WebP.")
        try:
            decoded = base64.b64decode(value[len(prefix):], validate=True)
        except (ValueError, binascii.Error):
            raise serializers.ValidationError("La imagen del proyecto no contiene Base64 válido.")
        if len(decoded) > 300 * 1024:
            raise serializers.ValidationError("La imagen del proyecto no puede superar 300 KB.")
        if not decoded.startswith(b"RIFF") or decoded[8:12] != b"WEBP":
            raise serializers.ValidationError("El contenido enviado no es una imagen WebP válida.")
        return value

    def validate(self, attrs):
        unit = attrs.get("unit") or getattr(self.instance, "unit", None)
        owner = attrs.get("owner_assignment") or getattr(self.instance, "owner_assignment", None)
        validate_active_assignment(owner, "owner_assignment")
        if unit and owner and owner.position.unit_id != unit.id:
            raise serializers.ValidationError(
                {"owner_assignment": "La asignacion propietaria debe pertenecer a la unidad del proyecto."}
            )
        start_date = attrs.get("start_date", getattr(self.instance, "start_date", None))
        end_date = attrs.get("end_date", getattr(self.instance, "end_date", None))
        if start_date and end_date and start_date > end_date:
            raise serializers.ValidationError({"end_date": "La fecha final no puede ser anterior a la fecha inicial."})
        name = attrs.get("name", getattr(self.instance, "name", None))
        if self.instance and unit and name and Project.objects.filter(unit=unit, name=name).exclude(pk=self.instance.pk).exists():
            raise serializers.ValidationError({"name": "Ya existe un proyecto con este nombre en el departamento."})
        return attrs

    def create(self, validated_data):
        base_name = validated_data["name"]
        unit = validated_data["unit"]
        names = set(Project.objects.filter(unit=unit).values_list("name", flat=True))
        if base_name in names:
            suffix = 2
            candidate = ""
            while not candidate or candidate in names:
                marker = f" ({suffix})"
                candidate = f"{base_name[:180 - len(marker)]}{marker}"
                suffix += 1
            validated_data["name"] = candidate
        return super().create(validated_data)


class ProjectMemberSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProjectMember
        fields = "__all__"
        read_only_fields = ["added_by_assignment", "joined_at"]

    def validate_assignment(self, value):
        validate_active_assignment(value)
        return value


class SectionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Section
        fields = "__all__"
        read_only_fields = ["created_at", "updated_at"]


class TaskStatusSerializer(serializers.ModelSerializer):
    class Meta:
        model = TaskStatus
        fields = "__all__"
        read_only_fields = ["created_at"]


class TaskSerializer(serializers.ModelSerializer):
    project = serializers.PrimaryKeyRelatedField(
        queryset=Project.objects.all(),
        write_only=True,
        required=False,
    )
    section = serializers.PrimaryKeyRelatedField(
        queryset=Section.objects.all(),
        write_only=True,
        required=False,
        allow_null=True,
    )
    project_position = serializers.DecimalField(
        max_digits=20,
        decimal_places=10,
        write_only=True,
        required=False,
        default=0,
    )

    class Meta:
        model = Task
        fields = "__all__"
        read_only_fields = ["created_by_assignment", "created_at", "updated_at", "deleted_at"]

    def validate_title(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("El titulo de la tarea es obligatorio.")
        return value

    def validate(self, attrs):
        unit = attrs.get("unit") or getattr(self.instance, "unit", None)
        status = attrs.get("status") or getattr(self.instance, "status", None)
        assignee = attrs.get("assignee_assignment", serializers.empty)
        if assignee is serializers.empty:
            assignee = getattr(self.instance, "assignee_assignment", None)

        if unit and status and status.unit_id is not None and status.unit_id != unit.id:
            raise serializers.ValidationError({"status": "El estado no pertenece a la unidad responsable."})
        if assignee:
            validate_active_assignment(assignee, "assignee_assignment")
            if unit and assignee.position.unit_id != unit.id:
                raise serializers.ValidationError(
                    {"assignee_assignment": "La asignacion responsable debe pertenecer a la unidad de la tarea."}
                )

        project = attrs.get("project")
        section = attrs.get("section")
        if section and not project:
            raise serializers.ValidationError({"section": "section requiere project en la misma operacion."})
        if section and section.project_id != project.id:
            raise serializers.ValidationError({"section": "La seccion no pertenece al proyecto indicado."})
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        project = validated_data.pop("project", None)
        section = validated_data.pop("section", None)
        position = validated_data.pop("project_position", 0)
        assignment = self.context["request"].assignment
        task = Task.objects.create(created_by_assignment=assignment, **validated_data)
        if project:
            TaskProject.objects.create(
                task=task,
                project=project,
                section=section,
                position=position,
                added_by_assignment=assignment,
            )
        return task


class TaskProjectSerializer(serializers.ModelSerializer):
    class Meta:
        model = TaskProject
        fields = "__all__"
        read_only_fields = ["added_by_assignment", "added_at"]

    def validate(self, attrs):
        project = attrs.get("project") or getattr(self.instance, "project", None)
        section = attrs.get("section", serializers.empty)
        if section is serializers.empty:
            section = getattr(self.instance, "section", None)
        if section and project and section.project_id != project.id:
            raise serializers.ValidationError({"section": "La seccion no pertenece al proyecto indicado."})
        return attrs


class TaskDependencySerializer(serializers.ModelSerializer):
    class Meta:
        model = TaskDependency
        fields = "__all__"
        read_only_fields = ["created_by_assignment", "created_at"]


class CommentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Comment
        fields = "__all__"
        read_only_fields = ["author_assignment", "created_at", "updated_at", "deleted_at"]


class AttachmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Attachment
        fields = "__all__"
        read_only_fields = ["uploaded_by_assignment", "created_at", "deleted_at"]


class TaskFollowerSerializer(serializers.ModelSerializer):
    class Meta:
        model = TaskFollower
        fields = "__all__"
        read_only_fields = ["added_by_assignment", "followed_at"]

    def validate_assignment(self, value):
        validate_active_assignment(value)
        return value


class ActivityLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = ActivityLog
        fields = "__all__"
        read_only_fields = ["actor_assignment", "created_at"]


class TagSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tag
        fields = "__all__"
        read_only_fields = ["created_at", "updated_at"]


class TaskTagSerializer(serializers.ModelSerializer):
    class Meta:
        model = TaskTag
        fields = "__all__"
        read_only_fields = ["added_by_assignment", "added_at"]

    def validate(self, attrs):
        task = attrs.get("task") or getattr(self.instance, "task", None)
        tag = attrs.get("tag") or getattr(self.instance, "tag", None)
        if task and tag and task.unit_id != tag.unit_id:
            raise serializers.ValidationError({"tag": "La etiqueta no pertenece a la unidad responsable."})
        return attrs


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = "__all__"
        read_only_fields = ["created_at"]


class WebhookEndpointSerializer(serializers.ModelSerializer):
    class Meta:
        model = WebhookEndpoint
        fields = [
            "id",
            "unit",
            "target_url",
            "secret",
            "event_types",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "secret", "created_at", "updated_at"]

    def validate_event_types(self, value):
        invalid_types = set(value) - set(EVENT_TYPE_CHOICES)
        if invalid_types:
            raise serializers.ValidationError(
                f"Tipos de evento no reconocidos: {', '.join(sorted(invalid_types))}"
            )
        return value

    def to_representation(self, instance):
        data = super().to_representation(instance)
        view = self.context.get("view")
        if getattr(view, "action", None) != "create":
            data.pop("secret", None)
        return data


class WebhookDeliverySerializer(serializers.ModelSerializer):
    class Meta:
        model = WebhookDelivery
        fields = "__all__"


class TaskMoveSerializer(serializers.Serializer):
    unit = serializers.PrimaryKeyRelatedField(queryset=OrganizationalUnit.objects.all())
    assignee_assignment = serializers.PrimaryKeyRelatedField(
        queryset=PositionAssignment.objects.select_related("position__unit"),
        allow_null=True,
        required=True,
    )
    status = serializers.PrimaryKeyRelatedField(queryset=TaskStatus.objects.all())
    project = serializers.PrimaryKeyRelatedField(queryset=Project.objects.all(), required=False)
    section = serializers.PrimaryKeyRelatedField(
        queryset=Section.objects.all(),
        allow_null=True,
        required=False,
    )
    position = serializers.DecimalField(max_digits=20, decimal_places=10, required=False, default=0)

    def validate(self, attrs):
        unit = attrs["unit"]
        status = attrs["status"]
        assignee = attrs.get("assignee_assignment")
        project = attrs.get("project")
        section = attrs.get("section")
        if status.unit_id is not None and status.unit_id != unit.id:
            raise serializers.ValidationError({"status": "El estado no pertenece a la nueva unidad."})
        if assignee:
            validate_active_assignment(assignee, "assignee_assignment")
            if assignee.position.unit_id != unit.id:
                raise serializers.ValidationError(
                    {"assignee_assignment": "La asignacion no pertenece a la nueva unidad."}
                )
        if section and not project:
            raise serializers.ValidationError({"section": "section requiere project."})
        if section and section.project_id != project.id:
            raise serializers.ValidationError({"section": "La seccion no pertenece al proyecto indicado."})
        return attrs
