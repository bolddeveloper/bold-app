"""Revision-checked channel documents; no silent last-writer-wins saves."""
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.pagination import CursorPagination
from rest_framework.response import Response
from .channel_events import publish_channel
from .channel_views import SlackView
from .page_models import ChannelPage, PageRevision
from .page_content import ICONS, digest, validate_blocks, project_blocks
from .serializers import StrictInputSerializer
from .views import Conflict


class PageInput(StrictInputSerializer):
    client_id = serializers.UUIDField()
    title = serializers.CharField(max_length=160)
    icon = serializers.ChoiceField(choices=ICONS, default="note")
    blocks = serializers.JSONField(default=list)


class PageSave(PageInput):
    version = serializers.IntegerField(min_value=1)


class PageAction(StrictInputSerializer):
    client_id = serializers.UUIDField()
    version = serializers.IntegerField(min_value=1)
    archived = serializers.BooleanField(required=False)
    restore_version = serializers.IntegerField(min_value=1, required=False)

    def validate(self, data):
        if ("archived" in data) == ("restore_version" in data):
            raise serializers.ValidationError("Elige archivar o restaurar una versión.")
        return data


class PageListPagination(CursorPagination):
    page_size = 50
    ordering = ("-created_at", "-id")


class RevisionPagination(CursorPagination):
    page_size = 25
    ordering = "-version"


def page_data(page, channel, policy, *, content=True):
    writable = not channel.archived_at and not page.archived_at
    return {"id": str(page.pk), "channel_id": str(channel.pk), "title": page.title, "icon": page.icon,
            "version": page.version, "archived_at": page.archived_at, "created_at": page.created_at,
            "updated_at": page.updated_at, "updated_by": page.updated_by.full_name,
            "can_edit": writable and policy.allows("slack.page.update", channel.unit, channel.pk),
            "can_manage": not channel.archived_at and policy.allows("slack.page.manage", channel.unit, channel.pk),
            **({"blocks": project_blocks(page.blocks, policy)} if content else {})}


def record(page, actor, client_id, payload_digest):
    PageRevision.objects.create(page=page, version=page.version, actor_id=actor, client_id=client_id,
        payload_digest=payload_digest, title=page.title, icon=page.icon, blocks=page.blocks, archived=bool(page.archived_at))


class PageView(SlackView):
    def scope(self, channel_id, *, lock=False):
        channel = self.channel(channel_id, lock=lock)
        self.policy().require("slack.page.read", channel.unit, channel.pk)
        return channel

    def require_write(self, channel, code):
        self.policy().require(code, channel.unit, channel.pk)
        if channel.archived_at:
            raise Conflict("El canal está archivado; las páginas son de solo lectura.")

    def conflict(self, page, channel):
        return Response({"detail": "Otra persona guardó una versión más reciente. Tu borrador no se ha sobrescrito.",
                         "current": page_data(page, channel, self.policy())}, status=409)


class PageListView(PageView):
    def get(self, request, channel_id):
        channel = self.scope(channel_id)
        rows = channel.pages.select_related("updated_by").all()
        if request.query_params.get("archived") != "true":
            rows = rows.filter(archived_at__isnull=True)
        paginator = PageListPagination()
        page = paginator.paginate_queryset(rows, request)
        response = paginator.get_paginated_response([page_data(row, channel, self.policy(), content=False) for row in page])
        response.data["can_create"] = not channel.archived_at and self.policy().allows("slack.page.create", channel.unit, channel.pk)
        return response

    @transaction.atomic
    def post(self, request, channel_id):
        channel = self.scope(channel_id, lock=True)
        self.require_write(channel, "slack.page.create")
        form = PageInput(data=request.data)
        form.is_valid(raise_exception=True)
        values = form.validated_data
        receipt = digest({**values, "client_id": str(values["client_id"])})
        old = channel.pages.select_related("updated_by").filter(creator_id=self.actor(), client_id=values["client_id"]).first()
        if old:
            if old.creation_digest != receipt:
                raise Conflict("La creación ya fue confirmada con otro contenido.")
            return Response(page_data(old, channel, self.policy()))
        blocks = validate_blocks(values["blocks"], request.assignment, request)
        page = ChannelPage.objects.create(channel=channel, creator_id=self.actor(), updated_by_id=self.actor(),
            client_id=values["client_id"], creation_digest=receipt, title=values["title"], icon=values["icon"], blocks=blocks)
        record(page, self.actor(), values["client_id"], receipt)
        publish_channel(channel, "page.changed")
        return Response(page_data(page, channel, self.policy()), status=201)


