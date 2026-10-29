"""Full-history search. ACL filtering precedes pagination and every projection."""
import hashlib
import json
import re
import uuid
from datetime import datetime

from django.core import signing
from django.db import connection
from django.db.models import Exists, OuterRef, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle

from .channel_acl import readable_channels
from .channel_views import SlackView, channel_message_data
from .models import DepartmentChannel, SearchDocument, SavedItem, ReadingReminder
from .presenters import message_data
from .search_text import message_text, normalized_text, page_text, snippet
from .serializers import StrictInputSerializer
from .views import PrivateChatView
from .personal_data import prime_saved
from .reactions import prime_reactions
from .thread_following import prime_thread_states
from .mentions import prime_channel_mentions, prime_direct_mentions

PAGE_SIZE = 20
CURSOR_SALT = "bold.messaging.search.v1"


class SearchThrottle(UserRateThrottle):
    scope = "messaging_search"
    rate = "30/min"


class SearchInput(StrictInputSerializer):
    q = serializers.CharField(max_length=160, allow_blank=True, default="")
    scope = serializers.ChoiceField(choices=["all", "chat", "slack"], default="all")
    kind = serializers.ChoiceField(choices=["all", "text", "image", "audio", "document", "file", "page"], default="all")
    channel = serializers.UUIDField(required=False)
    conversation = serializers.UUIDField(required=False)
    author = serializers.UUIDField(required=False)
    after = serializers.DateTimeField(required=False)
    before = serializers.DateTimeField(required=False)
    archived = serializers.BooleanField(default=False)
    saved = serializers.BooleanField(default=False)
    threads = serializers.BooleanField(default=False)
    marked_unread = serializers.BooleanField(default=False)
    cursor = serializers.CharField(max_length=4096, required=False)

    def validate(self, data):
        query = normalized_text(data["q"])
        if data["q"] and (len(query) < 2 or len(query.split()) > 8):
            raise ValidationError({"q": "Usa al menos dos caracteres y hasta ocho palabras."})
        if data.get("channel") and (data.get("conversation") or data["scope"] == "chat"):
            raise ValidationError("El canal no pertenece al ámbito de Chat privado.")
        if data.get("conversation") and data["scope"] == "slack":
            raise ValidationError("La conversación no pertenece al ámbito de Slack.")
        if data["threads"] and (data["scope"] == "chat" or data.get("conversation") or data["kind"] == "page"):
            raise ValidationError("Los hilos seguidos pertenecen a los mensajes de Slack, no a Chat privado ni a páginas.")
        if data["marked_unread"] and data["kind"] == "page":
            raise ValidationError("Las marcas de no leído pertenecen a mensajes de Chat, canales e hilos, no a páginas.")
        if data.get("after") and data.get("before") and data["after"] >= data["before"]:
            raise ValidationError("La fecha final debe ser posterior a la inicial.")
        data["q"] = query
        return data


