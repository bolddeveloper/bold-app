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
    return {"id": str(row.pk), "folder_id": str(row.folder_id), "owner_id": str(row.owner_id), "mine": row.owner_id == user.pk, "folders": row.folders, "member_ids": [str(item.pk) for item in row.members.all()]}


class WorkspaceSharingView(APIView):
    permission_classes = [HasActiveAssignment]

    def get(self, request):
        rows = SharedWorkspaceFolder.objects.filter(unit=request.assignment.position.unit).filter(Q(owner=request.user) | Q(members=request.assignment)).distinct().prefetch_related("members")
        return Response({"items": [representation(row, request.user) for row in rows]})

    @transaction.atomic
    def post(self, request):
        data = ShareSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        values = data.validated_data
        ids = set(values.get("member_ids", []))
        members = PositionAssignment.objects.filter(pk__in=ids, position__unit=request.assignment.position.unit, is_active=True, released_at__isnull=True, employee__is_active=True, employee__user_account__is_active=True)
        if set(members.values_list("pk", flat=True)) != ids:
            raise serializers.ValidationError("Selecciona personas activas de tu departamento.")
        # UUIDs in JSON remain strings, independently of the database engine.
        import json
        from django.core.serializers.json import DjangoJSONEncoder
        payload = json.loads(json.dumps(values["folders"], cls=DjangoJSONEncoder))
        row, _ = SharedWorkspaceFolder.objects.update_or_create(owner=request.user, unit=request.assignment.position.unit, folder_id=values["folder_id"], defaults={"folders": payload})
        if "member_ids" in values:
            row.members.set(members)
        return Response(representation(row, request.user))

    def delete(self, request):
        identity = serializers.UUIDField().run_validation(request.query_params.get("folder_id"))
        SharedWorkspaceFolder.objects.filter(owner=request.user, unit=request.assignment.position.unit, folder_id=identity).delete()
        return Response(status=204)
