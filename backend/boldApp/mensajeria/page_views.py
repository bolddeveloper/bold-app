"""Revision-checked channel documents; no silent last-writer-wins saves."""
import uuid
from django.db import transaction
from django.db.models import Q
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
from .personal_data import prime_saved, saved_data
from .page_mentions import page_mentions, sync_page_mentions, page_mention_locations


class PageInput(StrictInputSerializer):
    client_id = serializers.UUIDField()
    title = serializers.CharField(max_length=160)
    icon = serializers.ChoiceField(choices=ICONS, default="note")
    blocks = serializers.JSONField(default=list)
    parent_id = serializers.UUIDField(allow_null=True, required=False)


class PageSave(PageInput):
    version = serializers.IntegerField(min_value=1)

    def validate(self, data):
        if "parent_id" in data:
            raise serializers.ValidationError("Usa la opción Mover para cambiar la ubicación; el contenido se guarda por separado.")
        return data


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
    from .agreements import page_origins
    writable = not channel.archived_at and not page.archived_at
    return {**saved_data(page, "page", policy.assignment.employee_id), "id": str(page.pk), "channel_id": str(channel.pk), "title": page.title, "icon": page.icon,
            "collaboration_enabled": True,
            "parent_id": str(page.parent_id) if page.parent_id else None, "structure_version": page.structure_version,
            "has_children": getattr(page, "has_children", False),
            "version": page.version, "archived_at": page.archived_at, "created_at": page.created_at,
            "updated_at": page.updated_at, "updated_by": page.updated_by.full_name,
            "can_edit": writable and policy.allows("slack.page.update", channel.unit, channel.pk),
            "can_read_comments": policy.allows("slack.page_comment.read", channel.unit, channel.pk),
            "can_manage": not channel.archived_at and policy.allows("slack.page.manage", channel.unit, channel.pk),
            "can_create_template": not channel.archived_at and policy.allows("slack.template.create", channel.unit, channel.pk),
            "can_update_templates": not channel.archived_at and policy.allows("slack.template.update", channel.unit, channel.pk),
            **({"blocks": project_blocks(page.blocks, policy), "mentions": page_mentions(page),
                "message_origins":page_origins(policy.request, page)} if content else {})}


def record(page, actor, client_id, payload_digest):
    PageRevision.objects.create(page=page, version=page.version, actor_id=actor, client_id=client_id,
        payload_digest=payload_digest, title=page.title, icon=page.icon, blocks=page.blocks, archived=bool(page.archived_at))


def checkpoint(page):
    if not page.revisions.filter(version=page.version).exists():
        record(page, page.updated_by_id, uuid.uuid4(), digest({"checkpoint":page.version}))


