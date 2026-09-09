from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from boldApp.core.authorization import check_and_log, resolve_access
from boldApp.core.models import OrganizationalUnit, Permission

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
from .permissions import HasActiveAssignment
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
    TaskMoveSerializer,
    TaskProjectSerializer,
    TaskSerializer,
    TaskStatusSerializer,
    TaskTagSerializer,
    WebhookDeliverySerializer,
    WebhookEndpointSerializer,
)
from .webhook_events import WEBHOOK_TEST, build_event_envelope
from .webhook_tasks import deliver_webhook


class AssignmentScopedViewSetMixin:
    permission_classes = [HasActiveAssignment]

    def require_permission(self, code, unit, resource_id=None):
        result = check_and_log(
            employee=self.request.assignment.employee,
            assignment=self.request.assignment,
            permission_code=code,
            target_unit=unit,
            resource_id=resource_id,
        )
        if not result.allowed:
            raise PermissionDenied(result.reason)

    def allowed_unit_ids(self, code):
        try:
            permission = Permission.objects.get(code=code)
        except Permission.DoesNotExist:
            return []
        return [
            unit.id
            for unit in OrganizationalUnit.objects.select_related("parent_unit")
            if resolve_access(self.request.assignment, permission, unit).allowed
        ]

    def visible_tasks(self):
        assignment = self.request.assignment
        return Task.objects.filter(
            Q(unit=assignment.position.unit)
            | Q(created_by_assignment=assignment)
            | Q(assignee_assignment=assignment)
            | Q(
                task_projects__project__members__assignment=assignment,
                task_projects__project__members__status="active",
                task_projects__project__members__removed_at__isnull=True,
            )
        ).distinct()

    def visible_projects(self):
        assignment = self.request.assignment
        return Project.objects.filter(
            Q(unit=assignment.position.unit)
            | Q(owner_assignment=assignment)
            | Q(
                members__assignment=assignment,
                members__status="active",
                members__removed_at__isnull=True,
            )
        ).distinct()


class SoftDeleteViewSetMixin:
    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        instance.deleted_at = timezone.now()
        update_fields = ["deleted_at"]
        if hasattr(instance, "updated_at"):
            update_fields.append("updated_at")
        instance.save(update_fields=update_fields)
        return Response(status=status.HTTP_204_NO_CONTENT)


class ProjectViewSet(AssignmentScopedViewSetMixin, SoftDeleteViewSetMixin, viewsets.ModelViewSet):
    serializer_class = ProjectSerializer

    def get_queryset(self):
        queryset = self.visible_projects()
        unit_id = self.request.query_params.get("unit")
        return queryset.filter(unit_id=unit_id) if unit_id else queryset

    def perform_create(self, serializer):
        self.require_permission("tasks.project.manage", serializer.validated_data["unit"])
        serializer.save(created_by_assignment=self.request.assignment)

    def perform_update(self, serializer):
        project = self.get_object()
        self.require_permission("tasks.project.manage", project.unit, project.id)
        new_unit = serializer.validated_data.get("unit")
        if new_unit and new_unit.id != project.unit_id:
            self.require_permission("tasks.project.manage", new_unit, project.id)
        serializer.save()

    def destroy(self, request, *args, **kwargs):
        project = self.get_object()
        self.require_permission("tasks.project.manage", project.unit, project.id)
        return super().destroy(request, *args, **kwargs)


class ProjectMemberViewSet(AssignmentScopedViewSetMixin, viewsets.ModelViewSet):
    serializer_class = ProjectMemberSerializer

    def get_queryset(self):
        return ProjectMember.objects.filter(project__in=self.visible_projects())

    def perform_create(self, serializer):
        self.require_permission("tasks.project.manage", serializer.validated_data["project"].unit)
        serializer.save(added_by_assignment=self.request.assignment)

    def perform_update(self, serializer):
        member = self.get_object()
        self.require_permission("tasks.project.manage", member.project.unit, member.project_id)
        new_project = serializer.validated_data.get("project")
        if new_project and new_project.id != member.project_id:
            self.require_permission("tasks.project.manage", new_project.unit, new_project.id)
        serializer.save()

    def perform_destroy(self, instance):
        self.require_permission("tasks.project.manage", instance.project.unit, instance.project_id)
        instance.delete()


