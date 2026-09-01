from rest_framework import viewsets

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
from .serializers import (
    ActivityLogSerializer,
    AttachmentSerializer,
    CommentSerializer,
    NotificationSerializer,
    ProjectMemberSerializer,
    ProjectSerializer,
    SectionSerializer,
    TagSerializer,
    TaskDependencySerializer,
    TaskFollowerSerializer,
    TaskProjectSerializer,
    TaskSerializer,
    TaskStatusSerializer,
    TaskTagSerializer,
    UserSerializer,
    WorkspaceMemberSerializer,
    WorkspaceSerializer,
)


# Define el viewset de usuarios.
class UserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.all()
    serializer_class = UserSerializer


# Define los viewsets de workspaces y su tabla puente de miembros.
class WorkspaceViewSet(viewsets.ModelViewSet):
    queryset = Workspace.objects.all()
    serializer_class = WorkspaceSerializer


class WorkspaceMemberViewSet(viewsets.ModelViewSet):
    queryset = WorkspaceMember.objects.all()
    serializer_class = WorkspaceMemberSerializer


# Define los viewsets de proyectos y sus tablas relacionadas.
class ProjectViewSet(viewsets.ModelViewSet):
    queryset = Project.objects.all()
    serializer_class = ProjectSerializer


class ProjectMemberViewSet(viewsets.ModelViewSet):
    queryset = ProjectMember.objects.all()
    serializer_class = ProjectMemberSerializer


class SectionViewSet(viewsets.ModelViewSet):
    queryset = Section.objects.all()
    serializer_class = SectionSerializer


class TaskStatusViewSet(viewsets.ModelViewSet):
    queryset = TaskStatus.objects.all()
    serializer_class = TaskStatusSerializer


# Define los viewsets de tareas y sus tablas puente.
class TaskViewSet(viewsets.ModelViewSet):
    queryset = Task.objects.all()
    serializer_class = TaskSerializer


class TaskProjectViewSet(viewsets.ModelViewSet):
    queryset = TaskProject.objects.all()
    serializer_class = TaskProjectSerializer


class TaskDependencyViewSet(viewsets.ModelViewSet):
    queryset = TaskDependency.objects.all()
    serializer_class = TaskDependencySerializer


# Define los viewsets de colaboracion: comentarios, adjuntos, seguidores e historial.
class CommentViewSet(viewsets.ModelViewSet):
    queryset = Comment.objects.all()
    serializer_class = CommentSerializer


class AttachmentViewSet(viewsets.ModelViewSet):
    queryset = Attachment.objects.all()
    serializer_class = AttachmentSerializer


class TaskFollowerViewSet(viewsets.ModelViewSet):
    queryset = TaskFollower.objects.all()
    serializer_class = TaskFollowerSerializer


class ActivityLogViewSet(viewsets.ModelViewSet):
    queryset = ActivityLog.objects.all()
    serializer_class = ActivityLogSerializer


# Define los viewsets de etiquetas y notificaciones.
class TagViewSet(viewsets.ModelViewSet):
    queryset = Tag.objects.all()
    serializer_class = TagSerializer


class TaskTagViewSet(viewsets.ModelViewSet):
    queryset = TaskTag.objects.all()
    serializer_class = TaskTagSerializer


class NotificationViewSet(viewsets.ModelViewSet):
    queryset = Notification.objects.all()
    serializer_class = NotificationSerializer
