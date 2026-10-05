from django.db.models import F
from django.utils import timezone
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import PrivateNote


class NoteSerializer(serializers.Serializer):
    content = serializers.CharField(allow_blank=True, trim_whitespace=False, max_length=2_000_000)
    version = serializers.IntegerField(min_value=0)


class PrivateNoteView(APIView):
    """Only the authenticated account's note; concurrent devices cannot overwrite silently."""

    def get(self, request):
        note = PrivateNote.objects.filter(user=request.user).first()
        return Response({"content": note.content if note else "", "version": note.version if note else 0})

    def put(self, request):
        data = NoteSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        note, _ = PrivateNote.objects.get_or_create(user=request.user)
        changed = PrivateNote.objects.filter(pk=note.pk, version=data.validated_data["version"]).update(
            content=data.validated_data["content"], version=F("version") + 1, updated_at=timezone.now(),
        )
        if not changed:
            return Response({"detail": "Las notas cambiaron en otro dispositivo. Copia tus cambios y vuelve a cargar."}, status=409)
        return Response({"version": data.validated_data["version"] + 1})
