from uuid import UUID
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView
from boldApp.core.permissions import HasActiveAssignment
from .models import PersonalTaskBoard


class PersonalSectionSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    label = serializers.CharField(max_length=120)


class PersonalBoardSerializer(serializers.Serializer):
    sections = PersonalSectionSerializer(many=True, max_length=200)
    task_sections = serializers.DictField(child=serializers.UUIDField())

    def validate(self, data):
        ids = {row["id"] for row in data["sections"]}
        names = {row["label"].casefold() for row in data["sections"]}
        if len(ids) != len(data["sections"]) or len(names) != len(ids):
            raise serializers.ValidationError("Usa nombres e identificadores únicos para las secciones.")
        if len(data["task_sections"]) > 10000:
            raise serializers.ValidationError("Demasiadas tareas en el tablero.")
        try:
            mapping = {str(UUID(key)): str(section) for key, section in data["task_sections"].items()}
        except (ValueError, TypeError, AttributeError):
            raise serializers.ValidationError("Identificador de tarea inválido.")
        if any(section not in ids for section in data["task_sections"].values()):
            raise serializers.ValidationError("La sección de destino no existe.")
        return {"sections": [{"id": str(row["id"]), "label": row["label"]} for row in data["sections"]], "task_sections": mapping}


class PersonalBoardView(APIView):
    permission_classes = [HasActiveAssignment]

    def get(self, request):
        row = PersonalTaskBoard.objects.filter(assignment=request.assignment).first()
        return Response({"sections": row.sections, "task_sections": row.task_sections} if row else {"sections": [], "task_sections": {}})

    def put(self, request):
        serializer = PersonalBoardSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        row, _ = PersonalTaskBoard.objects.update_or_create(assignment=request.assignment, defaults=serializer.validated_data)
        return Response({"sections": row.sections, "task_sections": row.task_sections})
