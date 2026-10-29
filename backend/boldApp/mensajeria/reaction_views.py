"""Explicit own-emoji set/remove, serialized with the existing source locks."""
import hashlib
import json
from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from .serializers import StrictInputSerializer
from .views import PrivateChatView, Conflict
from .channel_views import SlackView
from .models import SearchDocument, ReactionActorState, MessageReaction
from .reactions import CATALOG, CHOICES, MAX_OWN_REACTIONS, snapshots


class ReactionChange(StrictInputSerializer):
    key = serializers.ChoiceField(choices=[row[0] for row in CATALOG])
    active = serializers.BooleanField()
    version = serializers.IntegerField(min_value=0)
    client_id = serializers.UUIDField()


class ReactionMixin:
    def response(self, document, can_change):
        return Response({"reactions":snapshots([document], self.actor())[document.pk],
            "choices":CHOICES, "can_change":can_change, "max_own":MAX_OWN_REACTIONS})

    @transaction.atomic
    def get(self, request, **kwargs):
        document, can_change, _ = self.source(kwargs)
        return self.response(document, can_change)

    @transaction.atomic
    def put(self, request, **kwargs):
        form = ReactionChange(data=request.data)
        form.is_valid(raise_exception=True)
        document, can_change, publish = self.source(kwargs)
        if not can_change:
            raise PermissionDenied("No puedes modificar reacciones en este canal con tus permisos actuales, o está archivado.")
        values = form.validated_data
        actor, _ = ReactionActorState.objects.get_or_create(document=document, employee_id=self.actor())
        digest = hashlib.sha256(json.dumps({"key":values["key"], "active":values["active"]}, sort_keys=True).encode()).hexdigest()
        if actor.last_client_id == values["client_id"]:
            if actor.last_digest != digest:
                raise Conflict("Este intento ya corresponde a otra reacción.")
            return self.response(document, can_change)
        if actor.version != values["version"]:
            raise Conflict("Tus reacciones cambiaron en otro dispositivo. Actualiza antes de decidir de nuevo.")
        own = MessageReaction.objects.filter(document=document, employee_id=self.actor())
        reaction = own.filter(key=values["key"])
        changed = reaction.exists() != values["active"]
        if changed:
            if values["active"]:
                if own.count() >= MAX_OWN_REACTIONS:
                    raise ValidationError({"detail":"Puedes añadir hasta ocho reacciones distintas por mensaje. Quita alguna antes de añadir otra."})
                MessageReaction.objects.create(document=document, employee_id=self.actor(), key=values["key"])
            else:
                reaction.delete()
            document.reaction_version += 1
            document.save(update_fields=["reaction_version"])
            actor.version = document.reaction_version
        actor.last_client_id, actor.last_digest = values["client_id"], digest
        actor.save()
        if changed:
            publish()
        return self.response(document, can_change)


class DirectReactionView(ReactionMixin, PrivateChatView):
    def source(self, values):
        from .events import publish_change
        conversation = self.conversation(values["conversation_id"], lock=True)
        message = get_object_or_404(conversation.messages, pk=values["message_id"])
        document = get_object_or_404(SearchDocument.objects.select_for_update(), direct=message)
        return document, True, lambda:publish_change(conversation, "reactions.updated", [message.pk])


class ChannelReactionView(ReactionMixin, SlackView):
    def source(self, values):
        from .channel_events import publish_channel
        channel = self.channel(values["channel_id"], lock=True)
        message = get_object_or_404(channel.messages, pk=values["message_id"])
        document = get_object_or_404(SearchDocument.objects.select_for_update(), channel_message=message)
        allowed = not channel.archived_at and self.policy().allows("slack.reaction.create", channel.unit, channel.pk)
        return document, allowed, lambda:publish_channel(channel, "reactions.updated")
