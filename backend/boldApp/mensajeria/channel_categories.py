"""Categories organize channels without changing their invitation boundary."""
from django.db import IntegrityError, transaction
from django.db.models import F
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response

from boldApp.core.models import OrganizationalUnit, Permission
from .channel_events import publish_categories
from .channel_views import SlackView, channel_data
from .models import ChannelCategory, PrivateServer
from .serializers import StrictInputSerializer
from .views import Conflict


def scope_key(unit_id, server_id):
    return f"server:{server_id}" if server_id else str(unit_id) if unit_id else "independent"


def scope_access(view, *, lock=False, manage=False):
    query = view.request.query_params
    if bool(query.get("unit")) == bool(query.get("server")):
        raise ValidationError("Selecciona un único servidor.")
    unit = server = None
    if query.get("server"):
        server_id = serializers.UUIDField().run_validation(query["server"])
        rows = PrivateServer.objects.select_related("creator")
        server = get_object_or_404(rows.select_for_update(of=("self",)) if lock else rows, pk=server_id)
        access = server.members.filter(employee_id=view.actor()).values_list("access", flat=True).first()
        if not access or manage and (server.creator.employee_id != view.actor() or access != "write"):
            raise NotFound("Servidor no disponible para esta acción.")
    elif query["unit"] != "independent":
        unit_id = serializers.UUIDField().run_validation(query["unit"])
        rows = OrganizationalUnit.objects.all()
        unit = get_object_or_404(rows.select_for_update() if lock else rows, pk=unit_id)
    elif lock:
        # Channel creation already locks this same independent namespace.
        Permission.objects.select_for_update().get(code="slack.channel.create")
    view.policy().require("slack.channel.read", unit)
    if manage:
        view.policy().require("slack.channel.manage", unit)
    return unit, server


def category_data(row):
    return {"id": str(row.pk), "name": row.name, "position": row.position, "version": row.version}


def category_catalog(view, unit, server):
    can_manage = view.policy().allows("slack.channel.manage", unit)
    if server:
        can_manage = can_manage and server.creator.employee_id == view.actor() and server.members.filter(employee_id=view.actor(), access="write").exists()
    return {"scope": scope_key(getattr(unit, "pk", None), getattr(server, "pk", None)), "can_manage": can_manage,
        "results": [category_data(row) for row in ChannelCategory.objects.filter(unit=unit, server=server).order_by("position", "id")]}


class CreateCategory(StrictInputSerializer):
    client_id = serializers.UUIDField()
    name = serializers.CharField(max_length=80)


class CategoryPosition(StrictInputSerializer):
    version = serializers.IntegerField(min_value=1)
    before_id = serializers.UUIDField(allow_null=True)


class CategoryVersion(StrictInputSerializer):
    version = serializers.IntegerField(min_value=1)


class CategoryRename(CategoryVersion):
    name = serializers.CharField(max_length=80)


class ChannelCategoryInput(StrictInputSerializer):
    version = serializers.IntegerField(min_value=1)
    category_id = serializers.UUIDField(allow_null=True)


class ChannelCategoryListView(SlackView):
    def get(self, request):
        unit, server = scope_access(self)
        return Response(category_catalog(self, unit, server))

    @transaction.atomic
    def post(self, request):
        unit, server = scope_access(self, lock=True, manage=True)
        form = CreateCategory(data=request.data)
        form.is_valid(raise_exception=True)
        values = form.validated_data
        rows = ChannelCategory.objects.filter(unit=unit, server=server)
        old = ChannelCategory.objects.filter(pk=values["client_id"]).first()
        if old:
            if old.unit_id != getattr(unit, "pk", None) or old.server_id != getattr(server, "pk", None) or old.name != values["name"] or old.creator.employee_id != self.actor():
                raise Conflict("Ese intento de creación ya corresponde a otro contenido.")
            return Response(category_catalog(self, unit, server))
        if rows.count() >= 100:
            raise ValidationError("Este servidor admite hasta 100 categorías.")
        try:
            with transaction.atomic():
                ChannelCategory.objects.create(id=values["client_id"], unit=unit, server=server, name=values["name"], position=rows.count(), creator=request.assignment)
        except IntegrityError:
            raise Conflict("Ya existe una categoría con ese nombre en este servidor.")
        publish_categories(getattr(unit, "pk", None), getattr(server, "pk", None))
        return Response(category_catalog(self, unit, server), status=201)


