"""Resource boundary, enforced before even Core's company-owner bypass.

Invitations belong to a person; department membership uses only the active
assignment. Access administration never implies access to channel content.
"""
from django.db.models import Exists, OuterRef, Q, Subquery

from .channel_models import ChannelAccessRule, DepartmentChannel, PrivateServerMember


def readable_channels(rows, employee_id, unit_id):
    rule = ChannelAccessRule.objects.filter(channel_id=OuterRef("pk"), employee_id=employee_id)
    member = PrivateServerMember.objects.filter(server_id=OuterRef("server_id"), server__deleted_at__isnull=True, employee_id=employee_id)
    return rows.filter(deleted_at__isnull=True).annotate(_server_access=Subquery(member.values("access")[:1]),
        _channel_access=Subquery(rule.values("access")[:1]), _has_channel_access=Exists(rule)).filter(
        Q(server__isnull=False, _server_access__in=["read", "write"]) |
        (Q(server__isnull=True) & (Q(_channel_access__in=["read", "write"]) |
        (Q(_has_channel_access=False) & (Q(visibility="public") | Q(visibility="department", unit_id=unit_id))))))


def channel_context(assignment, resource_id, context=None):
    key = ("slack_channel", str(resource_id))
    if context is not None and key in context.resource_contexts:
        return context.resource_contexts[key]
    channel = DepartmentChannel.objects.filter(pk=resource_id).values("id", "unit_id", "creator_id", "creator__employee_id", "visibility", "server_id", "server__creator__employee_id", "deleted_at").first()
    if channel:
        channel["access"] = ChannelAccessRule.objects.filter(channel_id=resource_id, employee_id=assignment.employee_id).values_list("access", flat=True).first()
        if channel["server_id"]:
            channel["server_access"] = PrivateServerMember.objects.filter(server_id=channel["server_id"], server__deleted_at__isnull=True, employee_id=assignment.employee_id).values_list("access", flat=True).first()
    if context is not None:
        context.resource_contexts[key] = channel
    return channel


def boundary_allows(assignment, permission, target_unit, resource_id, context):
    channel = channel_context(assignment, resource_id, context)
    if not channel or channel["deleted_at"] or target_unit.pk != (channel["unit_id"] or assignment.position.unit_id):
        return False
    if channel.get("server_id"):
        access = channel.get("server_access")
        if access not in ("read", "write"):
            return False
        if permission.code in {"slack.channel.manage", "slack.channel.access"}:
            return channel["server__creator__employee_id"] == assignment.employee_id
        return permission.code in {"slack.channel.read", "slack.page.read", "slack.template.read", "slack.page_comment.read", "slack.automation.read"} or access == "write"
    # Management can be scoped to a department without inviting the manager.
    if permission.code == "slack.channel.access":
        return True
    access = channel["access"]
    readable = access in ("read", "write") or (access is None and (
        channel["visibility"] == "public" or
        (channel["visibility"] == "department" and channel["unit_id"] == assignment.position.unit_id)))
    if not readable:
        return False
    return permission.code in {"slack.channel.read", "slack.page.read", "slack.template.read", "slack.page_comment.read", "slack.automation.read"} or access != "read"