def create_page(view, channel, values):
    """Shared normal-page creation, validation, revision, notices and retry path."""
    view.require_write(channel, "slack.page.create")
    receipt = digest({**values, "client_id":str(values['client_id']),
                      **({"parent_id":str(values['parent_id']) if values['parent_id'] else None} if 'parent_id' in values else {})})
    old = channel.pages.select_related('updated_by').filter(creator_id=view.actor(), client_id=values['client_id']).first()
    if old:
        if old.creation_digest != receipt:
            raise Conflict('La creación ya fue confirmada con otro contenido.')
        return old, False
    blocks = validate_blocks(values['blocks'], view.request.assignment, view.request)
    from .page_structure import placement
    parent = placement(channel, values.get('parent_id'))
    page = ChannelPage.objects.create(channel=channel, creator_id=view.actor(), updated_by_id=view.actor(),
        client_id=values['client_id'], creation_digest=receipt, title=values['title'], icon=values['icon'], blocks=blocks, parent=parent)
    sync_page_mentions(page, view.policy())
    record(page, view.actor(), values['client_id'], receipt)
    publish_channel(channel, 'page.structure_changed')
    return page, True


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
        rows = channel.pages.select_related("updated_by").defer("blocks", "creation_digest")
        archived = request.query_params.get("archived") == "true"
        parent = request.query_params.get("parent")
        if parent == "root":
            # An archived parent never hides active children from the default tree.
            rows = rows.filter(parent__isnull=True) if archived else rows.filter(Q(parent__isnull=True) | Q(parent__archived_at__isnull=False))
        elif parent is not None:
            try:
                parent_id = uuid.UUID(parent)
            except (ValueError, TypeError):
                raise serializers.ValidationError({"parent":"La página superior no es válida."})
            get_object_or_404(channel.pages, pk=parent_id)
            rows = rows.filter(parent_id=parent_id)
        if not archived:
            rows = rows.filter(archived_at__isnull=True)
        from .page_structure import with_children
        rows = with_children(rows, archived)
        paginator = PageListPagination()
        page = paginator.paginate_queryset(rows, request)
        prime_saved(page, "page", self.actor())
        response = paginator.get_paginated_response([page_data(row, channel, self.policy(), content=False) for row in page])
        response.data["can_create"] = not channel.archived_at and self.policy().allows("slack.page.create", channel.unit, channel.pk)
        response.data["can_templates"] = self.policy().allows("slack.template.read", channel.unit, channel.pk)
        return response

    @transaction.atomic
    def post(self, request, channel_id):
        channel = self.scope(channel_id, lock=True)
        form = PageInput(data=request.data)
        form.is_valid(raise_exception=True)
        values = form.validated_data
        page, created = create_page(self, channel, values)
        return Response(page_data(page, channel, self.policy()), status=201 if created else 200)


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
        checkpoint(page)
        previous_mentions = page_mention_locations(page)
        page.title, page.icon, page.blocks = values["title"], values["icon"], blocks
        page.version += 1
        page.updated_by_id = self.actor()
        page.save()
        sync_page_mentions(page, self.policy(), previous=previous_mentions)
        record(page, self.actor(), values["client_id"], receipt)
        from .page_collaboration import reset_collaboration
        reset_collaboration(page)
        publish_channel(channel, "page.title_changed")
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
            checkpoint(page)
            page.archived_at = timezone.now() if values["archived"] else None
        else:
            if page.archived_at:
                raise Conflict("Restaura la página antes de recuperar contenido.")
            revision = get_object_or_404(page.revisions, version=values["restore_version"])
            checkpoint(page)
            page.title, page.icon, page.blocks = revision.title, revision.icon, revision.blocks
        page.version += 1
        page.updated_by_id = self.actor()
        page.save()
        if 'restore_version' in values:
            sync_page_mentions(page, self.policy(), notify=False)
        record(page, self.actor(), values["client_id"], receipt)
        from .page_collaboration import reset_collaboration
        reset_collaboration(page)
        publish_channel(channel, "page.structure_changed")
        return Response(page_data(page, channel, self.policy()))


class PageHistoryView(PageView):
    def get(self, request, channel_id, page_id):
        channel = self.scope(channel_id)
        page = get_object_or_404(channel.pages, pk=page_id)
        rows = page.revisions.select_related("actor").defer("blocks").all()
        paginator = RevisionPagination()
        revisions = paginator.paginate_queryset(rows, request)
        # History is metadata only. Fetch a snapshot deliberately, not 25 full documents.
        response = paginator.get_paginated_response([{"version": row.version, "title": row.title,
            "actor": row.actor.full_name, "created_at": row.created_at, "archived": row.archived} for row in revisions])
        if not request.query_params.get("cursor") and not page.revisions.filter(version=page.version).exists():
            response.data["results"].insert(0, {"version": page.version, "title": page.title, "actor": page.updated_by.full_name,
                "created_at": page.updated_at, "archived": bool(page.archived_at), "current": True})
        return response


class PageRevisionView(PageView):
    def get(self, request, channel_id, page_id, version):
        channel = self.scope(channel_id)
        page = get_object_or_404(channel.pages, pk=page_id)
        if version == page.version:
            return Response({"version": page.version, "title": page.title, "icon": page.icon,
                "blocks": project_blocks(page.blocks, self.policy()), "mentions": page_mentions(page), "created_at": page.updated_at, "actor": page.updated_by.full_name})
        row = get_object_or_404(page.revisions, version=version)
        return Response({"version": row.version, "title": row.title, "icon": row.icon,
            "blocks": project_blocks(row.blocks, self.policy()), "mentions": page_mentions(page, title=row.title, blocks=row.blocks), "created_at": row.created_at, "actor": row.actor.full_name})
