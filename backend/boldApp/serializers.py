from rest_framework import serializers

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
    User,
    Workspace,
    WorkspaceMember,
)


# Define el serializer de usuarios; la contrasena es de solo escritura y se hashea al crear.
class UserSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, required=False)

    class Meta:
        model = User
        fields = [
            "id",
            "name",
            "email",
            "password",
            "avatar_url",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def create(self, validated_data):
        password = validated_data.pop("password", None)
        user = User(**validated_data)
        user.set_password(password)
        user.save()
        return user


# Define el serializer de workspaces y su tabla puente de miembros.
class WorkspaceSerializer(serializers.ModelSerializer):
    class Meta:
        model = Workspace
        fields = "__all__"


class WorkspaceMemberSerializer(serializers.ModelSerializer):
    class Meta:
        model = WorkspaceMember
        fields = "__all__"


# Define el serializer de proyectos y sus tablas relacionadas (miembros, secciones, estados).
class ProjectSerializer(serializers.ModelSerializer):
    class Meta:
        model = Project
        fields = "__all__"


class ProjectMemberSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProjectMember
        fields = "__all__"


class SectionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Section
        fields = "__all__"


class TaskStatusSerializer(serializers.ModelSerializer):
    class Meta:
        model = TaskStatus
        fields = "__all__"


# Define el serializer de tareas y sus tablas puente (proyectos y dependencias).
class TaskSerializer(serializers.ModelSerializer):
    class Meta:
        model = Task
        fields = "__all__"


class TaskProjectSerializer(serializers.ModelSerializer):
    class Meta:
        model = TaskProject
        fields = "__all__"


class TaskDependencySerializer(serializers.ModelSerializer):
    class Meta:
        model = TaskDependency
        fields = "__all__"


# Define el serializer de colaboracion: comentarios, adjuntos, seguidores e historial.
class CommentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Comment
        fields = "__all__"


class AttachmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Attachment
        fields = "__all__"


class TaskFollowerSerializer(serializers.ModelSerializer):
    class Meta:
        model = TaskFollower
        fields = "__all__"


class ActivityLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = ActivityLog
        fields = "__all__"


# Define el serializer de etiquetas y notificaciones.
class TagSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tag
        fields = "__all__"


class TaskTagSerializer(serializers.ModelSerializer):
    class Meta:
        model = TaskTag
        fields = "__all__"


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = "__all__"
