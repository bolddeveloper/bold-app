"""Opt-in channel notices. No message content, task titles or Drive paths."""
from types import SimpleNamespace

from django.utils import timezone
from boldApp.core.models import PositionAssignment
from boldApp.notificaciones.events import dispatch_invalidation
from boldApp.notificaciones.models import Notification
from boldApp.notificaciones.services import create_notification
from .channel_access import ChannelPolicy
from .models import ChannelSubscription, DepartmentChannel


def notify_channel_message(message, actor):
    followers = ChannelSubscription.objects.filter(channel=message.channel, following=True).exclude(employee_id=message.author_id).values("employee_id")
    recipients = PositionAssignment.objects.select_related("employee__user_account", "position__unit", "position__job_role").filter(
        employee_id__in=followers, employee__is_active=True, employee__user_account__is_active=True, is_active=True, released_at__isnull=True)
    for recipient in recipients:
        if not ChannelPolicy(recipient).allows("slack.channel.read", message.channel.unit, message.channel_id, require_assurance=False):
            continue
        create_notification(recipient=recipient, actor=actor, event_type="slack.message_created",
            title="Nuevo mensaje en un canal seguido", body="Tienes una conversación pendiente en Slack.",
            route={"module": "slack", "channel_id": str(message.channel_id), "parent_id": str(message.parent_id) if message.parent_id else None},
            resource_type="slack_channel", resource_id=message.channel_id,
            metadata={"message_id": str(message.pk), "sequence": message.sequence, "parent_id": str(message.parent_id) if message.parent_id else ""},
            dedupe_key="slack.message:" + str(message.pk), robust_dispatch=True)


def mark_channel_notices_read(channel_id, employee_id, *, sequence=None, parent_id=None):
    rows = Notification.objects.filter(module="slack", resource_type="slack_channel", resource_id=channel_id,
        recipient_assignment__employee_id=employee_id, is_read=False)
    if sequence is not None:
        rows = rows.filter(metadata__sequence__lte=sequence, metadata__parent_id=str(parent_id) if parent_id else "")
    assignments = list(rows.values_list("recipient_assignment_id", flat=True).distinct())
    if rows.update(is_read=True, read_at=timezone.now()):
        for assignment_id in assignments:
            dispatch_invalidation(assignment_id)


def notification_channel_readable(assignment, notification, session=None, *, push=False):
    if notification.resource_type != "slack_channel":
        return False
    channel = DepartmentChannel.objects.select_related("unit").filter(pk=notification.resource_id).first()
    if not channel:
        return False
    if push and (notification.is_read or notification.dismissed_at or not ChannelSubscription.objects.filter(
            channel=channel, employee_id=assignment.employee_id, following=True).exists()):
        return False
    return ChannelPolicy(assignment, SimpleNamespace(auth=session)).allows("slack.channel.read", channel.unit, channel.pk)
