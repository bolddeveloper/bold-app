"""Bounded, idempotent personal bookmarks, with the source's live read boundary."""
from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from boldApp.core.models import Employee
from .models import SavedItem
from .search_views import HistorySearchView
from .serializers import StrictInputSerializer
from .views import PrivateChatView

MAX_SAVED_ITEMS = 500


class SaveInput(StrictInputSerializer):
    kind = serializers.ChoiceField(choices=["chat", "channel", "page"])
    source_id = serializers.UUIDField()


class SavedItemView(HistorySearchView):
    def get_throttles(self):
        return PrivateChatView.get_throttles(self)

    @transaction.atomic
    def put(self, request):
        form = SaveInput(data=request.data)
        form.is_valid(raise_exception=True)
        source = {"chat": "direct_id", "channel": "channel_message_id", "page": "page_id"}[form.validated_data["kind"]]
        document = get_object_or_404(self.visible_documents({"scope": "all", "kind": "all", "archived": True}),
            **{source: form.validated_data["source_id"]})
        # Serialize the bounded collection across devices. The lock is local to
        # this employee; no DM/channel activity or receipt version is changed.
        Employee.objects.select_for_update().get(pk=self.actor())
        existing = SavedItem.objects.filter(employee_id=self.actor(), document=document).first()
        if not existing:
            if SavedItem.objects.filter(employee_id=self.actor()).count() >= MAX_SAVED_ITEMS:
                raise ValidationError("Tu lista de guardados alcanzó el límite de 500 elementos. Quita alguno antes de añadir otro.")
            existing = SavedItem.objects.create(employee_id=self.actor(), document=document)
        return Response({"document_id": str(document.pk), "saved": True}, status=200)

    def delete(self, request, document_id):
        # Removal is always personal, including unavailable sources. Always 204:
        # do not expose whether a foreign bookmark or document exists.
        SavedItem.objects.filter(employee_id=self.actor(), document_id=document_id).delete()
        return Response(status=204)
