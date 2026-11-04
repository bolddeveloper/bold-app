"""Private channel groups inherit one invitation boundary, including for owners."""
from django.db import transaction
from django.db.models import F
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response

from boldApp.administrativo.services import record_system_event
from boldApp.core.models import Employee
from boldApp.core.signals import dispatch_authorization_invalidation
from .channel_access_views import AccessMember, validate_access
from .channel_events import publish_channel
from .channel_people import with_identity, person_data
from .channel_views import SlackView, ChannelPages
from .channel_search import channel_matches
from .models import PrivateServer, PrivateServerMember, ChannelAccessEpoch
from .serializers import StrictInputSerializer
from .views import Conflict


class ServerInput(StrictInputSerializer):
    name = serializers.CharField(max_length=80)
    color = serializers.RegexField(r"^#[0-9a-fA-F]{6}$", max_length=7, default="#ed3033")
    members = AccessMember(many=True, max_length=200, default=list)
    version = serializers.IntegerField(min_value=1, required=False)


class ServerVersion(StrictInputSerializer):
    version = serializers.IntegerField(min_value=1)


def invalidate_members(employee_ids):
    if not employee_ids:
        return
    ChannelAccessEpoch.objects.bulk_create(
        [ChannelAccessEpoch(employee_id=person) for person in employee_ids], ignore_conflicts=True)
    rows = ChannelAccessEpoch.objects.filter(employee_id__in=employee_ids)
    list(rows.select_for_update().order_by("employee_id"))
    rows.update(revision=F("revision") + 1)
    transaction.on_commit(dispatch_authorization_invalidation, robust=True)


def server_data(server, assignment, policy):
    from .server_icons import icon_data
    return {"id": str(server.pk), "name": server.name, "color": server.color,
        "private": True, "version": server.version, **icon_data(policy, server=server),
        "can_manage": server.creator.employee_id == assignment.employee_id and policy.allows("slack.channel.manage", None),
        "can_create": server.creator.employee_id == assignment.employee_id and policy.allows("slack.channel.create", None)}


def server_members(server):
    people = {row.pk: person_data(row) for row in with_identity(Employee.objects.filter(privateservermember__server=server))}
    return [{**people[row.employee_id], "access": row.access, "owner": row.employee_id == server.creator.employee_id}
        for row in server.members.order_by("employee__full_name", "employee_id")]


def reviewed_members(values, creator_id):
    members = [row.copy() for row in values]
    if any(row["access"] == "blocked" for row in members):
        raise ValidationError({"members": "Quita a la persona de la lista para retirar su acceso al servidor."})
    if not any(row["employee_id"] == creator_id for row in members):
        members.append({"employee_id": creator_id, "access": "write"})
    if any(row["employee_id"] == creator_id and row["access"] != "write" for row in members):
        raise ValidationError({"members": "El creador conserva acceso para administrar el servidor."})
    if len(members) > 200:
        raise ValidationError({"members": "El límite es de 200 personas, incluido el creador."})
    validate_access("private", members, None)
    return members


class ServerListView(SlackView):
    def get(self, request):
        self.policy().require("slack.channel.read", None)
        rows = PrivateServer.objects.filter(deleted_at__isnull=True, members__employee_id=self.actor()).select_related("creator").order_by("name", "id")
        query = request.query_params.get('q', '').strip()[:80]
        if query:
            ids = [pk for pk, name in rows.values_list('pk', 'name') if channel_matches(name, query)]
            rows = rows.filter(pk__in=ids)
        pages = ChannelPages()
        page = pages.paginate_queryset(rows, request)
        from .server_icons import prime_icons
        prime_icons(self.policy(), servers=[row.pk for row in page])
        return pages.get_paginated_response([server_data(row, request.assignment, self.policy()) for row in page])

    @transaction.atomic
    def post(self, request):
        self.policy().require("slack.channel.read", None)
        self.policy().require("slack.channel.create", None)
        # Serialize the per-person limit even across their active assignments.
        Employee.objects.select_for_update().get(pk=self.actor())
        if PrivateServer.objects.filter(deleted_at__isnull=True, creator__employee_id=self.actor()).count() >= 50:
            raise ValidationError("Puedes crear hasta 50 servidores privados.")
        form = ServerInput(data=request.data)
        form.is_valid(raise_exception=True)
        values = form.validated_data
        members = reviewed_members(values["members"], self.actor())
        server = PrivateServer.objects.create(name=values["name"], color=values["color"], creator=request.assignment)
        PrivateServerMember.objects.bulk_create([PrivateServerMember(server=server, **row) for row in members])
        record_system_event("slack.server.created", request, module_code="slack", target_type="slack_server", target_id=server.pk)
        return Response(server_data(server, request.assignment, self.policy()), status=201)


class ServerDetailView(SlackView):
    def server(self, server_id, lock=False):
        rows = PrivateServer.objects.filter(deleted_at__isnull=True).select_related("creator")
        if lock:
            rows = rows.select_for_update(of=("self",))
        server = get_object_or_404(rows, pk=server_id)
        if not server.members.filter(employee_id=self.actor()).exists():
            raise NotFound("Servidor no disponible.")
        self.policy().require("slack.channel.read", None)
        if server.creator.employee_id != self.actor():
            raise NotFound("Solo el creador administra las invitaciones del servidor.")
        self.policy().require("slack.channel.manage", None)
        return server

    def get(self, request, server_id):
        server = self.server(server_id)
        return Response({**server_data(server, request.assignment, self.policy()), "members": server_members(server)})

    @transaction.atomic
    def patch(self, request, server_id):
        server = self.server(server_id, lock=True)
        form = ServerInput(data=request.data)
        form.is_valid(raise_exception=True)
        values = form.validated_data
        if values.get("version") != server.version:
            raise Conflict("El servidor cambió. Actualiza sus invitaciones antes de guardar.")
        members = reviewed_members(values["members"], server.creator.employee_id)
        before = dict(server.members.values_list("employee_id", "access"))
        after = {row["employee_id"]: row["access"] for row in members}
        # Serialize with every channel writer before changing the shared boundary.
        channels = list(server.channels.select_for_update().order_by("pk"))
        server.members.all().delete()
        PrivateServerMember.objects.bulk_create([PrivateServerMember(server=server, **row) for row in members])
        server.name, server.color = values["name"], values["color"]
        server.version += 1
        server.save(update_fields=["name", "color", "version"])
        affected = sorted(person for person in before.keys() | after.keys() if before.get(person) != after.get(person))
        invalidate_members(affected)
        record_system_event("slack.server.updated", request, module_code="slack", target_type="slack_server", target_id=server.pk)
        for channel in channels:
            publish_channel(channel, "channel.access_changed")
        return Response({**server_data(server, request.assignment, self.policy()), "members": server_members(server)})

    @transaction.atomic
    def delete(self, request, server_id):
        server = self.server(server_id, lock=True)
        form = ServerVersion(data=request.data)
        form.is_valid(raise_exception=True)
        if server.version != form.validated_data["version"]:
            raise Conflict("El servidor cambió. Vuelve a abrir su configuración antes de eliminarlo.")
        # Lock channel writers before revoking access. Retain channels, history and Drive references.
        list(server.channels.select_for_update().order_by("pk").values_list("pk", flat=True))
        server.deleted_at = timezone.now()
        server.save(update_fields=["deleted_at"])
        invalidate_members(list(server.members.order_by("employee_id").values_list("employee_id", flat=True)))
        record_system_event("slack.server.deleted", request, module_code="slack", target_type="slack_server", target_id=server.pk)
        return Response(status=204)
