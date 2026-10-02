from django.db.models import Q
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from boldApp.core.authorization import build_authorization_context, request_has_recent_strong_mfa, resolve_access
from boldApp.core.models import OrganizationalUnit, Permission
from boldApp.core.permissions import HasActiveAssignment
from boldApp.core.authorization_units import load_authorization_units
from boldApp.tareas.models import Project, Task

from .models import Notification
from .serializers import NotificationSerializer


class NotificationViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [HasActiveAssignment]
    serializer_class = NotificationSerializer

    def _visible_ids(self, queryset, permission_code):
        permission = Permission.objects.filter(code=permission_code, is_active=True).first()
        if not permission or (permission.requires_step_up_mfa and not request_has_recent_strong_mfa(self.request)):
            return []
        context = build_authorization_context(self.request.assignment, permission)
        if not hasattr(self, "_authorization_units"):
            self._authorization_units = load_authorization_units(self.request.assignment)
        return [
            row.id for row in queryset.select_related("unit")
            if resolve_access(
                self.request.assignment,
                permission,
                self._authorization_units.get(row.unit_id, row.unit),
                resource_id=row.id,
                context=context,
            ).allowed
        ]

    def get_queryset(self):
        base = Notification.objects.filter(recipient_assignment=self.request.assignment)
        if self.kwargs.get("pk"):
            base = base.filter(pk=self.kwargs["pk"])
        task_ids = base.exclude(task_id__isnull=True).values_list("task_id", flat=True)
        project_ids = base.exclude(project_id__isnull=True).values_list("project_id", flat=True)
        visible_tasks = self._visible_ids(Task.objects.filter(id__in=task_ids), "tasks.task.read")
        visible_projects = self._visible_ids(Project.objects.filter(id__in=project_ids), "tasks.project.read")
        return base.select_related(
            "actor_assignment__employee", "recipient_assignment", "task", "project"
        ).filter(
            Q(task__isnull=True) | Q(task_id__in=visible_tasks),
        ).filter(
            Q(project__isnull=True) | Q(project_id__in=visible_projects),
        ).order_by("-created_at", "pk")

    @action(detail=True, methods=["post"], url_path="mark-read")
    def mark_read(self, request, pk=None):
        notification = self.get_object()
        if not notification.is_read:
            notification.is_read = True
            notification.read_at = timezone.now()
            notification.save(update_fields=["is_read", "read_at"])
        return Response(self.get_serializer(notification).data)

    @action(detail=True, methods=["post"], url_path="mark-unread")
    def mark_unread(self, request, pk=None):
        notification = self.get_object()
        if notification.is_read:
            notification.is_read = False
            notification.read_at = None
            notification.save(update_fields=["is_read", "read_at"])
        return Response(self.get_serializer(notification).data)

    @action(detail=False, methods=["post"], url_path="mark-all-read")
    def mark_all_read(self, request):
        now = timezone.now()
        updated = self.get_queryset().filter(is_read=False).update(is_read=True, read_at=now)
        return Response({"updated": updated})

    @action(detail=False, methods=["get"], url_path="unread-count")
    def unread_count(self, request):
        return Response({"count": self.get_queryset().filter(is_read=False).count()})
