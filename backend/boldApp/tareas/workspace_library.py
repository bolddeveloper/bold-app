"""Personal durable folders, with optimistic concurrency and explicit import."""
import json
from django.core.serializers.json import DjangoJSONEncoder
from django.db import transaction
from rest_framework import serializers
from rest_framework.exceptions import APIException
from rest_framework.response import Response
from rest_framework.views import APIView
from boldApp.core.permissions import HasActiveAssignment
from boldApp.administrativo.services import record_system_event
from .models import WorkspaceLibrary, SharedWorkspaceFolder
from .workspace_sharing import FolderSerializer


class WorkspaceConflict(APIException):
    status_code = 409
    default_detail = "Otra persona o dispositivo actualizó estas carpetas. Recarga antes de guardar; tus cambios no se sobrescribieron."
    default_code = "workspace_revision_conflict"


def json_folders(folders):
    return json.loads(json.dumps(folders, cls=DjangoJSONEncoder))


def validate_tree(folders):
    by_id = {row["id"]: row for row in folders}
    if len(by_id) != len(folders):
        raise serializers.ValidationError("Los identificadores de carpetas deben ser únicos.")
    for row in folders:
        seen = {row["id"]}
        parent = row.get("parentId")
        while parent is not None:
            if parent not in by_id or parent in seen:
                raise serializers.ValidationError("Las carpetas contienen un ciclo o un padre inexistente.")
            seen.add(parent)
            parent = by_id[parent].get("parentId")


class LibrarySerializer(serializers.Serializer):
    revision = serializers.IntegerField(min_value=0)
    folders = FolderSerializer(many=True, max_length=500)
    share_revisions = serializers.DictField(child=serializers.IntegerField(min_value=1), required=False, default=dict)

    def validate_folders(self, folders):
        validate_tree(folders)
        return folders


def branch(folders, root):
    ids = {str(root)}
    while True:
        expanded = ids | {row["id"] for row in folders if row.get("parentId") in ids}
        if expanded == ids:
            return [row for row in folders if row["id"] in ids]
        ids = expanded


def validate_new_links(request, folders, previous):
    # Sharing metadata never grants access to a task/project. New associations
    # require the same scoped read checks as their existing REST endpoints.
    from .views import ProjectViewSet, TaskViewSet
    from .models import Project, Task
    old = {key: {identity for row in previous for identity in row.get(key, [])} for key in ("projectIds", "taskIds")}
    for key, view_type in (("projectIds", ProjectViewSet), ("taskIds", TaskViewSet)):
        added = {identity for row in folders for identity in row[key]} - old[key]
        if not added:
            continue
        view = view_type(); view.request = request; view.action = "list"
        candidates = Project.objects.filter(pk__in=added) if key == "projectIds" else Task.objects.filter(pk__in=added)
        visible = view.visible_projects(candidates) if key == "projectIds" else view.visible_tasks(candidates)
        readable = {str(pk) for pk in visible.values_list("pk", flat=True)}
        if readable != added:
            raise serializers.ValidationError("Solo puedes asociar proyectos y tareas a los que tienes acceso.")


class WorkspaceLibraryView(APIView):
    permission_classes = [HasActiveAssignment]

    def get(self, request):
        row = WorkspaceLibrary.objects.filter(owner=request.user, unit=request.assignment.position.unit).first()
        return Response({"folders": row.folders if row else [], "revision": row.revision if row else 0})

    @transaction.atomic
    def put(self, request):
        serializer = LibrarySerializer(data=request.data); serializer.is_valid(raise_exception=True)
        values = serializer.validated_data
        row, _ = WorkspaceLibrary.objects.get_or_create(owner=request.user, unit=request.assignment.position.unit)
        row = WorkspaceLibrary.objects.select_for_update().get(pk=row.pk)
        if values["revision"] != row.revision:
            raise WorkspaceConflict()
        folders = json_folders(values["folders"])
        validate_new_links(request, folders, row.folders)
        shares = list(SharedWorkspaceFolder.objects.select_for_update().filter(owner=request.user, unit=row.unit))
        for share in shares:
            updated = branch(folders, share.folder_id)
            if updated != share.folders:
                if values["share_revisions"].get(str(share.pk)) != share.revision:
                    raise WorkspaceConflict()
                if not updated:
                    share.delete()
                else:
                    share.folders = updated; share.revision += 1; share.save(update_fields=["folders", "revision", "updated_at"])
        row.folders = folders; row.revision += 1; row.save(update_fields=["folders", "revision", "updated_at"])
        record_system_event("workspace.library_updated", request, module_code="tasks", target_type="workspace_library", target_id=row.pk)
        return Response({"folders": row.folders, "revision": row.revision})