class SectionViewSet(AssignmentScopedViewSetMixin, viewsets.ModelViewSet):
    serializer_class = SectionSerializer

    def get_queryset(self):
        queryset = Section.objects.filter(project__in=self.visible_projects())
        project_id = self.request.query_params.get("project")
        return queryset.filter(project_id=project_id) if project_id else queryset

    def perform_create(self, serializer):
        self.require_permission("tasks.project.manage", serializer.validated_data["project"].unit)
        serializer.save()

    def perform_update(self, serializer):
        section = self.get_object()
        self.require_permission("tasks.project.manage", section.project.unit, section.project_id)
        new_project = serializer.validated_data.get("project")
        if new_project and new_project.id != section.project_id:
            self.require_permission("tasks.project.manage", new_project.unit, new_project.id)
        serializer.save()

    def perform_destroy(self, instance):
        self.require_permission("tasks.project.manage", instance.project.unit, instance.project_id)
        instance.delete()


class TaskStatusViewSet(AssignmentScopedViewSetMixin, viewsets.ModelViewSet):
    serializer_class = TaskStatusSerializer

    def get_queryset(self):
        unit_id = self.request.query_params.get("unit") or self.request.assignment.position.unit_id
        return TaskStatus.objects.filter(Q(unit_id=unit_id) | Q(unit__isnull=True))

    def perform_create(self, serializer):
        unit = serializer.validated_data.get("unit") or self.request.assignment.position.unit
        self.require_permission("tasks.project.manage", unit)
        serializer.save()

    def _require_status_write(self, task_status):
        if task_status.unit_id is None:
            raise PermissionDenied("Los estados globales solo se administran fuera del flujo de unidades.")
        self.require_permission("tasks.project.manage", task_status.unit, task_status.id)

    def perform_update(self, serializer):
        task_status = self.get_object()
        self._require_status_write(task_status)
        new_unit = serializer.validated_data.get("unit")
        if new_unit and new_unit.id != task_status.unit_id:
            self.require_permission("tasks.project.manage", new_unit, task_status.id)
        serializer.save()

    def perform_destroy(self, instance):
        self._require_status_write(instance)
        instance.delete()


class TaskViewSet(AssignmentScopedViewSetMixin, SoftDeleteViewSetMixin, viewsets.ModelViewSet):
    serializer_class = TaskSerializer

    def get_queryset(self):
        queryset = self.visible_tasks().select_related(
            "unit",
            "status",
            "created_by_assignment",
            "assignee_assignment",
        )
        unit_id = self.request.query_params.get("unit")
        return queryset.filter(unit_id=unit_id) if unit_id else queryset

    def perform_create(self, serializer):
        self.require_permission("tasks.task.create", serializer.validated_data["unit"])
        serializer.save()

    def perform_update(self, serializer):
        task = self.get_object()
        self.require_permission("tasks.task.update", task.unit, task.id)
        new_unit = serializer.validated_data.get("unit")
        if new_unit and new_unit.id != task.unit_id:
            self.require_permission("tasks.task.assign", new_unit, task.id)
        serializer.save()

    def destroy(self, request, *args, **kwargs):
        task = self.get_object()
        self.require_permission("tasks.task.delete", task.unit, task.id)
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=["post"])
    def move(self, request, pk=None):
        task = self.get_object()
        serializer = TaskMoveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        self.require_permission("tasks.task.update", task.unit, task.id)
        self.require_permission("tasks.task.assign", data["unit"], task.id)

        with transaction.atomic():
            task.unit = data["unit"]
            task.status = data["status"]
            task.assignee_assignment = data.get("assignee_assignment")
            task.save(update_fields=["unit", "status", "assignee_assignment", "updated_at"])

            project = data.get("project")
            if project:
                TaskProject.objects.update_or_create(
                    task=task,
                    project=project,
                    defaults={
                        "section": data.get("section"),
                        "position": data["position"],
                        "added_by_assignment": request.assignment,
                    },
                )

        return Response(TaskSerializer(task, context=self.get_serializer_context()).data)


class TaskProjectViewSet(AssignmentScopedViewSetMixin, viewsets.ModelViewSet):
    serializer_class = TaskProjectSerializer

    def get_queryset(self):
        queryset = TaskProject.objects.filter(task__in=self.visible_tasks())
        project_id = self.request.query_params.get("project")
        return queryset.filter(project_id=project_id) if project_id else queryset

    def perform_create(self, serializer):
        task = serializer.validated_data["task"]
        project = serializer.validated_data["project"]
        self.require_permission("tasks.task.update", task.unit, task.id)
        self.require_permission("tasks.project.manage", project.unit, project.id)
        serializer.save(added_by_assignment=self.request.assignment)

    def _require_link_write(self, link):
        self.require_permission("tasks.task.update", link.task.unit, link.task_id)
        self.require_permission("tasks.project.manage", link.project.unit, link.project_id)

    def perform_update(self, serializer):
        link = self.get_object()
        self._require_link_write(link)
        new_task = serializer.validated_data.get("task")
        new_project = serializer.validated_data.get("project")
        if new_task and new_task.id != link.task_id:
            self.require_permission("tasks.task.update", new_task.unit, new_task.id)
        if new_project and new_project.id != link.project_id:
            self.require_permission("tasks.project.manage", new_project.unit, new_project.id)
        serializer.save()

    def perform_destroy(self, instance):
        self._require_link_write(instance)
        instance.delete()


