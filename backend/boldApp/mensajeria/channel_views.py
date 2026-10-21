"""Slack's initial contract: departments, channels, messages and one-level threads."""
import hashlib
import json
import re

from django.db import IntegrityError, transaction
from django.db.models import Count
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.pagination import CursorPagination
from rest_framework.response import Response

from boldApp.core.models import OrganizationalUnit, Permission
from .channel_access import ChannelPolicy
from .channel_events import publish_channel
from .channel_tasks import TaskReferences
from .channel_media import store_channel_media
from .channel_unread import channel_states, thread_counts, unread_messages
from .channel_notifications import notify_channel_message, mark_channel_notices_read
from .media import BoundedUpload, MAX_BYTES, media_data, prepare, private_media_response
from .models import DepartmentChannel, ChannelAccessRule, ChannelMessage, ChannelReadState, ChannelSubscription, ChannelThreadReadState
from .serializers import StrictInputSerializer, EditMessageSerializer
from .views import PrivateChatView, Conflict


class CreateChannel(StrictInputSerializer):
    unit_id = serializers.UUIDField(required=False, allow_null=True, default=None)
    name = serializers.CharField(max_length=80)
    description = serializers.CharField(max_length=500, allow_blank=True, default="")
    visibility = serializers.ChoiceField(choices=["public", "department", "private"], default="public")
    members = serializers.ListField(child=serializers.DictField(), max_length=200, required=False, default=list)


class UpdateChannel(StrictInputSerializer):
    name = serializers.CharField(max_length=80, required=False)
    description = serializers.CharField(max_length=500, allow_blank=True, required=False)
    archived = serializers.BooleanField(required=False)
    version = serializers.IntegerField(min_value=1)

    def validate(self, data):
        if len(data) < 2:
            raise serializers.ValidationError("Indica qué deseas modificar.")
        return data


class SendChannelMessage(StrictInputSerializer):
    client_id = serializers.UUIDField()
    body = serializers.CharField(max_length=5000, allow_blank=True)
    parent_id = serializers.UUIDField(required=False, allow_null=True, default=None)
    task_id = serializers.UUIDField(required=False, allow_null=True, default=None)
    file = serializers.FileField(required=False, max_length=200)

    def validate(self, data):
        if not data["body"] and data["task_id"] is None and not data.get("file"):
            raise serializers.ValidationError("Escribe un mensaje, selecciona una tarea o adjunta una imagen o nota de voz.")
        return data


class ReadChannel(StrictInputSerializer):
    message_id = serializers.UUIDField()


class FollowChannel(StrictInputSerializer):
    following = serializers.BooleanField()


class ChannelPages(CursorPagination):
    page_size = 50
    ordering = ("name", "id")


class ChannelMessagePages(CursorPagination):
    page_size = 50
    ordering = "-sequence"


def department_data(unit):
    if unit is None:
        return None
    # Existing organizational colors are honored only when they are valid CSS
    # hex colors. A stable palette gives unconfigured departments distinct tags.
    palette = ("#4760A8", "#9250A3", "#287065", "#A14B30", "#A32D50", "#59602B")
    color = unit.color_hex if re.fullmatch(r"#[0-9a-fA-F]{6}", unit.color_hex or "") else palette[unit.pk.int % len(palette)]
    return {"id": str(unit.pk), "name": unit.name, "color": color}


def channel_data(channel, policy):
    if not hasattr(policy, "channel_states"):
        policy.channel_states = {}
    if str(channel.pk) not in policy.channel_states:
        policy.channel_states.update(channel_states([channel], policy.assignment.employee_id))
    return {"id": str(channel.pk), "name": channel.name, "description": channel.description,
            "department": department_data(channel.unit), "archived_at": channel.archived_at,
            "visibility": channel.visibility,
            "version": channel.version, "activity_version": channel.activity_version,
            "created_at": channel.created_at, "updated_at": channel.updated_at,
            "can_manage": policy.allows("slack.channel.manage", channel.unit, channel.pk),
            "can_manage_access": policy.allows("slack.channel.access", channel.unit, channel.pk),
            "can_send": not channel.archived_at and policy.allows("slack.message.create", channel.unit, channel.pk),
            **policy.channel_states[str(channel.pk)]}


