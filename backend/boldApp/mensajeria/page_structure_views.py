"""Separate optimistic structure API; moving pages cannot overwrite CRDT text."""
from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.response import Response
from .serializers import StrictInputSerializer
from .page_models import PageStructureReceipt
from .page_content import digest
from .page_views import PageView, PageListPagination
from .page_structure import placement, structure_data, exclude_branch
from .channel_events import publish_channel
from .views import Conflict


class MoveInput(StrictInputSerializer):
    client_id = serializers.UUIDField()
    version = serializers.IntegerField(min_value=1)
    parent_id = serializers.UUIDField(allow_null=True)


class PageStructureView(PageView):
    def get(self, request, channel_id, page_id):
        channel = self.scope(channel_id)
        page = get_object_or_404(channel.pages, pk=page_id)
        return Response(structure_data(page))

    @transaction.atomic
    def put(self, request, channel_id, page_id):
        channel = self.scope(channel_id, lock=True)
        self.require_write(channel, "slack.page.manage")
        page = get_object_or_404(channel.pages, pk=page_id)
        form = MoveInput(data=request.data)
        form.is_valid(raise_exception=True)
        values = form.validated_data
        receipt = digest({key:str(value) if value is not None else None for key,value in values.items()})
        previous = page.structure_receipts.filter(actor_id=self.actor(), client_id=values['client_id']).first()
        if previous:
            if previous.digest != receipt:
                raise Conflict("Este movimiento ya fue confirmado con otra ubicación.")
            return Response({**structure_data(page), "accepted_version":previous.version})
        if values['version'] != page.structure_version:
            return Response({"detail":"La ubicación cambió. Revisa la nueva jerarquía antes de mover la página.",
                             "current":structure_data(page)}, status=409)
        parent = placement(channel, values['parent_id'], page)
        if page.parent_id != (parent.pk if parent else None):
            page.parent = parent
            page.structure_version += 1
            # Do not touch content version, updated_at, authorship or collaboration epoch.
            page.save(update_fields=['parent', 'structure_version'])
            publish_channel(channel, 'page.structure_changed')
        PageStructureReceipt.objects.create(page=page, actor_id=self.actor(), client_id=values['client_id'],
                                            digest=receipt, version=page.structure_version)
        return Response({**structure_data(page), "accepted_version":page.structure_version})


class PageParentOptionsView(PageView):
    def get(self, request, channel_id, page_id):
        channel = self.scope(channel_id)
        self.policy().require("slack.page.manage", channel.unit, channel.pk)
        page = get_object_or_404(channel.pages, pk=page_id)
        term = request.query_params.get('q', '').strip()
        if len(term) > 80:
            raise serializers.ValidationError("La búsqueda admite hasta 80 caracteres.")
        rows = exclude_branch(channel.pages.filter(archived_at__isnull=True), page)
        if term:
            rows = rows.filter(title__icontains=term)
        paginator = PageListPagination()
        selected = paginator.paginate_queryset(rows, request)
        return paginator.get_paginated_response([{"id":str(row.pk), "title":row.title, "icon":row.icon} for row in selected])
