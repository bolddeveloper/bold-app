"""Resource boundary, enforced before even Core's company-owner bypass.

Invitations belong to a person; department membership uses only the active
assignment. Access administration never implies access to channel content.
"""
from django.db.models import Exists, OuterRef, Q, Subquery

from .channel_models import ChannelAccessRule, DepartmentChannel


def readable_channels(rows, employee_id, unit_id):
    rule = ChannelAccessRule.objects.filter(channel_id=OuterRef("pk"), employee_id=employee_id)
    return rows.annotate(_channel_access=Subquery(rule.values("access")[:1]), _has_channel_access=Exists(rule)).filter(
        Q(_channel_access__in=["read", "write"]) |
        (Q(_has_channel_access=False) & (Q(visibility="public") | Q(visibility="department", unit_id=unit_id))))


def channel_context(assignment, resource_id, context=None):
    key = ("slack_channel", str(resource_id))
    if context is not None and key in context.resource_contexts:
        return context.resource_contexts[key]
    channel = DepartmentChannel.objects.filter(pk=resource_id).values("id", "unit_id", "creator_id", "creator__employee_id", "visibility").first()
    if channel:
        channel["access"] = ChannelAccessRule.objects.filter(channel_id=resource_id, employee_id=assignment.employee_id).values_list("access", flat=True).first()
    if context is not None:
        context.resource_contexts[key] = channel
    return channel


def boundary_allows(assignment, permission, target_unit, resource_id, context):
    channel = channel_context(assignment, resource_id, context)
    if not channel or target_unit.pk != (channel["unit_id"] or assignment.position.unit_id):
        return False
    # Management can be scoped to a department without inviting the manager.
    if permission.code == "slack.channel.access":
        return True
    access = channel["access"]
    readable = access in ("read", "write") or (access is None and (
        channel["visibility"] == "public" or
        (channel["visibility"] == "department" and channel["unit_id"] == assignment.position.unit_id)))
    if not readable:
        return False
    return permission.code in {"slack.channel.read", "slack.page.read", "slack.template.read"} or access != "read"