def channel_message_data(message, actor_id, policy):
    account = getattr(message.author, "user_account", None)
    if message.task_id and not hasattr(policy, "task_references"):
        policy.task_references = TaskReferences(policy.assignment, policy.request)
    return {"id": str(message.pk), "channel_id": str(message.channel_id), "client_id": str(message.client_id),
            "sequence": message.sequence, "body": message.body, "parent_id": str(message.parent_id) if message.parent_id else None,
            "task": policy.task_references.data(message.task_id) if message.task_id else None,
            "media": media_data(message),
            "author": {"employee_id": str(message.author_id), "name": message.author.full_name,
                       "avatar_url": account.avatar_url if account else None},
            "department": {"name": message.department_name, "color": message.department_color},
            "created_at": message.created_at, "edited_at": message.edited_at, "version": message.version,
            "editable_until": message.editable_until, "reply_count": getattr(message, "reply_count", 0),
            "unread_reply_count": getattr(policy, "thread_counts", {}).get(str(message.pk), 0),
            "can_edit": not message.channel.archived_at and message.author_id == actor_id and timezone.now() < message.editable_until
                        and policy.allows("slack.message.update", message.channel.unit, message.channel_id)}


class SlackView(PrivateChatView):
    def policy(self):
        if not hasattr(self, "_channel_policy"):
            self._channel_policy = ChannelPolicy(self.request.assignment, self.request)
        return self._channel_policy

    def channel(self, channel_id, *, lock=False):
        rows = DepartmentChannel.objects.select_related("unit", "creator")
        if lock:
            rows = rows.select_for_update(of=("self",))
        channel = get_object_or_404(rows, pk=channel_id)
        self.policy().prime([channel])
        if not self.policy().allows("slack.channel.read", channel.unit, channel.pk):
            raise NotFound("Este canal no está disponible para tu asignación activa.")
        return channel

    def writable(self, channel):
        self.policy().require("slack.message.create", channel.unit, channel.pk)
        if channel.archived_at:
            raise Conflict("El canal está archivado. Su historial sigue disponible, pero no admite mensajes nuevos.")


class DepartmentListView(SlackView):
    def get(self, request):
        policy = self.policy()
        units = OrganizationalUnit.objects.order_by("name", "id")[:200]
        return Response({"can_create_independent": policy.allows("slack.channel.read", None) and policy.allows("slack.channel.create", None), "results": [{**department_data(unit), "can_create": policy.allows("slack.channel.create", unit)}
            for unit in units if policy.allows("slack.channel.read", unit)]})


