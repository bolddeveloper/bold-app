"""Resource history, scoped to one currently authorized conversation/channel.

One card per retained message, not per link; no Drive request, receipts, global
counts or page/task projections when listing. Each media download has its own ACL.
"""
import hashlib
import json
import re
import uuid
from datetime import datetime

from django.core import signing
from django.db import connection
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from .channel_views import SlackView
from .media import media_data
from .models import SearchDocument
from .resource_links_v1 import resource_links
from .search_text import normalized_text, snippet
from .search_views import SearchThrottle
from .serializers import StrictInputSerializer

PAGE_SIZE = 25
CURSOR_SALT = "bold.messaging.resources.v1"


class ResourceInput(StrictInputSerializer):
    q = serializers.CharField(max_length=160, allow_blank=True, default="")
    kind = serializers.ChoiceField(choices=["all", "image", "audio", "document", "file", "link"], default="all")
    author = serializers.UUIDField(required=False)
    after = serializers.DateTimeField(required=False)
    before = serializers.DateTimeField(required=False)
    parent = serializers.UUIDField(required=False)
    cursor = serializers.CharField(max_length=4096, required=False)

    def validate(self, data):
        query = normalized_text(data["q"])
        if data["q"] and (len(query) < 2 or len(query.split()) > 8):
            raise ValidationError({"q": "Usa al menos dos caracteres y hasta ocho palabras."})
        if data.get("after") and data.get("before") and data["after"] >= data["before"]:
            raise ValidationError("La fecha final debe ser posterior a la inicial.")
        data["q"] = query
        return data


class ResourceLibraryView(SlackView):
    def get_throttles(self):
        return [SearchThrottle()]

    def get(self, request, container_id, kind):
        # Do not disclose malformed filters, author names or cursor state until
        # the parent boundary has been checked against the current assignment.
        container = self.conversation(container_id) if kind == "chat" else self.channel(container_id)
        if any(len(request.query_params.getlist(key)) != 1 for key in request.query_params):
            raise ValidationError("No repitas los filtros de la biblioteca.")
        form = ResourceInput(data=request.query_params)
        form.is_valid(raise_exception=True)
        values = form.validated_data
        field = "direct" if kind == "chat" else "channel_message"
        if values.get("parent"):
            if kind == "chat":
                raise ValidationError({"parent": "Los chats directos no tienen hilos."})
            get_object_or_404(container.messages, pk=values["parent"], parent__isnull=True)
        scope = {"kind": kind, "container": str(container.pk), "account": str(request.user.pk),
            "assignment": str(request.assignment.pk), **{k: str(v) for k, v in values.items() if k != "cursor"}}
        context = hashlib.sha256(json.dumps(scope, sort_keys=True).encode()).hexdigest()
        fence, position = timezone.now(), None
        if values.get("cursor"):
            try:
                cursor = signing.loads(values["cursor"], salt=CURSOR_SALT, max_age=1800)
                if cursor["context"] != context:
                    raise ValueError()
                fence = datetime.fromisoformat(cursor["fence"])
                if "time" in cursor or "id" in cursor:
                    position = datetime.fromisoformat(cursor["time"]), uuid.UUID(cursor["id"])
                if timezone.is_naive(fence) or position and timezone.is_naive(position[0]):
                    raise ValueError()
            except (signing.BadSignature, ValueError, TypeError, KeyError):
                raise ValidationError("La consulta caducó o cambió. Vuelve a aplicar los filtros.")
        rows = SearchDocument.objects.filter(**{f"{field}__{'conversation' if kind == 'chat' else 'channel'}": container}, created_at__lte=fence)
        media = Q(**{f"{field}__media__isnull": False})
        if values["kind"] == "all":
            rows = rows.filter(media | Q(has_links=True))
        elif values["kind"] == "file":
            rows = rows.filter(media)
        elif values["kind"] == "link":
            rows = rows.filter(has_links=True)
        else:
            rows = rows.filter(**{f"{field}__media__kind": values["kind"]})
        if values.get("parent"):
            rows = rows.filter(Q(channel_message_id=values["parent"]) | Q(channel_message__parent_id=values["parent"]))
        if values.get("author"):
            rows = rows.filter(**{f"{field}__author_id": values["author"]})
        if values.get("after"):
            rows = rows.filter(created_at__gte=values["after"])
        if values.get("before"):
            rows = rows.filter(created_at__lt=values["before"])
        if values["q"]:
            if connection.vendor == "postgresql":
                from django.contrib.postgres.search import SearchQuery, SearchVector
                rows = rows.alias(_vector=SearchVector("text", config="simple")).filter(
                    _vector=SearchQuery(values["q"], config="simple", search_type="plain"))
            else:
                for term in values["q"].split():
                    rows = rows.filter(text__regex=r"\b" + re.escape(term) + r"\b")
        if position:
            rows = rows.filter(Q(created_at__lt=position[0]) | Q(created_at=position[0], pk__lt=position[1]))
        page = list(rows.select_related(f"{field}__author", f"{field}__media").order_by("-created_at", "-id")[:PAGE_SIZE + 1])
        def cursor_for(row=None):
            return signing.dumps({"context": context, "fence": fence.isoformat(),
                **({"time": row.created_at.isoformat(), "id": str(row.pk)} if row else {})}, salt=CURSOR_SALT, compress=True)
        return Response({"results": [self.result(row, field) for row in page[:PAGE_SIZE]],
            "next_cursor": cursor_for(page[PAGE_SIZE - 1]) if len(page) > PAGE_SIZE else None,
            "first_cursor": cursor_for(), "snapshot_at": fence, "ordering": "newest"})

    @staticmethod
    def result(document, field):
        message = getattr(document, field)
        direct = field == "direct"
        target = {"kind": "chat", "conversation_id": str(message.conversation_id), "message_id": str(message.pk)} if direct else {
            "kind": "channel", "channel_id": str(message.channel_id), "message_id": str(message.pk),
            "parent_id": str(message.parent_id) if message.parent_id else None}
        return {"id": str(document.pk), "source_id": str(message.pk), "target": target,
            "author": {"employee_id": str(message.author_id), "name": message.author.full_name},
            "created_at": message.created_at, "edited_at": message.edited_at,
            "excerpt": snippet(message.body, ""), "media": media_data(message), "links": resource_links(message.body)}