class TaskDependencyViewSet(AssignmentScopedViewSetMixin, viewsets.ModelViewSet):
    serializer_class = TaskDependencySerializer

    def get_queryset(self):
        return TaskDependency.objects.filter(task__in=self.visible_tasks())

    def perform_create(self, serializer):
        task = serializer.validated_data["task"]
        self.require_permission("tasks.task.update", task.unit, task.id)
        serializer.save(created_by_assignment=self.request.assignment)

    def perform_update(self, serializer):
        dependency = self.get_object()
        self.require_permission("tasks.task.update", dependency.task.unit, dependency.task_id)
        new_task = serializer.validated_data.get("task")
        if new_task and new_task.id != dependency.task_id:
            self.require_permission("tasks.task.update", new_task.unit, new_task.id)
        serializer.save()

    def perform_destroy(self, instance):
        self.require_permission("tasks.task.update", instance.task.unit, instance.task_id)
        instance.delete()


class CommentViewSet(AssignmentScopedViewSetMixin, SoftDeleteViewSetMixin, viewsets.ModelViewSet):
    serializer_class = CommentSerializer

    def get_queryset(self):
        return Comment.objects.filter(task__in=self.visible_tasks())

    def perform_create(self, serializer):
        task = serializer.validated_data["task"]
        self.require_permission("tasks.comment.create", task.unit, task.id)
        serializer.save(author_assignment=self.request.assignment)

    def _require_comment_write(self, comment):
        if comment.author_assignment_id != self.request.assignment.id:
            self.require_permission("tasks.task.update", comment.task.unit, comment.task_id)

    def perform_update(self, serializer):
        comment = self.get_object()
        self._require_comment_write(comment)
        new_task = serializer.validated_data.get("task")
        if new_task and new_task.id != comment.task_id:
            self.require_permission("tasks.task.update", new_task.unit, new_task.id)
        serializer.save()

    def destroy(self, request, *args, **kwargs):
        self._require_comment_write(self.get_object())
        return super().destroy(request, *args, **kwargs)


class AttachmentViewSet(AssignmentScopedViewSetMixin, SoftDeleteViewSetMixin, viewsets.ModelViewSet):
    serializer_class = AttachmentSerializer

    def get_queryset(self):
        return Attachment.objects.filter(task__in=self.visible_tasks(), deleted_at__isnull=True)

    def perform_create(self, serializer):
        task = serializer.validated_data["task"]
        self.require_permission("tasks.task.update", task.unit, task.id)
        serializer.save(uploaded_by_assignment=self.request.assignment)

    def perform_update(self, serializer):
        attachment = self.get_object()
        self.require_permission("tasks.task.update", attachment.task.unit, attachment.task_id)
        new_task = serializer.validated_data.get("task")
        if new_task and new_task.id != attachment.task_id:
            self.require_permission("tasks.task.update", new_task.unit, new_task.id)
        serializer.save()

    def destroy(self, request, *args, **kwargs):
        attachment = self.get_object()
        self.require_permission("tasks.task.update", attachment.task.unit, attachment.task_id)
        return super().destroy(request, *args, **kwargs)


class TaskFollowerViewSet(AssignmentScopedViewSetMixin, viewsets.ModelViewSet):
    serializer_class = TaskFollowerSerializer

    def get_queryset(self):
        return TaskFollower.objects.filter(task__in=self.visible_tasks())

    def perform_create(self, serializer):
        task = serializer.validated_data["task"]
        self.require_permission("tasks.task.update", task.unit, task.id)
        serializer.save(added_by_assignment=self.request.assignment)

    def perform_update(self, serializer):
        follower = self.get_object()
        self.require_permission("tasks.task.update", follower.task.unit, follower.task_id)
        new_task = serializer.validated_data.get("task")
        if new_task and new_task.id != follower.task_id:
            self.require_permission("tasks.task.update", new_task.unit, new_task.id)
        serializer.save()

    def perform_destroy(self, instance):
        self.require_permission("tasks.task.update", instance.task.unit, instance.task_id)
        instance.delete()


