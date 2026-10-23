"""Reusable channel-owned templates, never a second route around channel ACLs."""
import copy
import uuid
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.response import Response
from .channel_events import publish_channel
from .page_content import digest, project_blocks
from .page_models import ChannelPage, PageTemplate
from .page_views import PageView, PageListPagination, page_data, record
from .serializers import StrictInputSerializer
from .views import Conflict


def starter(identity, name, description, headings):
    blocks = []
    for i, (label, kind) in enumerate(headings):
        blocks.append({"id": str(uuid.uuid5(uuid.NAMESPACE_URL, identity+str(i))), "type": kind, "text": label,
                       **({"level": 2} if kind == "heading" else {}), **({"checked": False} if kind == "check" else {})})
    return {"id": identity, "name": name, "description": description, "title": name, "icon": "note", "blocks": blocks,
            "version": 1, "builtin": True, "archived_at": None, "can_manage": False, "can_update": False}


BUILTINS = {row["id"]: row for row in [
    starter("builtin-meeting", "Notas de reunión", "Agenda, acuerdos y próximos pasos.", [("Agenda", "heading"), ("", "bullet"), ("Acuerdos", "heading"), ("", "paragraph"), ("Próximos pasos", "heading"), ("", "check")]),
    starter("builtin-brief", "Brief de proyecto", "Objetivos, alcance y entregables del equipo.", [("Objetivo", "heading"), ("", "paragraph"), ("Alcance", "heading"), ("", "bullet"), ("Entregables", "heading"), ("", "check")]),
    starter("builtin-weekly", "Seguimiento semanal", "Avances, bloqueos y prioridades de la semana.", [("Avances", "heading"), ("", "bullet"), ("Bloqueos", "heading"), ("", "paragraph"), ("Siguiente semana", "heading"), ("", "check")]),
]}


class CaptureTemplate(StrictInputSerializer):
    client_id = serializers.UUIDField()
    page_id = serializers.UUIDField()
    page_version = serializers.IntegerField(min_value=1)
    name = serializers.CharField(max_length=160)
    description = serializers.CharField(max_length=500, allow_blank=True, default="")
    version = serializers.IntegerField(min_value=1, required=False)


class UpdateTemplate(StrictInputSerializer):
    version = serializers.IntegerField(min_value=1)
    name = serializers.CharField(max_length=160, required=False)
    description = serializers.CharField(max_length=500, allow_blank=True, required=False)
    archived = serializers.BooleanField(required=False)

    def validate(self, data):
        if len(data)<2:
            raise serializers.ValidationError("Indica qué deseas modificar.")
        return data


class InstantiateTemplate(StrictInputSerializer):
    client_id = serializers.UUIDField()


def template_data(row, channel, policy, *, content=False):
    return {"id": str(row.pk), "name": row.name, "description": row.description, "title": row.title,
        "icon": row.icon, "version": row.version, "builtin": False, "archived_at": row.archived_at,
        "can_manage": not channel.archived_at and policy.allows("slack.template.manage", channel.unit, channel.pk),
        "can_update": not channel.archived_at and not row.archived_at and policy.allows("slack.template.update", channel.unit, channel.pk),
        **({"blocks": project_blocks(row.blocks, policy)} if content else {})}


class TemplateView(PageView):
    def scope(self, channel_id, *, lock=False):
        channel = self.channel(channel_id, lock=lock)
        self.policy().require("slack.template.read", channel.unit, channel.pk)
        return channel

    def source(self, channel, values):
        self.policy().require("slack.page.read", channel.unit, channel.pk)
        page = get_object_or_404(channel.pages, pk=values["page_id"])
        if page.version != values["page_version"]:
            raise Conflict("La página cambió. Confirma la versión guardada antes de capturar una plantilla.")
        return page


class TemplateListView(TemplateView):
    def get(self, request, channel_id):
        channel = self.scope(channel_id)
        rows = channel.page_templates.all()
        if request.query_params.get("archived") != "true":
            rows = rows.filter(archived_at__isnull=True)
        paginator = PageListPagination()
        result = paginator.paginate_queryset(rows, request)
        response = paginator.get_paginated_response([template_data(row, channel, self.policy()) for row in result])
        response.data["builtins"] = [{key: value for key, value in row.items() if key != "blocks"} for row in BUILTINS.values()]
        response.data["can_create"] = not channel.archived_at and self.policy().allows("slack.template.create", channel.unit, channel.pk)
        return response

    @transaction.atomic
    def post(self, request, channel_id):
        channel = self.scope(channel_id, lock=True)
        self.require_write(channel, "slack.template.create")
        form = CaptureTemplate(data=request.data)
        form.is_valid(raise_exception=True)
        values = form.validated_data
        receipt = digest({**values, "client_id": str(values["client_id"]), "page_id": str(values["page_id"])})
        previous = channel.page_templates.filter(creator_id=self.actor(), client_id=values["client_id"]).first()
        if previous:
            if previous.creation_digest != receipt:
                raise Conflict("Esta plantilla ya se creó con otro contenido.")
            return Response(template_data(previous, channel, self.policy(), content=True))
        page = self.source(channel, values)
        row = PageTemplate.objects.create(channel=channel, creator_id=self.actor(), client_id=values["client_id"], creation_digest=receipt,
            name=values["name"], description=values["description"], title=page.title, icon=page.icon, blocks=page.blocks)
        publish_channel(channel, "page.template_changed")
        return Response(template_data(row, channel, self.policy(), content=True), status=201)