class PageDetailView(PageView):
    def get(self, request, channel_id, page_id):
        channel = self.scope(channel_id)
        page = get_object_or_404(channel.pages.select_related("updated_by"), pk=page_id)
        return Response(page_data(page, channel, self.policy()))

    @transaction.atomic
    def put(self, request, channel_id, page_id):
        channel = self.scope(channel_id, lock=True)
        self.require_write(channel, "slack.page.update")
        page = get_object_or_404(channel.pages.select_related("updated_by"), pk=page_id)
        form = PageSave(data=request.data)
        form.is_valid(raise_exception=True)
        values = form.validated_data
        receipt = digest({**values, "client_id": str(values["client_id"])})
        previous = page.revisions.filter(actor_id=self.actor(), client_id=values["client_id"]).first()
        if previous:
            if previous.payload_digest != receipt:
                raise Conflict("Este guardado ya fue confirmado con otro contenido.")
            return Response({**page_data(page, channel, self.policy()), "accepted_version": previous.version})
        if values["version"] != page.version:
            return self.conflict(page, channel)
        if page.archived_at:
            raise Conflict("Restaura la página antes de editarla.")
        blocks = validate_blocks(values["blocks"], request.assignment, request, page.blocks)
        # A user who has changed no content should not create history on blur.
        if (values["title"], values["icon"], blocks) == (page.title, page.icon, page.blocks):
            return Response(page_data(page, channel, self.policy()))
        page.title, page.icon, page.blocks = values["title"], values["icon"], blocks
        page.version += 1
        page.updated_by_id = self.actor()
        page.save()
        record(page, self.actor(), values["client_id"], receipt)
        publish_channel(channel, "page.changed")
        return Response({**page_data(page, channel, self.policy()), "accepted_version": page.version})

    @transaction.atomic
    def patch(self, request, channel_id, page_id):
        channel = self.scope(channel_id, lock=True)
        page = get_object_or_404(channel.pages.select_related("updated_by"), pk=page_id)
        form = PageAction(data=request.data)
        form.is_valid(raise_exception=True)
        values = form.validated_data
        self.require_write(channel, "slack.page.manage" if "archived" in values else "slack.page.update")
        receipt = digest({**values, "client_id": str(values["client_id"])})
        old = page.revisions.filter(actor_id=self.actor(), client_id=values["client_id"]).first()
        if old:
            if old.payload_digest != receipt:
                raise Conflict("Esta operación ya existe con otro contenido.")
            return Response(page_data(page, channel, self.policy()))
        if values["version"] != page.version:
            return self.conflict(page, channel)
        if "archived" in values:
            if values["archived"] == bool(page.archived_at):
                return Response(page_data(page, channel, self.policy()))
            page.archived_at = timezone.now() if values["archived"] else None
        else:
            if page.archived_at:
                raise Conflict("Restaura la página antes de recuperar contenido.")
            revision = get_object_or_404(page.revisions, version=values["restore_version"])
            page.title, page.icon, page.blocks = revision.title, revision.icon, revision.blocks
        page.version += 1
        page.updated_by_id = self.actor()
        page.save()
        record(page, self.actor(), values["client_id"], receipt)
        publish_channel(channel, "page.changed")
        return Response(page_data(page, channel, self.policy()))


class PageHistoryView(PageView):
    def get(self, request, channel_id, page_id):
        channel = self.scope(channel_id)
        page = get_object_or_404(channel.pages, pk=page_id)
        rows = page.revisions.select_related("actor").defer("blocks").all()
        paginator = RevisionPagination()
        revisions = paginator.paginate_queryset(rows, request)
        # History is metadata only. Fetch a snapshot deliberately, not 25 full documents.
        return paginator.get_paginated_response([{"version": row.version, "title": row.title,
            "actor": row.actor.full_name, "created_at": row.created_at, "archived": row.archived} for row in revisions])


class PageRevisionView(PageView):
    def get(self, request, channel_id, page_id, version):
        channel = self.scope(channel_id)
        page = get_object_or_404(channel.pages, pk=page_id)
        row = get_object_or_404(page.revisions, version=version)
        return Response({"version": row.version, "title": row.title, "icon": row.icon,
            "blocks": project_blocks(row.blocks, self.policy()), "created_at": row.created_at, "actor": row.actor.full_name})
