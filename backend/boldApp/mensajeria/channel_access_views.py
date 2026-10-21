"""Invitation administration is deliberately separate from reading content."""
from django.db import transaction
from django.db.models import Count, F, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response

from boldApp.administrativo.services import record_system_event
from boldApp.core.models import Employee, PositionAssignment
from boldApp.core.signals import dispatch_authorization_invalidation
from .channel_events import publish_channel
from .channel_views import SlackView, ChannelPages, department_data
from .models import DepartmentChannel, ChannelAccessRule, ChannelAccessEpoch
from .serializers import StrictInputSerializer
from .views import Conflict
from .channel_people import with_identity, person_data
from rest_framework.pagination import CursorPagination


class AccessMember(StrictInputSerializer):
    employee_id = serializers.UUIDField()
    access = serializers.ChoiceField(choices=["read", "write", "blocked"])


class ChannelAccessInput(StrictInputSerializer):
    visibility = serializers.ChoiceField(choices=["public", "department", "private"])
    members = AccessMember(many=True, max_length=200)
    version = serializers.IntegerField(min_value=1)


def validate_access(visibility, members, unit_id):
    if visibility == "department" and not unit_id:
        raise ValidationError({"visibility": "Un canal sin departamento solo puede ser público o privado."})
    ids = [row["employee_id"] for row in members]
    if len(set(ids)) != len(ids):
        raise ValidationError({"members": "Cada persona puede aparecer solo una vez."})
    active = Employee.objects.filter(pk__in=ids, is_active=True, user_account__is_active=True,
        position_assignments__is_active=True, position_assignments__released_at__isnull=True).distinct()
    if active.count() != len(ids):
        raise ValidationError({"members": "Selecciona personas activas con cuenta y asignación vigentes."})
    if visibility == "private" and not any(row["access"] in ("read", "write") for row in members):
        raise ValidationError({"members": "Un canal privado necesita al menos una persona invitada con acceso."})


def access_data(channel):
    people = with_identity(Employee.objects.filter(channelaccessrule__channel=channel))
    identities = {person.pk: person_data(person) for person in people}
    return {"id": str(channel.pk), "name": channel.name, "department": department_data(channel.unit),
        "color": channel.color, "visibility": channel.visibility, "version": channel.version,
        "members": [{**identities[rule.employee_id], "access": rule.access}
            for rule in channel.access_rules.select_related("employee").order_by("employee__full_name", "employee_id")]}


def invalidate_access(channel, before, after):
    """Persist a scoped recovery marker even when the on-commit push is lost."""
    ids = {row["employee_id"] for state in (before, after) for row in state["members"]}
    affected = Q(pk__in=ids)
    visibilities = {before["visibility"], after["visibility"]}
    if "public" in visibilities:
        affected = Q()
    elif "department" in visibilities:
        affected |= Q(position_assignments__position__unit_id=channel.unit_id,
            position_assignments__is_active=True, position_assignments__released_at__isnull=True)
    candidates = Employee.objects.filter(affected, is_active=True, user_account__is_active=True).values("pk")
    before_rules = {row["employee_id"]: row["access"] for row in before["members"]}
    after_rules = {row["employee_id"]: row["access"] for row in after["members"]}
    def level(state, rules, employee_id, unit_id):
        explicit = rules.get(str(employee_id))
        if explicit is not None:
            return {"blocked": 0, "read": 1, "write": 2}[explicit]
        return 2 if state["visibility"] == "public" or (state["visibility"] == "department" and unit_id == channel.unit_id) else 0
    employees = sorted({person for person, unit in PositionAssignment.objects.filter(employee_id__in=candidates,
        is_active=True, released_at__isnull=True).values_list("employee_id", "position__unit_id")
        if level(before, before_rules, person, unit) != level(after, after_rules, person, unit)})
    ChannelAccessEpoch.objects.bulk_create([ChannelAccessEpoch(employee_id=value) for value in employees], ignore_conflicts=True)
    # Stable lock order also serializes simultaneous access changes in two
    # different channels without losing either employee's recovery increment.
    list(ChannelAccessEpoch.objects.select_for_update().filter(employee_id__in=employees).order_by("employee_id"))
    ChannelAccessEpoch.objects.filter(employee_id__in=employees).update(revision=F("revision")+1)
    transaction.on_commit(dispatch_authorization_invalidation)