class ChannelListView(SlackView):
    def get(self, request):
        from .channel_acl import readable_channels
        rows = readable_channels(DepartmentChannel.objects.select_related("unit", "creator"), self.actor(), request.assignment.position.unit_id)
        if request.query_params.get("archived") != "true":
            rows = rows.filter(archived_at__isnull=True)
        unit = request.query_params.get("unit")
        if unit == "independent":
            rows = rows.filter(unit__isnull=True)
        elif unit:
            try:
                unit = serializers.UUIDField().run_validation(unit)
            except serializers.ValidationError:
                raise ValidationError("Departamento no válido.")
            rows = rows.filter(unit_id=unit)
        policy = self.policy()
        candidates = list(rows)
        policy.prime(candidates)
        # Apply both the structural boundary and Core restrictions BEFORE the
        # cursor is formed. A cursor must not encode a hidden channel's name.
        visible = [row.pk for row in candidates if policy.allows("slack.channel.read", row.unit, row.pk)]
        pages = ChannelPages()
        page = pages.paginate_queryset(rows.filter(pk__in=visible), request)
        policy.channel_states = channel_states(page, self.actor())
        return pages.get_paginated_response([channel_data(row, policy) for row in page])

    @transaction.atomic
    def post(self, request):
        form = CreateChannel(data=request.data)
        form.is_valid(raise_exception=True)
        values = form.validated_data
        unit = get_object_or_404(OrganizationalUnit.objects.select_for_update(), pk=values["unit_id"]) if values["unit_id"] else None
        self.policy().require("slack.channel.read", unit)
        self.policy().require("slack.channel.create", unit)
        from .channel_access_views import AccessMember, validate_access
        member_form = AccessMember(data=values["members"], many=True)
        member_form.is_valid(raise_exception=True)
        members = member_form.validated_data
        if values["visibility"] == "private" and not any(row["employee_id"] == self.actor() for row in members):
            members.append({"employee_id": self.actor(), "access": "write"})
        if len(members) > 200:
            raise ValidationError({"members": "El límite es de 200 personas, incluido el creador."})
        validate_access(values["visibility"], members, values["unit_id"])
        if unit is None:
            # Serialize the independent namespace across active departments,
            # including its bounded count; NULL cannot be locked as a unit.
            Permission.objects.select_for_update().get(code="slack.channel.create")
        if DepartmentChannel.objects.filter(unit=unit).count() >= 200:
            raise ValidationError("Este grupo alcanzó el límite inicial de 200 canales, incluidos los archivados.")
        try:
            with transaction.atomic():
                channel = DepartmentChannel.objects.create(unit=unit, name=values["name"], description=values["description"], visibility=values["visibility"], creator=request.assignment)
                ChannelAccessRule.objects.bulk_create([ChannelAccessRule(channel=channel, **row) for row in members])
        except IntegrityError:
            raise Conflict("Ya existe un canal con ese nombre en este grupo, posiblemente archivado.")
        publish_channel(channel, "channel.created")
        if not self.policy().allows("slack.channel.read", channel.unit, channel.pk):
            return Response({"id": str(channel.pk), "name": channel.name, "visibility": channel.visibility,
                "version": channel.version, "access_only": True}, status=201)
        return Response(channel_data(channel, self.policy()), status=201)


class ChannelDetailView(SlackView):
    def get(self, request, channel_id):
        return Response(channel_data(self.channel(channel_id), self.policy()))

    @transaction.atomic
    def patch(self, request, channel_id):
        channel = self.channel(channel_id, lock=True)
        self.policy().require("slack.channel.manage", channel.unit, channel.pk)
        form = UpdateChannel(data=request.data)
        form.is_valid(raise_exception=True)
        values = form.validated_data
        if values["version"] != channel.version:
            raise Conflict("Otro empleado modificó el canal. Actualízalo antes de volver a guardar.")
        for key in ("name", "description"):
            if key in values:
                setattr(channel, key, values[key])
        if "archived" in values:
            channel.archived_at = (channel.archived_at or timezone.now()) if values["archived"] else None
        channel.version += 1
        channel.updated_at = timezone.now()
        try:
            with transaction.atomic():
                channel.save(update_fields=["name", "description", "archived_at", "version", "updated_at"])
        except IntegrityError:
            raise Conflict("Ya existe un canal con ese nombre en el departamento.")
        publish_channel(channel, "channel.updated")
        return Response(channel_data(channel, self.policy()))


