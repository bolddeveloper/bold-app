import hashlib
import html
import json
from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from rest_framework.pagination import CursorPagination
from rest_framework.response import Response
from boldApp.core.models import Employee, Permission
from boldApp.core.authorization import apply_session_assurance, build_authorization_context, resolve_access
from boldApp.tareas.models import Project, Task, TaskStatus
from boldApp.tareas.serializers import TaskSerializer
from boldApp.tareas.views import TaskViewSet
from .channel_views import SlackView
from .channel_tasks import TaskReferences
from .models import MessageTaskConversion
from .serializers import StrictInputSerializer
from .task_conversions import source_document
from .views import Conflict


def tasks_view(request):
    view = TaskViewSet();view.request = request;view.action = "create";view.kwargs = {}
    return view


def writable_project(request, identity):
    view = tasks_view(request)
    project = get_object_or_404(view.visible_projects(Project.objects.filter(pk=identity, is_archived=False)).select_related("unit"), pk=identity)
    view.require_permission("tasks.project.manage", project.unit, project.pk)
    view.require_permission("tasks.task.create", project.unit)
    return project, view


class TaskConversionInput(StrictInputSerializer):
    source_version = serializers.IntegerField(min_value=1)
    client_id = serializers.UUIDField()
    project = serializers.UUIDField()
    section = serializers.UUIDField(required=False, allow_null=True, default=None)
    assignee_assignment = serializers.UUIDField(required=False, allow_null=True, default=None)
    due_date = serializers.DateField(required=False, allow_null=True, default=None)
    title = serializers.CharField(max_length=220)
    description = serializers.CharField(max_length=10000, allow_blank=True, default="", trim_whitespace=False)
    priority = serializers.ChoiceField(choices=["Alta", "Media", "Baja"], default="Media")
    status = serializers.UUIDField(required=False, allow_null=True, default=None)
    share_confirmed = serializers.BooleanField()

    def validate_share_confirmed(self, value):
        if not value:
            raise ValidationError("Revisa y confirma qué texto deseas compartir con las personas que tengan acceso a la tarea.")
        return value


class MessageTaskPages(CursorPagination):
    page_size = 20
    ordering = ("-created_at", "-id")


class TaskProjectPages(CursorPagination):
    page_size = 25
    ordering = ("name", "id")


class TaskConversionProjectsView(SlackView):
    def get(self, request, project_id=None):
        if project_id:
            project, _ = writable_project(request, project_id)
            sections = [{"id":str(row.pk), "name":row.name} for row in project.sections.order_by("position", "created_at", "pk")]
            if not project.unsectioned_hidden:
                position = len(sections) if project.unsectioned_index is None else min(project.unsectioned_index, len(sections))
                sections.insert(position, {"id":None, "name":"Sin sección"})
            statuses = TaskStatus.objects.filter(Q(unit=project.unit) | Q(unit__isnull=True)).order_by("position", "pk")
            return Response({"project":{"id":str(project.pk), "name":project.name, "unit_name":project.unit.name},
                "sections":sections, "statuses":[{"id":str(row.pk), "name":row.name, "is_final":row.is_final} for row in statuses]})
        if set(request.query_params) - {"q", "cursor"} or any(len(request.query_params.getlist(key)) != 1 for key in request.query_params):
            raise ValidationError("Usa solo la búsqueda y el cursor de proyectos, sin repetir parámetros.")
        query = request.query_params.get("q", "").strip()
        if len(query) > 120:
            raise ValidationError("La búsqueda de proyectos admite hasta 120 caracteres.")
        view = tasks_view(request)
        rows = view.visible_projects(Project.objects.filter(is_archived=False, name__icontains=query))
        permission = Permission.objects.filter(code="tasks.project.manage", is_active=True).first()
        allowed = []
        if permission:
            context = build_authorization_context(request.assignment, permission)
            units = view.authorization_units()
            creatable = set(view.allowed_unit_ids("tasks.task.create"))
            for row in rows.select_related("unit").iterator(chunk_size=100):
                if row.unit_id in creatable and apply_session_assurance(resolve_access(request.assignment, permission,
                    units.get(row.unit_id, row.unit), resource_id=row.pk, context=context), permission, request).allowed:
                    allowed.append(row.pk)
        pager = TaskProjectPages();page = pager.paginate_queryset(Project.objects.filter(pk__in=allowed).select_related("unit"), request, view=self)
        return pager.get_paginated_response([{"id":str(row.pk), "name":row.name, "unit_name":row.unit.name} for row in page])


