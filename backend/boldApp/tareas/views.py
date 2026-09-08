from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

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
    WebhookDelivery,
    WebhookEndpoint,
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
    WebhookDeliverySerializer,
    WebhookEndpointSerializer,
    WorkspaceMemberSerializer,
    WorkspaceSerializer,
)
from .webhook_events import WEBHOOK_TEST, build_event_envelope
from .webhook_tasks import deliver_webhook


# Define un mixin que convierte el DELETE de un ModelViewSet en borrado
# logico (deleted_at = ahora) en vez de eliminar la fila, para los modelos
# que heredan SoftDeleteModel. Asi el evento task.deleted (y equivalentes)
# refleja un estado real y consultable, no una fila que ya no existe.
class SoftDeleteViewSetMixin:

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        instance.deleted_at = timezone.now()
        instance.save()
        return Response(status=status.HTTP_204_NO_CONTENT)


# Define el viewset de usuarios.
class UserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.all()
    serializer_class = UserSerializer


# Define los viewsets de workspaces y su tabla puente de miembros.
class WorkspaceViewSet(SoftDeleteViewSetMixin, viewsets.ModelViewSet):
    queryset = Workspace.objects.all()
    serializer_class = WorkspaceSerializer


class WorkspaceMemberViewSet(viewsets.ModelViewSet):
    queryset = WorkspaceMember.objects.all()
    serializer_class = WorkspaceMemberSerializer


# Define los viewsets de proyectos y sus tablas relacionadas.
class ProjectViewSet(SoftDeleteViewSetMixin, viewsets.ModelViewSet):
    queryset = Project.objects.all()
    serializer_class = ProjectSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        workspace_id = self.request.query_params.get("workspace")
        if workspace_id:
            queryset = queryset.filter(workspace_id=workspace_id)
        return queryset


class ProjectMemberViewSet(viewsets.ModelViewSet):
    queryset = ProjectMember.objects.all()
    serializer_class = ProjectMemberSerializer


class SectionViewSet(viewsets.ModelViewSet):
    queryset = Section.objects.all()
    serializer_class = SectionSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        project_id = self.request.query_params.get("project")
        if project_id:
            queryset = queryset.filter(project_id=project_id)
        return queryset


class TaskStatusViewSet(viewsets.ModelViewSet):
    queryset = TaskStatus.objects.all()
    serializer_class = TaskStatusSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        project_id = self.request.query_params.get("project")
        if project_id:
            queryset = queryset.filter(project_id=project_id)
        return queryset


# Define los viewsets de tareas y sus tablas puente.
class TaskViewSet(SoftDeleteViewSetMixin, viewsets.ModelViewSet):
    queryset = Task.objects.all()
    serializer_class = TaskSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        workspace_id = self.request.query_params.get("workspace")
        if workspace_id:
            queryset = queryset.filter(workspace_id=workspace_id)
        return queryset


class TaskProjectViewSet(viewsets.ModelViewSet):
    queryset = TaskProject.objects.all()
    serializer_class = TaskProjectSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        project_id = self.request.query_params.get("project")
        if project_id:
            queryset = queryset.filter(project_id=project_id)
        return queryset


class TaskDependencyViewSet(viewsets.ModelViewSet):
    queryset = TaskDependency.objects.all()
    serializer_class = TaskDependencySerializer


# Define los viewsets de colaboracion: comentarios, adjuntos, seguidores e historial.
class CommentViewSet(SoftDeleteViewSetMixin, viewsets.ModelViewSet):
    queryset = Comment.objects.all()
    serializer_class = CommentSerializer


class AttachmentViewSet(SoftDeleteViewSetMixin, viewsets.ModelViewSet):
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


# Define el viewset de suscriptores de webhooks (registrar/listar/editar/borrar
# URLs que reciben eventos de tareas), con una accion extra para probar la
# entrega sin esperar a que ocurra un evento real.
class WebhookEndpointViewSet(viewsets.ModelViewSet):
    queryset = WebhookEndpoint.objects.all()
    serializer_class = WebhookEndpointSerializer

    @action(detail=True, methods=["post"])
    def test(self, request, pk=None):
        endpoint = self.get_object()
        envelope = build_event_envelope(
            WEBHOOK_TEST,
            "webhook_endpoint",
            endpoint.id,
            {"message": "Evento de prueba enviado desde boldApp."},
        )
        deliver_webhook.delay(str(endpoint.id), envelope)
        return Response({"queued": True, "event_id": envelope["event_id"]}, status=status.HTTP_202_ACCEPTED)


# Define el viewset de solo lectura del log de entregas de webhooks, filtrable
# por endpoint via ?endpoint=<id> para depurar suscriptores puntuales.
class WebhookDeliveryViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = WebhookDelivery.objects.select_related("endpoint").all()
    serializer_class = WebhookDeliverySerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        endpoint_id = self.request.query_params.get("endpoint")
        if endpoint_id:
            queryset = queryset.filter(endpoint_id=endpoint_id)
        return queryset