class ActivityLogViewSet(AssignmentScopedViewSetMixin, viewsets.ReadOnlyModelViewSet):
    serializer_class = ActivityLogSerializer

    def get_queryset(self):
        return ActivityLog.objects.filter(task__in=self.visible_tasks())


class TagViewSet(AssignmentScopedViewSetMixin, viewsets.ModelViewSet):
    serializer_class = TagSerializer

    def get_queryset(self):
        unit_id = self.request.query_params.get("unit") or self.request.assignment.position.unit_id
        return Tag.objects.filter(unit_id=unit_id)

    def perform_create(self, serializer):
        self.require_permission("tasks.project.manage", serializer.validated_data["unit"])
        serializer.save()

    def perform_update(self, serializer):
        tag = self.get_object()
        self.require_permission("tasks.project.manage", tag.unit, tag.id)
        new_unit = serializer.validated_data.get("unit")
        if new_unit and new_unit.id != tag.unit_id:
            self.require_permission("tasks.project.manage", new_unit, tag.id)
        serializer.save()

    def perform_destroy(self, instance):
        self.require_permission("tasks.project.manage", instance.unit, instance.id)
        instance.delete()


class TaskTagViewSet(AssignmentScopedViewSetMixin, viewsets.ModelViewSet):
    serializer_class = TaskTagSerializer

    def get_queryset(self):
        return TaskTag.objects.filter(task__in=self.visible_tasks())

    def perform_create(self, serializer):
        task = serializer.validated_data["task"]
        self.require_permission("tasks.task.update", task.unit, task.id)
        serializer.save(added_by_assignment=self.request.assignment)

    def perform_update(self, serializer):
        task_tag = self.get_object()
        self.require_permission("tasks.task.update", task_tag.task.unit, task_tag.task_id)
        new_task = serializer.validated_data.get("task")
        if new_task and new_task.id != task_tag.task_id:
            self.require_permission("tasks.task.update", new_task.unit, new_task.id)
        serializer.save()

    def perform_destroy(self, instance):
        self.require_permission("tasks.task.update", instance.task.unit, instance.task_id)
        instance.delete()


class NotificationViewSet(AssignmentScopedViewSetMixin, viewsets.ReadOnlyModelViewSet):
    serializer_class = NotificationSerializer

    def get_queryset(self):
        return Notification.objects.filter(recipient_assignment=self.request.assignment)

    @action(detail=True, methods=["post"], url_path="mark-read")
    def mark_read(self, request, pk=None):
        notification = self.get_object()
        notification.is_read = True
        notification.read_at = timezone.now()
        notification.save(update_fields=["is_read", "read_at"])
        return Response(NotificationSerializer(notification).data)


class WebhookEndpointViewSet(AssignmentScopedViewSetMixin, viewsets.ModelViewSet):
    serializer_class = WebhookEndpointSerializer

    def get_queryset(self):
        return WebhookEndpoint.objects.filter(unit_id__in=self.allowed_unit_ids("tasks.webhook.manage"))

    def perform_create(self, serializer):
        self.require_permission("tasks.webhook.manage", serializer.validated_data["unit"])
        serializer.save()

    def perform_update(self, serializer):
        endpoint = self.get_object()
        self.require_permission("tasks.webhook.manage", endpoint.unit, endpoint.id)
        serializer.save()

    def destroy(self, request, *args, **kwargs):
        endpoint = self.get_object()
        self.require_permission("tasks.webhook.manage", endpoint.unit, endpoint.id)
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=["post"])
    def test(self, request, pk=None):
        endpoint = self.get_object()
        self.require_permission("tasks.webhook.manage", endpoint.unit, endpoint.id)
        envelope = build_event_envelope(
            WEBHOOK_TEST,
            "webhook_endpoint",
            endpoint.id,
            {"message": "Evento de prueba enviado desde boldApp."},
        )
        deliver_webhook.delay(str(endpoint.id), envelope)
        return Response({"queued": True, "event_id": envelope["event_id"]}, status=status.HTTP_202_ACCEPTED)


class WebhookDeliveryViewSet(AssignmentScopedViewSetMixin, viewsets.ReadOnlyModelViewSet):
    serializer_class = WebhookDeliverySerializer

    def get_queryset(self):
        queryset = WebhookDelivery.objects.select_related("endpoint").filter(
            endpoint__unit_id__in=self.allowed_unit_ids("tasks.webhook.manage")
        )
        endpoint_id = self.request.query_params.get("endpoint")
        return queryset.filter(endpoint_id=endpoint_id) if endpoint_id else queryset