class MessageTasksView(SlackView):
    def values(self, kind, container_id, message_id):
        return {"kind":kind, "container_id":container_id, "message_id":message_id}

    def get(self, request, kind, container_id, message_id):
        document, message = source_document(self, self.values(kind, container_id, message_id))
        # Filter task access before paging, names, status or counts. A reference
        # is not an announcement to everyone who can read the source message.
        rows = MessageTaskConversion.objects.filter(document=document, task__isnull=False)
        view = tasks_view(request)
        visible = view.visible_tasks(Task.objects.filter(pk__in=rows.values("task_id")))
        rows = rows.filter(task__in=visible)
        pager = MessageTaskPages();page = pager.paginate_queryset(rows, request, view=self)
        refs = TaskReferences(request.assignment, request);refs.prime(row.task_id for row in page)
        data = pager.get_paginated_response([{"id":str(row.pk), "task":refs.data(row.task_id), "created_at":row.created_at} for row in page]).data
        return Response({**data, "source_version":message.version, "source_text":message.body,
            "files_copied":False})

    @transaction.atomic
    def post(self, request, kind, container_id, message_id):
        form = TaskConversionInput(data=request.data);form.is_valid(raise_exception=True)
        values = form.validated_data
        # One employee may retry from another tab/assignment. Serialize the
        # receipt before creating the Task and normal TaskProject/follower rows.
        Employee.objects.select_for_update().get(pk=self.actor())
        source = self.values(kind, container_id, message_id)
        document, message = source_document(self, source, lock=True)
        digest = hashlib.sha256(json.dumps({**source, **values}, sort_keys=True, default=str).encode()).hexdigest()
        existing = MessageTaskConversion.objects.filter(employee_id=self.actor(), client_id=values["client_id"]).first()
        if existing:
            if existing.digest != digest:
                raise Conflict("Este intento ya corresponde a otra creación de tarea. No se ha creado una segunda.")
            return self.result(existing, created=False)
        if message.version != values["source_version"]:
            raise Conflict("El mensaje cambió desde que lo revisaste. Vuelve a abrirlo y confirma de nuevo el texto que quieres compartir.")
        project, task_view = writable_project(request, values["project"])
        status = values["status"]
        if not status:
            status = TaskStatus.objects.filter(unit=project.unit, is_final=False).order_by("position", "pk").values_list("pk", flat=True).first()
            status = status or TaskStatus.objects.filter(unit__isnull=True, is_final=False).order_by("position", "pk").values_list("pk", flat=True).first()
        if not status:
            raise ValidationError({"status":"El equipo del proyecto no tiene un estado inicial disponible."})
        # Conversion is plain text only. A quoted <img>, data URL or external
        # image cannot turn into an implicit Drive upload or private-file share.
        # TaskText recognises formatted content only with its existing marker.
        # Escape first, including colons, so even a quoted data:image token is
        # displayed literally rather than invoking TaskSerializer's uploader.
        escaped = html.escape(values["description"]).replace(":", "&#58;").replace("\n", "<br>")
        description = "<!--bold-rich-text--><p>" + escaped + "</p>" if values["description"] else ""
        serializer = TaskSerializer(data={"unit":str(project.unit_id), "project":str(project.pk), "section":str(values["section"]) if values["section"] else None,
            "assignee_assignment":str(values["assignee_assignment"]) if values["assignee_assignment"] else None,
            "title":values["title"], "description":description, "priority":values["priority"], "status":str(status),
            "due_date":values["due_date"], "follow_creator":True}, context={"request":request, "view":task_view})
        serializer.is_valid(raise_exception=True)
        task_view.perform_create(serializer)
        conversion = MessageTaskConversion.objects.create(document=document, task=serializer.instance, employee_id=self.actor(),
            assignment=request.assignment, client_id=values["client_id"], digest=digest, source_version=message.version)
        return self.result(conversion, created=True)

    def result(self, conversion, *, created):
        refs = TaskReferences(self.request.assignment, self.request)
        return Response({"id":str(conversion.pk), "task":refs.data(conversion.task_id) if conversion.task_id else {"available":False},
            "created":created}, status=201 if created else 200)