class ChannelMessageListView(SlackView):
    def initialize_request(self, request, *args, **kwargs):
        if request.method == "POST":
            request.upload_handlers.insert(0, BoundedUpload(request))
        return super().initialize_request(request, *args, **kwargs)

    def get(self, request, channel_id):
        channel = self.channel(channel_id)
        rows = channel.messages.select_related("author__user_account", "channel__unit", "media").annotate(reply_count=Count("replies"))
        parent_id = request.query_params.get("parent")
        if parent_id:
            try:
                parent_id = serializers.UUIDField().run_validation(parent_id)
            except serializers.ValidationError:
                raise ValidationError("Hilo no válido.")
            get_object_or_404(channel.messages, pk=parent_id, parent__isnull=True)
            rows = rows.filter(parent_id=parent_id)
        else:
            rows = rows.filter(parent__isnull=True)
        pages = ChannelMessagePages()
        page = pages.paginate_queryset(rows, request)
        self.policy().thread_counts = thread_counts([row.pk for row in page], self.actor()) if not parent_id else {}
        if any(row.task_id for row in page):
            self.policy().task_references = TaskReferences(request.assignment, request)
            self.policy().task_references.prime(row.task_id for row in page)
        response = pages.get_paginated_response([channel_message_data(row, self.actor(), self.policy()) for row in page])
        response.data["channel"] = channel_data(channel, self.policy())
        response.data["server_now"] = timezone.now()
        return response

    @transaction.atomic
    def post(self, request, channel_id):
        channel = self.channel(channel_id, lock=True)
        self.writable(channel)
        length = request.META.get("CONTENT_LENGTH", "")
        if length.isdigit() and int(length) > MAX_BYTES + 65536:
            raise ValidationError("El mensaje supera el tamaño permitido de 10 MB.")
        form = SendChannelMessage(data=request.data)
        form.is_valid(raise_exception=True)
        values = form.validated_data
        prepared = prepare(values["file"]) if values.get("file") else None
        parent = get_object_or_404(channel.messages, pk=values["parent_id"], parent__isnull=True) if values["parent_id"] else None
        payload = {"body": values["body"], "parent": str(parent.pk) if parent else None}
        if values["task_id"] is not None:
            # Keep the historical digest for text-only retries unchanged.
            payload["task"] = str(values["task_id"])
        if prepared:
            payload["media"] = prepared["digest"]
        digest = hashlib.sha256(json.dumps(payload,
                                          sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        old = channel.messages.select_related("author__user_account", "channel__unit", "media").filter(author_id=self.actor(), client_id=values["client_id"]).first()
        if old:
            if old.payload_digest != digest:
                raise Conflict("Este envío ya existe con otro contenido. No se ha duplicado.")
            return Response({"message": channel_message_data(old, self.actor(), self.policy())})
        if values["task_id"] is not None:
            TaskReferences(request.assignment, request).require(values["task_id"])
        department = department_data(request.assignment.position.unit)
        channel.activity_version += 1
        message = ChannelMessage.objects.create(channel=channel, author_id=self.actor(), author_assignment=request.assignment,
            department_name=department["name"], department_color=department["color"], sequence=channel.activity_version,
            body=values["body"], task_id=values["task_id"], parent=parent, client_id=values["client_id"], payload_digest=digest)
        if prepared:
            store_channel_media(message, prepared)
        channel.updated_at = message.created_at
        channel.save(update_fields=["activity_version", "updated_at"])
        notify_channel_message(message, request.assignment)
        publish_channel(channel, "message.created")
        return Response({"message": channel_message_data(message, self.actor(), self.policy())}, status=201)


class ChannelMessageDetailView(SlackView):
    def get(self, request, channel_id, message_id):
        channel = self.channel(channel_id)
        message = get_object_or_404(channel.messages.select_related("author__user_account", "channel__unit", "media").annotate(reply_count=Count("replies")), pk=message_id)
        self.policy().thread_counts = thread_counts([message.pk], self.actor())
        return Response({"message": channel_message_data(message, self.actor(), self.policy())})

    @transaction.atomic
    def patch(self, request, channel_id, message_id):
        channel = self.channel(channel_id, lock=True)
        if channel.archived_at:
            raise Conflict("El canal está archivado.")
        self.policy().require("slack.message.update", channel.unit, channel.pk)
        message = get_object_or_404(channel.messages.select_related("author__user_account", "channel__unit", "media"), pk=message_id)
        from rest_framework.exceptions import PermissionDenied
        if message.author_id != self.actor() or timezone.now() >= message.editable_until:
            raise PermissionDenied("Solo puedes editar tus propios mensajes durante los primeros diez minutos.")
        form = EditMessageSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        if not form.validated_data["body"] and message.task_id is None and not hasattr(message, "media"):
            raise ValidationError("El mensaje no puede quedar vacío.")
        if form.validated_data["version"] != message.version:
            raise Conflict()
        if form.validated_data["body"] != message.body:
            message.body = form.validated_data["body"]
            message.version += 1
            message.edited_at = timezone.now()
            message.save(update_fields=["body", "version", "edited_at"])
            publish_channel(channel, "message.updated")
        return Response({"message": channel_message_data(message, self.actor(), self.policy())})


class ChannelReadView(SlackView):
    @transaction.atomic
    def post(self, request, channel_id):
        channel = self.channel(channel_id, lock=True)
        form = ReadChannel(data=request.data)
        form.is_valid(raise_exception=True)
        message = get_object_or_404(channel.messages, pk=form.validated_data["message_id"])
        if message.parent_id:
            state, _ = ChannelThreadReadState.objects.get_or_create(parent_id=message.parent_id, employee_id=self.actor())
        else:
            state, _ = ChannelReadState.objects.get_or_create(channel=channel, employee_id=self.actor())
        if message.sequence > state.sequence:
            state.sequence = message.sequence
            state.save(update_fields=["sequence", "updated_at"])
            subscription,_=ChannelSubscription.objects.get_or_create(channel=channel,employee_id=self.actor())
            subscription.revision+=1
            subscription.save(update_fields=["revision","updated_at"])
            mark_channel_notices_read(channel.pk, self.actor(), sequence=state.sequence, parent_id=message.parent_id)
            publish_channel(channel, "state.changed", self.actor())
        return Response({"channel_id": str(channel.pk), "parent_id": str(message.parent_id) if message.parent_id else None, "read_sequence": state.sequence, "channel":channel_data(channel,self.policy())})


class ChannelFollowView(SlackView):
    @transaction.atomic
    def put(self, request, channel_id):
        channel = self.channel(channel_id, lock=True)
        form = FollowChannel(data=request.data)
        form.is_valid(raise_exception=True)
        subscription, _ = ChannelSubscription.objects.get_or_create(channel=channel, employee_id=self.actor())
        if subscription.following != form.validated_data["following"]:
            subscription.following = form.validated_data["following"]
            subscription.revision += 1
            subscription.save(update_fields=["following", "revision", "updated_at"])
            if not subscription.following:
                mark_channel_notices_read(channel.pk, self.actor())
            publish_channel(channel, "state.changed", self.actor())
        return Response(channel_data(channel, self.policy()))


class ChannelUnreadView(SlackView):
    def get(self, request):
        counts = {row["channel_id"]:row["total"] for row in unread_messages(self.actor()).filter(channel__archived_at__isnull=True)
            .order_by().values("channel_id").annotate(total=Count("pk"))}
        total = 0
        visible_count = 0
        results = {}
        # Count only currently readable channels; a permission revocation must
        # not leak even its hidden unread count. The wire projection is bounded.
        for channel in DepartmentChannel.objects.select_related("unit").filter(pk__in=counts).order_by("pk").iterator(chunk_size=200):
            if self.policy().allows("slack.channel.read", channel.unit, channel.pk):
                visible_count += 1
                total += counts[channel.pk]
                if len(results)<200:
                    results[str(channel.pk)] = counts[channel.pk]
        return Response({"total": total, "by_channel": results, "truncated": visible_count>len(results)})


class ChannelMediaView(SlackView):
    def get(self, request, channel_id, message_id):
        channel = self.channel(channel_id)
        message = get_object_or_404(channel.messages.select_related("media__root__user"), pk=message_id)
        media = getattr(message, "media", None)
        if media is None:
            raise NotFound("Este mensaje no contiene un archivo.")
        return private_media_response(media)


class ChannelTaskSearchView(SlackView):
    def get(self, request, channel_id):
        channel = self.channel(channel_id)
        self.writable(channel)
        query = request.query_params.get("q", "").strip()
        if not 2 <= len(query) <= 120:
            raise ValidationError("Busca una tarea con entre 2 y 120 caracteres.")
        # Reuse the Tasks module's authoritative visibility pipeline, including
        # explicit cross-department membership, resource grants and current MFA.
        from boldApp.tareas.views import AssignmentScopedViewSetMixin
        from boldApp.tareas.models import Task
        scope = AssignmentScopedViewSetMixin()
        scope.request = request
        rows = scope.visible_tasks(Task.objects.filter(title__icontains=query)).select_related("status").order_by("-updated_at", "-id")
        class TaskPages(CursorPagination):
            page_size = 25
            ordering = ("-updated_at", "-id")
        pages = TaskPages()
        page = pages.paginate_queryset(rows, request)
        return pages.get_paginated_response([{"id": str(task.pk), "title": task.title, "status": task.status.name,
            "completed": bool(task.completed_at or task.status.is_final)} for task in page])