class HistorySearchView(SlackView):
    def get_throttles(self):
        return [SearchThrottle()]

    def visible_channels(self, values):
        rows = readable_channels(DepartmentChannel.objects.select_related("unit", "creator"),
            self.actor(), self.request.assignment.position.unit_id)
        if values.get("channel"):
            # Unavailable and nonexistent resources use the same read boundary.
            self.channel(values["channel"])
            rows = rows.filter(pk=values["channel"])
        if not values["archived"]:
            rows = rows.filter(archived_at__isnull=True)
        candidates = list(rows)
        policy = self.policy()
        policy.prime(candidates)
        readable = [row for row in candidates if policy.allows("slack.channel.read", row.unit, row.pk)]
        pages = [row.pk for row in readable if policy.allows("slack.page.read", row.unit, row.pk)]
        return [row.pk for row in readable], pages

    def visible_documents(self, values):
        """Apply current structural/Core ACLs before any text projection or count."""
        visible = Q(pk__in=[])
        if values["scope"] != "slack" and not values.get("channel") and values["kind"] != "page":
            chats = self.conversations()
            if values.get("conversation"):
                self.conversation(values["conversation"])
                chats = chats.filter(pk=values["conversation"])
            visible |= Q(direct__conversation__in=chats.values("pk"))
        if values["scope"] != "chat" and not values.get("conversation"):
            channel_ids, page_channels = self.visible_channels(values)
            visible |= Q(channel_message__channel_id__in=channel_ids) | Q(page__channel_id__in=page_channels)
        return SearchDocument.objects.filter(visible)

    def get(self, request):
        if any(len(request.query_params.getlist(key)) != 1 for key in request.query_params):
            raise ValidationError("No repitas los filtros de búsqueda.")
        form = SearchInput(data=request.query_params)
        form.is_valid(raise_exception=True)
        values = form.validated_data
        actor = self.actor()
        context = hashlib.sha256(json.dumps({
            **{key: str(value) for key, value in values.items() if key != "cursor"},
            "account": str(request.user.pk), "assignment": str(request.assignment.pk),
        }, sort_keys=True).encode()).hexdigest()
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
                raise ValidationError("La página de resultados caducó o pertenece a otra búsqueda. Vuelve a buscar.")

        rows = self.visible_documents(values).filter(created_at__lte=fence).annotate(
            saved=Exists(SavedItem.objects.filter(employee_id=actor, document_id=OuterRef("pk"))))
        if values["saved"]:
            rows = rows.filter(saved=True)
        if values["marked_unread"]:
            rows = rows.filter(reading_reminders__employee_id=actor)
        if values["threads"]:
            rows = rows.filter(channel_message__parent__isnull=True,
                channel_message__thread_subscriptions__employee_id=actor,
                channel_message__thread_subscriptions__following=True)
        if not values["archived"]:
            rows = rows.filter(Q(page__isnull=True) | Q(page__archived_at__isnull=True))
        if values["kind"] == "page":
            rows = rows.filter(page__isnull=False)
        elif values["kind"] != "all":
            media = Q(direct__media__isnull=False) | Q(channel_message__media__isnull=False)
            if values["kind"] == "text":
                rows = rows.filter(page__isnull=True).exclude(media)
            elif values["kind"] == "file":
                rows = rows.filter(media)
            else:
                rows = rows.filter(Q(direct__media__kind=values["kind"]) | Q(channel_message__media__kind=values["kind"]))
        if values.get("author"):
            rows = rows.filter(Q(direct__author_id=values["author"]) | Q(channel_message__author_id=values["author"]) |
                Q(page__creator_id=values["author"]))
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
                # Portable test/local fallback: same normalized whole-word AND,
                # not a different substring search disguised as PostgreSQL FTS.
                for term in values["q"].split():
                    rows = rows.filter(text__regex=r"\b" + re.escape(term) + r"\b")
        if position:
            rows = rows.filter(Q(created_at__lt=position[0]) | Q(created_at=position[0], pk__lt=position[1]))
        page = list(rows.select_related("direct__author", "direct__media", "direct__conversation__first_employee", "direct__conversation__second_employee",
            "channel_message__author", "channel_message__media", "channel_message__channel",
            "page__creator", "page__channel").order_by("-created_at", "-id")[:PAGE_SIZE + 1])
        next_cursor = None
        if len(page) > PAGE_SIZE:
            last = page[PAGE_SIZE - 1]
            next_cursor = signing.dumps({"context": context, "fence": fence.isoformat(),
                "time": last.created_at.isoformat(), "id": str(last.pk)}, salt=CURSOR_SALT, compress=True)
        # No global count, hidden names, Drive IDs or cached permission decisions.
        return Response({"results": [{**self.result(row, values["q"], actor), "saved": row.saved} for row in page[:PAGE_SIZE]],
            "next_cursor": next_cursor, "first_cursor": signing.dumps({"context": context, "fence": fence.isoformat()}, salt=CURSOR_SALT, compress=True),
            "ordering": "newest", "snapshot_at": fence})

    def result(self, document, query, actor):
        if document.page_id:
            page = document.page
            blocks = [row for row in page.blocks if row.get("type") != "task"]
            best = max(blocks, key=lambda row: sum(term in normalized_text(row.get("text", "")) for term in query.split()), default=None)
            if best and not any(term in normalized_text(best.get("text", "")) for term in query.split()):
                best = None
            return {"id": str(document.pk), "kind": "page", "source_id": str(page.pk),
                "title": page.title, "snippet": snippet(page_text(page), query), "created_at": page.created_at,
                "author": {"employee_id": str(page.creator_id), "name": page.creator.full_name},
                "channel": {"id": str(page.channel_id), "name": page.channel.name}, "media": None,
                "target": {"kind": "page", "channel_id": str(page.channel_id), "page_id": str(page.pk),
                    "block_id": best["id"] if best else None}}
        message = document.direct if document.direct_id else document.channel_message
        media = getattr(message, "media", None)
        from .media import media_data
        target = {"kind": "chat", "conversation_id": str(message.conversation_id), "message_id": str(message.pk)} if document.direct_id else {
            "kind": "channel", "channel_id": str(message.channel_id), "message_id": str(message.pk),
            "parent_id": str(message.parent_id) if message.parent_id else None}
        peer = None
        if document.direct_id:
            peer = message.conversation.second_employee if message.conversation.first_employee_id == actor else message.conversation.first_employee
        return {"id": str(document.pk), "kind": media.kind if media else "text", "source_id": str(message.pk),
            "title": media.filename if media and media.filename else {"audio":"Nota de voz", "image":"Imagen", "document":"Documento"}.get(media.kind, "Archivo") if media else "Mensaje",
            "snippet": snippet(message_text(message), query), "created_at": message.created_at,
            "author": {"employee_id": str(message.author_id), "name": message.author.full_name},
            "channel": {"id": str(message.channel_id), "name": message.channel.name} if not document.direct_id else None,
            "conversation": {"id": str(message.conversation_id), "peer": {"employee_id": str(peer.pk), "name": peer.full_name}} if peer else None,
            "media": media_data(message), "target": target}


