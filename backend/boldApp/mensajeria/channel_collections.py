"""Channel-wide thread and pin catalogs; personal saves remain separate."""
from django.db import transaction
from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from .channel_events import publish_channel
from .channel_tasks import TaskReferences
from .channel_unread import thread_counts
from .channel_views import SlackView, ChannelMessagePages, channel_message_data
from .mentions import prime_channel_mentions
from .page_content import prime_page_cards
from .personal_data import prime_saved
from .reactions import prime_reactions
from .serializers import StrictInputSerializer
from .thread_following import prime_thread_states


class ThreadInput(StrictInputSerializer):
    title = serializers.CharField(max_length=120, allow_blank=True, default="")


class PinInput(StrictInputSerializer):
    pinned = serializers.BooleanField()


class ChannelThreadsView(SlackView):
    pins = False

    def get(self, request, channel_id):
        channel = self.channel(channel_id)
        rows = channel.messages.select_related("author__user_account", "channel__unit", "media", "parent").annotate(reply_count=Count("replies"))
        if self.pins:
            rows = rows.filter(pinned_at__isnull=False)
        else:
            rows = rows.filter(parent__isnull=True).filter(Q(thread_started_at__isnull=False) | Q(reply_count__gt=0))
            state = request.query_params.get("state", "all")
            if state not in ("all", "active", "closed", "deleted"):
                raise ValidationError("Vista de hilos no válida.")
            rows = rows.filter(thread_deleted_at__isnull=state != "deleted")
            if state in ("active", "closed"):
                rows = rows.filter(thread_closed_at__isnull=state == "active")
            if request.query_params.get("favorite") == "true":
                rows = rows.filter(thread_subscriptions__employee_id=self.actor(), thread_subscriptions__favorite=True)
        query = request.query_params.get("q", "").strip()
        if len(query) > 120:
            raise ValidationError("Busca con un máximo de 120 caracteres.")
        if query:
            rows = rows.filter(Q(thread_title__icontains=query) | Q(body__icontains=query))
        pages = ChannelMessagePages()
        if self.pins:
            pages.ordering = ("-pinned_at", "-id")
        page = pages.paginate_queryset(rows, request)
        policy = self.policy()
        prime_saved(page, "channel_message", self.actor())
        prime_reactions(page, "channel_message", self.actor())
        prime_channel_mentions(page)
        prime_thread_states(page, self.actor(), policy)
        policy.thread_counts = thread_counts([row.pk for row in page], self.actor())
        prime_page_cards((row.page_id for row in page if row.page_id), channel, policy)
        policy.task_references = TaskReferences(request.assignment, request)
        policy.task_references.prime(row.task_id for row in page if row.task_id)
        return pages.get_paginated_response([channel_message_data(row, self.actor(), policy) for row in page])


class ChannelPinsView(ChannelThreadsView):
    pins = True


class ChannelThreadStartView(SlackView):
    @transaction.atomic
    def put(self, request, channel_id, message_id):
        channel = self.channel(channel_id, lock=True)
        self.writable(channel)
        form = ThreadInput(data=request.data)
        form.is_valid(raise_exception=True)
        message = get_object_or_404(channel.messages.select_related("author__user_account", "channel__unit", "media").annotate(reply_count=Count("replies")), pk=message_id, parent__isnull=True)
        if message.thread_deleted_at:
            from .views import Conflict
            raise Conflict("El hilo está en Eliminados. Restáuralo antes de volver a abrirlo.")
        # First start wins. Retrying a lost response never renames another person's thread.
        if not message.thread_started_at:
            message.thread_title = form.validated_data["title"]
            message.thread_started_at = timezone.now()
            message.thread_starter_id = self.actor()
            message.version += 1
            message.save(update_fields=["thread_title", "thread_started_at", "thread_starter", "version"])
            publish_channel(channel, "thread.created")
        return Response({"message": channel_message_data(message, self.actor(), self.policy())})


class ChannelPinView(SlackView):
    @transaction.atomic
    def put(self, request, channel_id, message_id):
        channel = self.channel(channel_id, lock=True)
        self.writable(channel)
        self.policy().require("slack.channel.manage", channel.unit, channel.pk)
        form = PinInput(data=request.data)
        form.is_valid(raise_exception=True)
        message = get_object_or_404(channel.messages.select_related("author__user_account", "channel__unit", "media").annotate(reply_count=Count("replies")), pk=message_id)
        pinned = form.validated_data["pinned"]
        if pinned != bool(message.pinned_at):
            if pinned and channel.messages.filter(pinned_at__isnull=False).count() >= 50:
                raise ValidationError("Este canal tiene 50 mensajes fijados. Retira uno antes de fijar otro.")
            message.pinned_at = timezone.now() if pinned else None
            message.pinned_by_id = self.actor() if pinned else None
            message.version += 1
            message.save(update_fields=["pinned_at", "pinned_by", "version"])
            publish_channel(channel, "message.pinned")
        return Response({"message": channel_message_data(message, self.actor(), self.policy())})