class ChannelAccessView(SlackView):
    def managed_channel(self, channel_id, *, lock=False):
        rows = DepartmentChannel.objects.select_related("unit")
        if lock:
            rows = rows.select_for_update(of=("self",))
        channel = get_object_or_404(rows, pk=channel_id)
        if not self.policy().allows("slack.channel.access", channel.unit, channel.pk):
            raise NotFound("No puedes administrar el acceso de este canal.")
        return channel

    def get(self, request, channel_id):
        return Response(access_data(self.managed_channel(channel_id)))

    @transaction.atomic
    def patch(self, request, channel_id):
        channel = self.managed_channel(channel_id, lock=True)
        self.policy().require("slack.channel.access", channel.unit, channel.pk)
        form = ChannelAccessInput(data=request.data)
        form.is_valid(raise_exception=True)
        values = form.validated_data
        if values["version"] != channel.version:
            raise Conflict("El canal cambió. Actualiza su configuración antes de guardar.")
        validate_access(values["visibility"], values["members"], channel.unit_id)
        before = access_data(channel)
        if channel.visibility == values["visibility"] and {row["employee_id"]: row["access"] for row in before["members"]} == {
                str(row["employee_id"]): row["access"] for row in values["members"]}:
            return Response(before)
        # The same channel row is locked by sends/edits. Access revocation and
        # message writes therefore serialize on PostgreSQL, not on client timing.
        channel.access_rules.all().delete()
        ChannelAccessRule.objects.bulk_create([ChannelAccessRule(channel=channel, **row) for row in values["members"]])
        channel.visibility = values["visibility"]
        channel.version += 1
        channel.updated_at = timezone.now()
        channel.save(update_fields=["visibility", "version", "updated_at"])
        after = access_data(channel)
        record_system_event("slack.channel.access_changed", request, module_code="slack", unit=channel.unit,
            target_type="slack_channel", target_id=channel.pk, changes={"before": before, "after": after})
        invalidate_access(channel, before, after)
        publish_channel(channel, "channel.access_changed")
        return Response(after)


class ChannelManagementView(SlackView):
    def get(self, request):
        # This catalog exposes access settings, never message bodies, previews,
        # files, activity counters or unread state to an uninvited manager.
        rows = DepartmentChannel.objects.select_related("unit", "creator").order_by("name", "id")
        policy = self.policy()
        candidates = list(rows)
        policy.prime(candidates)
        ids = [row.pk for row in candidates if policy.allows("slack.channel.access", row.unit, row.pk)]
        pages = ChannelPages()
        page = pages.paginate_queryset(rows.filter(pk__in=ids), request)
        return pages.get_paginated_response([{"id": str(row.pk), "name": row.name,
            "department": department_data(row.unit), "color": row.color, "visibility": row.visibility, "version": row.version} for row in page])


class InvitationPages(CursorPagination):
    page_size = 30
    ordering = ("full_name", "id")


class ChannelPeopleView(SlackView):
    def get(self, request):
        channel_id = request.query_params.get("channel")
        if channel_id:
            try:
                channel_id = serializers.UUIDField().run_validation(channel_id)
            except serializers.ValidationError:
                raise ValidationError("Canal no válido.")
            ChannelAccessView.managed_channel(self, channel_id)
        else:
            unit_id = request.query_params.get("unit")
            from boldApp.core.models import OrganizationalUnit
            try:
                unit = get_object_or_404(OrganizationalUnit, pk=serializers.UUIDField().run_validation(unit_id)) if unit_id else None
            except serializers.ValidationError:
                raise ValidationError("Departamento no válido.")
            self.policy().require("slack.channel.create", unit)
        query = request.query_params.get("q", "").strip()[:80]
        rows = Employee.objects.filter(is_active=True, user_account__is_active=True,
            position_assignments__is_active=True, position_assignments__released_at__isnull=True)
        from boldApp.core.models import OrganizationalUnit
        active_assignments = PositionAssignment.objects.filter(is_active=True, released_at__isnull=True, employee__in=rows)
        units = OrganizationalUnit.objects.filter(pk__in=active_assignments.values("position__unit_id")).order_by("name", "id")
        counts = {row["position__unit_id"]: row["total"] for row in active_assignments.values("position__unit_id").annotate(total=Count("employee_id", distinct=True))}
        departments = [{**department_data(unit), "count": counts[unit.pk]} for unit in units]
        department = request.query_params.get("department")
        if department:
            try:
                department = serializers.UUIDField().run_validation(department)
            except serializers.ValidationError:
                raise ValidationError("Departamento de invitación no válido.")
            rows = rows.filter(pk__in=active_assignments.filter(position__unit_id=department).values("employee_id"))
        if query:
            # Normalize in Python for consistent accents on SQLite and PostgreSQL.
            from .channel_search import normalized
            query = normalized(query)
            candidates = with_identity(rows.distinct())
            ids = [person.pk for person in candidates if query in normalized(" ".join([person.full_name,
                person.user_account.email, *[row.position.unit.name for row in person.invitation_assignments]]))]
            rows = rows.filter(pk__in=ids)
        # A corporate invitation is not a pilot admission. Outside IT remains
        # unable to open Slack even if named here for a future rollout.
        pages = InvitationPages()
        page = pages.paginate_queryset(with_identity(rows.distinct().order_by("full_name", "id")), request)
        response = pages.get_paginated_response([person_data(row) for row in page])
        response.data["departments"] = departments
        return response
