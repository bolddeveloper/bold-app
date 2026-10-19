from django.db import transaction
from django.db.models import Q
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView
from boldApp.core.models import PositionAssignment
from boldApp.core.permissions import HasActiveAssignment
from .models import SharedWorkspaceFolder


class FolderSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    name = serializers.CharField(max_length=120)
    parentId = serializers.UUIDField(allow_null=True, required=False, default=None)
    description = serializers.CharField(max_length=100000, allow_blank=True, required=False, default="")
    color = serializers.RegexField(r"^#[0-9a-fA-F]{6}$")
    projectIds = serializers.ListField(child=serializers.UUIDField(), max_length=1000)
    taskIds = serializers.ListField(child=serializers.UUIDField(), max_length=2000)
    driveFolders = serializers.ListField(child=serializers.DictField(), max_length=200, required=False, default=list)

    def validate_driveFolders(self, value):
        import re
        if any(not isinstance(row.get("id"), str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,200}", row["id"]) or not isinstance(row.get("name"), str) or not 0 < len(row["name"].strip()) <= 255 for row in value):
            raise serializers.ValidationError("Carpeta de Drive invalida.")
        return [{"id": row["id"], "name": row["name"].strip()} for row in value]


class ShareSerializer(serializers.Serializer):
    folder_id = serializers.UUIDField()
    folders = FolderSerializer(many=True, max_length=200)
    member_ids = serializers.ListField(child=serializers.UUIDField(), max_length=200, required=False)
    revision = serializers.IntegerField(min_value=1, required=False)

    def validate(self, data):
        ids = {folder["id"] for folder in data["folders"]}
        if data["folder_id"] not in ids or len(ids) != len(data["folders"]):
            raise serializers.ValidationError("La carpeta raiz y sus subcarpetas deben ser unicas.")
        by_id = {item["id"]: item for item in data["folders"]}
        for folder in data["folders"]:
            seen = {folder["id"]}
            parent = folder["parentId"]
            while parent in ids:
                if parent in seen:
                    raise serializers.ValidationError("Las carpetas contienen un ciclo.")
                seen.add(parent)
                parent = by_id[parent]["parentId"]
            if folder["id"] != data["folder_id"] and data["folder_id"] not in seen:
                raise serializers.ValidationError("Solo puedes compartir subcarpetas de la carpeta elegida.")
        return data


def representation(row, user):
    return {"id": str(row.pk), "folder_id": str(row.folder_id), "owner_id": str(row.owner_id), "mine": row.owner_id == user.pk, "folders": row.folders, "revision": row.revision, "member_ids": [str(item.pk) for item in row.members.all()]}


class WorkspaceSharingView(APIView):
    permission_classes = [HasActiveAssignment]

    def get(self, request):
        rows = SharedWorkspaceFolder.objects.filter(Q(owner=request.user, unit=request.assignment.position.unit) | Q(members=request.assignment)).distinct().prefetch_related("members")
        return Response({"items": [representation(row, request.user) for row in rows]})

    @transaction.atomic
    def post(self, request):
        data = ShareSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        values = data.validated_data
        ids = set(values.get("member_ids", []))
        members = PositionAssignment.objects.filter(pk__in=ids, is_active=True, released_at__isnull=True, employee__is_active=True, employee__user_account__is_active=True)
        if set(members.values_list("pk", flat=True)) != ids:
            raise serializers.ValidationError("Selecciona personas activas de la organización.")
        # UUIDs in JSON remain strings, independently of the database engine.
        import json
        from django.core.serializers.json import DjangoJSONEncoder
        payload = json.loads(json.dumps(values["folders"], cls=DjangoJSONEncoder))
        from .workspace_library import WorkspaceConflict, validate_new_links, branch, validate_tree
        from .models import WorkspaceLibrary
        library, _ = WorkspaceLibrary.objects.get_or_create(owner=request.user, unit=request.assignment.position.unit)
        library = WorkspaceLibrary.objects.select_for_update().get(pk=library.pk)
        row = SharedWorkspaceFolder.objects.select_for_update().filter(owner=request.user, unit=library.unit, folder_id=values["folder_id"]).first()
        if row and values.get("revision") != row.revision:
            raise WorkspaceConflict()
        validate_new_links(request, payload, row.folders if row else library.folders)
        # Preserve the real parent in the owner's library, including nested shares.
        previous = branch(library.folders, values["folder_id"])
        removed = {item["id"] for item in previous}
        library.folders = [item for item in library.folders if item["id"] not in removed] + payload
        validate_tree(library.folders)
        library.revision += 1; library.save(update_fields=["folders", "revision", "updated_at"])
        if row:
            row.folders = payload; row.revision += 1; row.save(update_fields=["folders", "revision", "updated_at"])
        else:
            row = SharedWorkspaceFolder.objects.create(owner=request.user, unit=library.unit, folder_id=values["folder_id"], folders=payload)
        if "member_ids" in values:
            row.members.set(members)
        for related in SharedWorkspaceFolder.objects.select_for_update().filter(owner=request.user, unit=library.unit).exclude(pk=row.pk):
            updated = branch(library.folders, related.folder_id)
            if updated != related.folders:
                related.folders = updated; related.revision += 1; related.save(update_fields=["folders", "revision", "updated_at"])
        from boldApp.administrativo.services import record_system_event
        record_system_event("workspace.sharing_updated", request, module_code="tasks", target_type="workspace_share", target_id=row.pk)
        return Response(representation(row, request.user))

    @transaction.atomic
    def patch(self, request):
        from .models import WorkspaceLibrary
        from .workspace_library import WorkspaceConflict, json_folders, branch, validate_new_links, validate_tree
        identity = serializers.UUIDField().run_validation(request.data.get("id"))
        row = SharedWorkspaceFolder.objects.filter(pk=identity).filter(Q(owner=request.user) | Q(members=request.assignment)).first()
        if not row:
            from rest_framework.exceptions import NotFound
            raise NotFound()
        serializer = ShareSerializer(data=request.data); serializer.is_valid(raise_exception=True)
        values = serializer.validated_data
        if "member_ids" in request.data or values["folder_id"] != row.folder_id:
            raise serializers.ValidationError("Solo el creador gestiona las personas y la raíz compartida.")
        library = WorkspaceLibrary.objects.select_for_update().get(owner=row.owner, unit=row.unit)
        row = SharedWorkspaceFolder.objects.select_for_update().get(pk=identity)
        if row.owner_id != request.user.pk and not row.members.filter(pk=request.assignment.pk).exists():
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied()
        if values.get("revision") != row.revision:
            raise WorkspaceConflict()
        folders = json_folders(values["folders"])
        validate_new_links(request, folders, row.folders)
        ids = {item["id"] for item in row.folders}
        if any(item["id"] not in ids and any(old["id"] == item["id"] for old in library.folders) for item in folders):
            raise serializers.ValidationError("Una carpeta ya pertenece a otro workspace.")
        old_root = next(item for item in row.folders if item["id"] == str(row.folder_id))
        next(item for item in folders if item["id"] == str(row.folder_id))["parentId"] = old_root.get("parentId")
        library.folders = [item for item in library.folders if item["id"] not in ids] + folders
        validate_tree(library.folders)
        library.revision += 1; library.save(update_fields=["folders", "revision", "updated_at"])
        for share in SharedWorkspaceFolder.objects.select_for_update().filter(owner=row.owner, unit=row.unit):
            updated = branch(library.folders, share.folder_id)
            if updated != share.folders:
                share.folders = updated; share.revision += 1; share.save(update_fields=["folders", "revision", "updated_at"])
        row.refresh_from_db()
        from boldApp.administrativo.services import record_system_event
        record_system_event("workspace.shared_content_updated", request, module_code="tasks", target_type="workspace_share", target_id=row.pk)
        return Response(representation(row, request.user))

    def delete(self, request):
        identity = serializers.UUIDField().run_validation(request.query_params.get("folder_id"))
        SharedWorkspaceFolder.objects.filter(owner=request.user, unit=request.assignment.position.unit, folder_id=identity).delete()
        return Response(status=204)