class ChannelCategoryDetailView(SlackView):
    @transaction.atomic
    def patch(self, request, category_id):
        unit, server = scope_access(self, lock=True, manage=True)
        form = CategoryRename(data=request.data)
        form.is_valid(raise_exception=True)
        values = form.validated_data
        category = get_object_or_404(ChannelCategory.objects.select_for_update(), pk=category_id, unit=unit, server=server)
        if category.version != values["version"]:
            raise Conflict("La categoría cambió en otra ventana. Actualiza antes de editarla.")
        if category.name != values["name"]:
            category.name = values["name"]
            category.version += 1
            try:
                with transaction.atomic():
                    category.save(update_fields=["name", "version"])
            except IntegrityError:
                raise Conflict("Ya existe una categoría con ese nombre en este servidor.")
            publish_categories(getattr(unit, "pk", None), getattr(server, "pk", None))
        return Response(category_catalog(self, unit, server))

    @transaction.atomic
    def delete(self, request, category_id):
        unit, server = scope_access(self, lock=True, manage=True)
        form = CategoryVersion(data=request.data)
        form.is_valid(raise_exception=True)
        category = get_object_or_404(ChannelCategory.objects.select_for_update(), pk=category_id, unit=unit, server=server)
        if category.version != form.validated_data["version"]:
            raise Conflict("La categoría cambió en otra ventana. Actualiza antes de eliminarla.")
        # Ungroup every child, including archived/private channels, preserving their ACLs and messages.
        category.channels.update(category=None, version=F("version") + 1, updated_at=timezone.now())
        category.delete()
        changed = []
        for position, row in enumerate(ChannelCategory.objects.filter(unit=unit, server=server).order_by("position", "id")):
            if row.position != position:
                row.position = position
                row.version += 1
                changed.append(row)
        if changed:
            ChannelCategory.objects.bulk_update(changed, ["position", "version"])
        publish_categories(getattr(unit, "pk", None), getattr(server, "pk", None))
        return Response(category_catalog(self, unit, server))


class CategoryPositionView(SlackView):
    @transaction.atomic
    def put(self, request, category_id):
        unit, server = scope_access(self, lock=True, manage=True)
        form = CategoryPosition(data=request.data)
        form.is_valid(raise_exception=True)
        values = form.validated_data
        rows = list(ChannelCategory.objects.filter(unit=unit, server=server).order_by("position", "id"))
        target = next((row for row in rows if row.pk == category_id), None)
        if target is None:
            raise NotFound("Categoría no disponible en este servidor.")
        if values["version"] != target.version:
            raise Conflict("El orden cambió en otra ventana. Actualiza antes de mover de nuevo.")
        before = values["before_id"]
        if before is not None and not any(row.pk == before for row in rows):
            raise NotFound("La categoría de destino no pertenece a este servidor.")
        if before != target.pk:
            rows.remove(target)
            rows.insert(next((i for i, row in enumerate(rows) if row.pk == before), len(rows)), target)
            changed = []
            for position, row in enumerate(rows):
                if row.position != position:
                    row.position = position
                    row.version += 1
                    changed.append(row)
            if changed:
                ChannelCategory.objects.bulk_update(changed, ["position", "version"])
                publish_categories(getattr(unit, "pk", None), getattr(server, "pk", None))
        return Response(category_catalog(self, unit, server))


class ChannelCategoryMoveView(SlackView):
    @transaction.atomic
    def put(self, request, channel_id):
        unit, server = scope_access(self, lock=True)
        channel = self.channel(channel_id, lock=True)
        if channel.unit_id != getattr(unit, "pk", None) or channel.server_id != getattr(server, "pk", None):
            raise NotFound("El canal no pertenece a este servidor.")
        self.policy().require("slack.channel.manage", channel.unit, channel.pk)
        form = ChannelCategoryInput(data=request.data)
        form.is_valid(raise_exception=True)
        values = form.validated_data
        if values["version"] != channel.version:
            raise Conflict("El canal cambió en otra ventana. Actualiza antes de mover de nuevo.")
        category = get_object_or_404(ChannelCategory, pk=values["category_id"], unit=unit, server=server) if values["category_id"] else None
        if channel.category_id != getattr(category, "pk", None):
            channel.category = category
            channel.version += 1
            channel.save(update_fields=["category", "version"])
            publish_categories(channel.unit_id, channel.server_id)
        return Response({"channel": channel_data(channel, self.policy())})
