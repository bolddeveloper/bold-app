import hashlib
import json
import uuid
from datetime import timedelta

from django.db import transaction
from django.db.models import Count, Max
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from boldApp.core.models import Employee
from .channel_events import publish_channel
from .channel_notifications import mark_channel_notices_read, mark_unfollowed_notices_read
from .channel_views import FollowChannel, SlackView, channel_data, channel_message_data
from .models import ChannelThreadSubscription, ChannelThreadReadState, ChannelSubscription, ReadingReminder
from .thread_following import preference_data, thread_states
from .thread_lifecycle import thread_permissions
from .serializers import StrictInputSerializer
from .views import Conflict

MAX_FOLLOWED_THREADS = 500


class ThreadFollowView(SlackView):
    def root(self, channel, message_id):
        return get_object_or_404(channel.messages, pk=message_id, parent__isnull=True)

    def get(self, request, channel_id, message_id):
        channel = self.channel(channel_id)
        parent = self.root(channel, message_id)
        return Response(thread_states([parent.pk], self.actor())[str(parent.pk)])

    @transaction.atomic
    def put(self, request, channel_id, message_id):
        channel = self.channel(channel_id, lock=True)
        parent = self.root(channel, message_id)
        form = FollowChannel(data=request.data)
        form.is_valid(raise_exception=True)
        Employee.objects.select_for_update().get(pk=self.actor())
        following = form.validated_data["following"]
        subscription = ChannelThreadSubscription.objects.filter(parent=parent, employee_id=self.actor()).first()
        if subscription is None and not following:
            return Response(preference_data(parent_id=parent.pk))
        if subscription is None:
            subscription, _ = ChannelThreadSubscription.objects.get_or_create(parent=parent, employee_id=self.actor())
        if subscription.following != following or (following and subscription.left):
            if following and ChannelThreadSubscription.objects.filter(employee_id=self.actor(), following=True).count() >= MAX_FOLLOWED_THREADS:
                raise ValidationError("Puedes seguir hasta 500 hilos. Deja de seguir alguno antes de añadir otro.")
            subscription.following = following
            if following:
                subscription.left = False
            subscription.revision += 1
            subscription.save(update_fields=["following", "left", "revision", "updated_at"])
            if not following:
                mark_unfollowed_notices_read(channel.pk, self.actor())
            publish_channel(channel, "thread.state.changed", self.actor())
        return Response(preference_data(subscription))


class ThreadChange(StrictInputSerializer):
    version = serializers.IntegerField(min_value=1)
    action = serializers.ChoiceField(choices=["close", "open", "lock", "unlock", "rename", "delete", "restore"])
    title = serializers.CharField(max_length=120, required=False)


class ThreadManageView(ThreadFollowView):
    @transaction.atomic
    def patch(self, request, channel_id, message_id):
        channel = self.channel(channel_id, lock=True)
        form = ThreadChange(data=request.data)
        form.is_valid(raise_exception=True)
        values = form.validated_data
        parent = get_object_or_404(channel.messages.select_related("author__user_account", "channel__unit", "media")
            .annotate(reply_count=Count("replies")), pk=message_id, parent__isnull=True)
        rights = thread_permissions(parent, self.policy())
        action = values["action"]
        permission = "can_manage_thread" if action in ("lock", "unlock", "delete", "restore") else "can_edit_thread" if action == "rename" else "can_close_thread"
        if not rights[permission]:
            raise PermissionDenied("No tienes permiso para modificar este hilo.")
        if parent.thread_deleted_at and action not in ("restore", "delete"):
            raise Conflict("Restaura el hilo antes de modificarlo.")
        if action == "rename" and not values.get("title"):
            raise ValidationError({"title": "Escribe el nombre del hilo."})
        now = timezone.now()
        updates = {"close": {"thread_closed_at": parent.thread_closed_at or now},
            "open": {"thread_closed_at": None}, "lock": {"thread_locked": True, "thread_closed_at": parent.thread_closed_at or now},
            "unlock": {"thread_locked": False}, "rename": {"thread_title": values.get("title")},
            "delete": {"thread_deleted_at": parent.thread_deleted_at or now, "thread_closed_at": parent.thread_closed_at or now},
            "restore": {"thread_deleted_at": None}}[action]
        if action == "open" and parent.thread_locked:
            raise Conflict("Desbloquea el hilo antes de abrirlo.")
        if not parent.thread_started_at:
            updates.update(thread_started_at=now, thread_starter_id=self.actor())
        if any(getattr(parent, key) != value for key, value in updates.items()):
            if parent.version != values["version"]:
                raise Conflict("El hilo cambió. Actualiza sus datos antes de reintentar.")
            for key, value in updates.items():
                setattr(parent, key, value)
            parent.version += 1
            parent.save(update_fields=[*updates, "version"])
            publish_channel(channel, "thread.updated")
        return Response({"message": channel_message_data(parent, self.actor(), self.policy())})