class TemplateDetailView(TemplateView):
    def get(self, request, channel_id, template_id):
        channel = self.scope(channel_id)
        if template_id in BUILTINS:
            return Response(BUILTINS[template_id])
        row = get_object_or_404(channel.page_templates, pk=self.valid_id(template_id))
        return Response(template_data(row, channel, self.policy(), content=True))

    def valid_id(self, identity):
        try:
            return uuid.UUID(identity)
        except ValueError:
            from rest_framework.exceptions import NotFound
            raise NotFound()

    @transaction.atomic
    def patch(self, request, channel_id, template_id):
        channel = self.scope(channel_id, lock=True)
        row = get_object_or_404(channel.page_templates, pk=self.valid_id(template_id))
        form = UpdateTemplate(data=request.data)
        form.is_valid(raise_exception=True)
        values = form.validated_data
        self.require_write(channel, "slack.template.manage" if "archived" in values else "slack.template.update")
        if row.version != values["version"]:
            raise Conflict("La plantilla cambió. Actualízala antes de volver a guardar.")
        if row.archived_at and ("name" in values or "description" in values):
            raise Conflict("Restaura la plantilla antes de editarla.")
        for key in ("name", "description"):
            if key in values:
                setattr(row, key, values[key])
        if "archived" in values:
            row.archived_at = timezone.now() if values["archived"] else None
        row.version += 1
        row.save()
        publish_channel(channel, "page.template_changed")
        return Response(template_data(row, channel, self.policy(), content=True))

    @transaction.atomic
    def put(self, request, channel_id, template_id):
        channel = self.scope(channel_id, lock=True)
        self.require_write(channel, "slack.template.update")
        row = get_object_or_404(channel.page_templates, pk=self.valid_id(template_id))
        if row.archived_at:
            raise Conflict("Restaura la plantilla antes de reemplazar su contenido.")
        form = CaptureTemplate(data=request.data)
        form.is_valid(raise_exception=True)
        values = form.validated_data
        if values.get("version") != row.version:
            raise Conflict("La plantilla cambió. Revisa su versión antes de reemplazarla.")
        page = self.source(channel, values)
        row.name, row.description, row.title, row.icon, row.blocks = values["name"], values["description"], page.title, page.icon, page.blocks
        row.version += 1
        row.save()
        publish_channel(channel, "page.template_changed")
        return Response(template_data(row, channel, self.policy(), content=True))


class TemplatePageView(TemplateDetailView):
    http_method_names = ["post", "options"]
    @transaction.atomic
    def post(self, request, channel_id, template_id):
        channel = self.scope(channel_id, lock=True)
        self.policy().require("slack.page.read", channel.unit, channel.pk)
        self.require_write(channel, "slack.page.create")
        form = InstantiateTemplate(data=request.data)
        form.is_valid(raise_exception=True)
        token = form.validated_data["client_id"]
        receipt = digest({"template_id": template_id, "client_id": str(token)})
        previous = channel.pages.select_related("updated_by").filter(creator_id=self.actor(), client_id=token).first()
        if previous:
            if previous.creation_digest != receipt:
                raise Conflict("Este intento ya creó una página diferente.")
            return Response(page_data(previous, channel, self.policy()))
        if template_id in BUILTINS:
            source = BUILTINS[template_id]
            title, icon, blocks = source["title"], source["icon"], copy.deepcopy(source["blocks"])
        else:
            source = get_object_or_404(channel.page_templates, pk=self.valid_id(template_id), archived_at__isnull=True)
            title, icon, blocks = source.title, source.icon, copy.deepcopy(source.blocks)
        for block in blocks:
            block["id"] = str(uuid.uuid4())
        page = ChannelPage.objects.create(channel=channel, creator_id=self.actor(), updated_by_id=self.actor(), client_id=token,
            creation_digest=receipt, title=title, icon=icon, blocks=blocks)
        record(page, self.actor(), token, receipt)
        publish_channel(channel, "page.changed")
        return Response(page_data(page, channel, self.policy()), status=201)
