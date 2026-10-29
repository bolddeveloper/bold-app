"""ACL-gated keys for local encrypted drafts; not an offline authorization token.

The key is never persisted by BOLD's client. Reopening a draft requires a fresh
authenticated request for its exact resource and active assignment.
"""
import base64
import hashlib
import hmac
import json

from django.conf import settings
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.response import Response

from .channel_views import SlackView
from .models import ChannelAccessEpoch
from .serializers import StrictInputSerializer


class DraftScope(StrictInputSerializer):
    kind = serializers.ChoiceField(choices=("conversation", "conversation-forward", "channel", "channel-automations", "page", "page-discussion", "message-task", "message-agreement"))
    resource_id = serializers.UUIDField()
    channel_id = serializers.UUIDField(required=False)
    parent_id = serializers.UUIDField(required=False)
    container_id = serializers.UUIDField(required=False)
    source_kind = serializers.ChoiceField(choices=("chat", "channel"), required=False)
    mode = serializers.ChoiceField(choices=('root','reply','edit'),required=False)

    def validate(self, values):
        kind = values["kind"]
        if (kind in ("page", "page-discussion")) != ("channel_id" in values):
            raise serializers.ValidationError("Indica el canal solo para un borrador de página.")
        if "parent_id" in values and kind not in ("channel", "page-discussion"):
            raise serializers.ValidationError("El hilo solo corresponde a un borrador de canal.")
        if kind=='page-discussion':
            if 'mode' not in values or 'parent_id' not in values:
                raise serializers.ValidationError('El borrador de comentario requiere su bloque, hilo o comentario y el modo.')
        elif 'mode' in values:
            raise serializers.ValidationError('El modo solo corresponde a un borrador de comentario de página.')
        if kind == "message-task":
            if "container_id" not in values or "source_kind" not in values:
                raise serializers.ValidationError("La revisión de tarea requiere el mensaje y su conversación de origen.")
        elif kind == "message-agreement":
            if 'source_kind' not in values or 'container_id' in values:
                raise serializers.ValidationError('La revisión de acuerdos requiere su conversación y tipo de origen.')
        elif "container_id" in values or "source_kind" in values:
            raise serializers.ValidationError("El contenedor de conversión solo corresponde a una revisión de tarea.")
        return values


class DraftGrantView(SlackView):
    def post(self, request):
        form = DraftScope(data=request.data)
        form.is_valid(raise_exception=True)
        scope = {name: str(value) for name, value in form.validated_data.items()}
        kind, identity = scope["kind"], scope["resource_id"]
        if kind=='page-discussion':
            from .page_discussions import discussion_draft
            can_write=discussion_draft(self,scope)
        elif kind == "message-agreement":
            from .agreements import source_parent
            source_parent(self, scope['source_kind'], identity)
            # Only one's private local review. Page creation separately checks
            # every source and the destination's current read/create permission.
            can_write = True
        elif kind == "message-task":
            from .task_conversions import source_document
            source_document(self, {"kind":scope["source_kind"], "container_id":scope["container_id"], "message_id":identity})
            # Permission to edit one's local review, NOT to create a Task. The
            # target project and Task permissions are rechecked on every POST.
            can_write = True
        elif kind in ("conversation", "conversation-forward"):
            self.conversation(identity)
            can_write = True
        else:
            channel = self.channel(scope.get("channel_id", identity))
            if kind == 'channel-automations':
                from rest_framework.exceptions import PermissionDenied
                if not settings.MESSAGING_AUTOMATIONS_ENABLED:
                    raise PermissionDenied('Las automatizaciones no están habilitadas en este entorno.')
                self.policy().require('slack.automation.read', channel.unit, channel.pk)
                can_write = not channel.archived_at and self.policy().allows('slack.automation.manage', channel.unit, channel.pk)
            elif kind == "page":
                self.policy().require("slack.page.read", channel.unit, channel.pk)
                page = get_object_or_404(channel.pages, pk=identity)
                can_write = not channel.archived_at and not page.archived_at and self.policy().allows("slack.page.update", channel.unit, channel.pk)
            else:
                if scope.get("parent_id"):
                    get_object_or_404(channel.messages, pk=scope["parent_id"], parent__isnull=True)
                can_write = not channel.archived_at and self.policy().allows("slack.message.create", channel.unit, channel.pk)

        scope.update(account_id=str(request.user.pk), assignment_id=str(request.assignment.pk))
        revision = ChannelAccessEpoch.objects.filter(employee_id=request.assignment.employee_id).values_list("revision", flat=True).first() or 0
        context = json.dumps({"scope": scope, "credentials": request.user.credentials_version,
                              "access": revision, "version": 1}, sort_keys=True, separators=(",", ":")).encode()
        secret = (getattr(settings, "AUTH_ENCRYPTION_KEY", "") or "").strip()
        if not secret:
            if not settings.DEBUG:
                raise RuntimeError("AUTH_ENCRYPTION_KEY es obligatoria para recuperar borradores.")
            secret = settings.SECRET_KEY + ":drafts-debug-only"
        key = hmac.new(secret.encode(), b"bold-local-draft-v1\0" + context, hashlib.sha256).digest()
        return Response({"scope": scope, "key": base64.b64encode(key).decode(),
                         "key_id": hashlib.sha256(key).hexdigest()[:32], "can_write": bool(can_write),
                         "retention_seconds": 7 * 86400})