class ThreadPreference(StrictInputSerializer):
    version = serializers.IntegerField(min_value=0)
    client_id = serializers.UUIDField()
    favorite = serializers.BooleanField(required=False)
    left = serializers.BooleanField(required=False)
    notifications = serializers.ChoiceField(choices=["inherit", "all", "mentions", "none"], required=False)
    mute = serializers.ChoiceField(choices=["off", "15m", "1h", "3h", "8h", "24h", "forever"], required=False)


class ThreadPreferenceView(ThreadFollowView):
    @transaction.atomic
    def put(self, request, channel_id, message_id):
        channel = self.channel(channel_id, lock=True)
        parent = self.root(channel, message_id)
        form = ThreadPreference(data=request.data)
        form.is_valid(raise_exception=True)
        values = form.validated_data
        digest = hashlib.sha256(json.dumps({key: value for key, value in values.items() if key not in ("version", "client_id")}, sort_keys=True).encode()).hexdigest()
        Employee.objects.select_for_update().get(pk=self.actor())
        row, _ = ChannelThreadSubscription.objects.get_or_create(parent=parent, employee_id=self.actor())
        if row.last_client_id == values["client_id"]:
            if row.last_digest != digest:
                raise Conflict("Este intento ya corresponde a otro ajuste.")
            return Response(preference_data(row))
        if row.revision != values["version"]:
            raise Conflict("Tus ajustes cambiaron en otra ventana. Actualiza antes de reintentar.")
        if "favorite" in values:
            if values["favorite"] and not row.favorite and ChannelThreadSubscription.objects.filter(employee_id=self.actor(), favorite=True).count() >= 500:
                raise ValidationError("Puedes guardar hasta 500 hilos favoritos.")
            row.favorite = values["favorite"]
        if "notifications" in values:
            row.notification_level = values["notifications"]
            if row.notification_level in ("all", "mentions"):
                if not row.following and ChannelThreadSubscription.objects.filter(employee_id=self.actor(), following=True).count() >= MAX_FOLLOWED_THREADS:
                    raise ValidationError("Puedes seguir hasta 500 hilos.")
                row.following, row.left = True, False
        if "mute" in values:
            durations = {"15m": 15, "1h": 60, "3h": 180, "8h": 480, "24h": 1440}
            row.muted_forever = values["mute"] == "forever"
            row.muted_until = timezone.now() + timedelta(minutes=durations[values["mute"]]) if values["mute"] in durations else None
        if "left" in values:
            row.left = values["left"]
            if row.left:
                row.following = False
            elif not row.following:
                if ChannelThreadSubscription.objects.filter(employee_id=self.actor(), following=True).count() >= MAX_FOLLOWED_THREADS:
                    raise ValidationError("Puedes seguir hasta 500 hilos.")
                row.following = True
        row.revision += 1
        row.last_client_id, row.last_digest = values["client_id"], digest
        row.save()
        publish_channel(channel, "thread.state.changed", self.actor())
        return Response(preference_data(row))


class ThreadReadView(ThreadFollowView):
    @transaction.atomic
    def post(self, request, channel_id, message_id):
        channel = self.channel(channel_id, lock=True)
        parent = self.root(channel, message_id)
        sequence = parent.replies.aggregate(latest=Max("sequence"))["latest"] or 0
        state, _ = ChannelThreadReadState.objects.get_or_create(parent=parent, employee_id=self.actor())
        if sequence > state.sequence:
            state.sequence = sequence
            state.save(update_fields=["sequence", "updated_at"])
            subscription, _ = ChannelSubscription.objects.get_or_create(channel=channel, employee_id=self.actor())
            subscription.revision += 1
            subscription.save(update_fields=["revision", "updated_at"])
            publish_channel(channel, "state.changed", self.actor())
        mark_channel_notices_read(channel.pk, self.actor(), sequence=sequence, parent_id=parent.pk)
        Employee.objects.select_for_update().get(pk=self.actor())
        reminder = ReadingReminder.objects.filter(employee_id=self.actor(), scope_key="thread:" + str(parent.pk)).first()
        if reminder and reminder.document_id:
            from .reading_views import change
            change(reminder, {"version": reminder.version, "client_id": uuid.uuid4()}, None)
        parent.reply_count = parent.replies.count()
        return Response({"message": channel_message_data(parent, self.actor(), self.policy()), "channel": channel_data(channel, self.policy())})