class DirectMessageContextView(PrivateChatView):
    def get(self, request, conversation_id, message_id):
        conversation = self.conversation(conversation_id)
        anchor = get_object_or_404(conversation.messages, pk=message_id)
        before = Q(created_at__lt=anchor.created_at) | Q(created_at=anchor.created_at, pk__lt=anchor.pk)
        after = Q(created_at__gt=anchor.created_at) | Q(created_at=anchor.created_at, pk__gt=anchor.pk)
        rows = conversation.messages.select_related("media")
        older = list(rows.filter(before).order_by("-created_at", "-id")[:15])
        newer = list(rows.filter(after).order_by("created_at", "id")[:15])
        now = timezone.now()
        ordered = [*reversed(older), anchor, *newer]
        prime_saved(ordered, "direct", self.actor())
        prime_reactions(ordered, "direct", self.actor())
        prime_direct_mentions(ordered)
        return Response({"anchor_id": str(anchor.pk), "conversation": self.conversation_data(conversation),
            "results": [message_data(row, self.actor(), now) for row in ordered],
            "has_before": len(older) == 15, "has_after": len(newer) == 15, "server_now": now})


class ChannelMessageContextView(SlackView):
    def get(self, request, channel_id, message_id):
        channel = self.channel(channel_id)
        anchor = get_object_or_404(channel.messages.select_related("author__user_account", "media", "channel__unit"), pk=message_id)
        rows = channel.messages.filter(parent_id=anchor.parent_id).select_related("author__user_account", "media", "channel__unit")
        older = list(rows.filter(sequence__lt=anchor.sequence).order_by("-sequence")[:15])
        newer = list(rows.filter(sequence__gt=anchor.sequence).order_by("sequence")[:15])
        ordered = [*reversed(older), anchor, *newer]
        if anchor.parent_id:
            ordered.insert(0, channel.messages.select_related("author__user_account", "media", "channel__unit").get(pk=anchor.parent_id))
        from .page_content import prime_page_cards
        from .channel_tasks import TaskReferences
        prime_page_cards((row.page_id for row in ordered), channel, self.policy())
        self.policy().task_references = TaskReferences(request.assignment, request)
        self.policy().task_references.prime(row.task_id for row in ordered if row.task_id)
        prime_saved(ordered, "channel_message", self.actor())
        prime_reactions(ordered, "channel_message", self.actor())
        prime_thread_states(ordered, self.actor(), self.policy())
        prime_channel_mentions(ordered)
        return Response({"anchor_id": str(anchor.pk), "channel_id": str(channel.pk),
            "parent_id": str(anchor.parent_id) if anchor.parent_id else None,
            "results": [channel_message_data(row, self.actor(), self.policy()) for row in ordered],
            "has_before": len(older) == 15, "has_after": len(newer) == 15, "server_now": timezone.now()})
