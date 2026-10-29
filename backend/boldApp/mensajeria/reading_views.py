"""Marking unread never rewinds receipts, channel cursors or notification state."""
import hashlib
import json

from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from boldApp.core.models import Employee
from .models import ReadingReminder
from .reading_reminders import MAX_READING_REMINDERS, advance_clock, history_view, publish_reading_change, reading_snapshot, scope_key
from .serializers import StrictInputSerializer
from .views import Conflict, PrivateChatView


class ReadingChange(StrictInputSerializer):
    client_id = serializers.UUIDField()
    version = serializers.IntegerField(min_value=0)


class ReadingSource(StrictInputSerializer):
    kind = serializers.ChoiceField(choices=["chat", "channel"])
    source_id = serializers.UUIDField()


class ReadingMark(ReadingSource, ReadingChange):
    pass


def visible_source(view, values):
    field = "direct_id" if values["kind"] == "chat" else "channel_message_id"
    return get_object_or_404(history_view(view).visible_documents({"scope":"all", "kind":"all", "archived":True})
        .select_related("direct", "channel_message").defer("text", "direct__body", "channel_message__body"), **{field:values["source_id"]})


def change(row, values, document):
    digest = hashlib.sha256(json.dumps({"source":str(document.pk) if document else None}, sort_keys=True).encode()).hexdigest()
    if row.last_client_id == values["client_id"]:
        if row.last_digest != digest:
            raise Conflict("El identificador de este intento ya corresponde a otra marca de lectura.")
        return
    if row.version != values["version"]:
        raise Conflict("Tu marca de lectura cambió en otro dispositivo. Actualiza sus pendientes antes de reintentar.")
    changed = row.document_id != (document.pk if document else None)
    if changed:
        if document and row.document_id is None and ReadingReminder.objects.filter(employee_id=row.employee_id, document__isnull=False).count() >= MAX_READING_REMINDERS:
            raise ValidationError("Puedes mantener hasta 500 pendientes de lectura. Quita alguno antes de añadir otro.")
        row.version = advance_clock(row.employee_id)
    row.document = document
    row.last_client_id = values["client_id"]
    row.last_digest = digest
    row.save()
    if changed:
        publish_reading_change(row.employee_id)


class ReadingReminderView(PrivateChatView):
    @transaction.atomic
    def get(self, request):
        if any(len(request.query_params.getlist(key)) != 1 for key in request.query_params):
            raise ValidationError("No repitas los parámetros de la referencia.")
        form = ReadingSource(data=request.query_params)
        form.is_valid(raise_exception=True)
        Employee.objects.select_for_update().get(pk=self.actor())
        document = visible_source(self, form.validated_data)
        row = ReadingReminder.objects.filter(employee_id=self.actor(), scope_key=scope_key(document)).first()
        return Response({"id":str(row.pk) if row else None, "version":row.version if row else 0,
            "marked":bool(row and row.document_id)})

    @transaction.atomic
    def put(self, request):
        form = ReadingMark(data=request.data)
        form.is_valid(raise_exception=True)
        values = form.validated_data
        Employee.objects.select_for_update().get(pk=self.actor())
        document = visible_source(self, values)
        row, _ = ReadingReminder.objects.get_or_create(employee_id=self.actor(), scope_key=scope_key(document))
        change(row, values, document)
        return Response({"id":str(row.pk), "version":row.version, "reading":reading_snapshot(self)})


class ReadingReminderClearView(PrivateChatView):
    @transaction.atomic
    def put(self, request, reminder_id):
        form = ReadingChange(data=request.data)
        form.is_valid(raise_exception=True)
        Employee.objects.select_for_update().get(pk=self.actor())
        # Clearing one's own unavailable reminder is harmless and does not need
        # access to its former content. Foreign and nonexistent IDs both use 404.
        row = get_object_or_404(ReadingReminder.objects.filter(employee_id=self.actor()), pk=reminder_id)
        change(row, form.validated_data, None)
        return Response({"id":str(row.pk), "version":row.version, "reading":reading_snapshot(self)})
