"""Opt-in channel notices. No message content, task titles or Drive paths."""
from types import SimpleNamespace
import uuid

from django.utils import timezone
from boldApp.core.models import PositionAssignment
from boldApp.notificaciones.events import dispatch_invalidation
from boldApp.notificaciones.models import Notification
from boldApp.notificaciones.services import create_notification
from boldApp.autenticacion.notification_settings import event_preferences
from .channel_access import ChannelPolicy
from .models import ChannelSubscription, ChannelThreadSubscription, DepartmentChannel
from .mentions import active_channel_mention, channel_mentions


def notify_channel_message(message, actor, *, mentioned_only=None):
    if mentioned_only is not None and not mentioned_only:
        return
    mentioned = {uuid.UUID(row["employee_id"]) for row in channel_mentions(message)}
    followers = set(ChannelSubscription.objects.filter(channel=message.channel, following=True).values_list("employee_id", flat=True))
    threads = set(ChannelThreadSubscription.objects.filter(parent_id=message.parent_id, parent__channel_id=message.channel_id,
        parent__parent__isnull=True, following=True).values_list("employee_id", flat=True)) if message.parent_id else set()
    followed = followers | threads
    targets = mentioned_only if mentioned_only is not None else followed | mentioned
    if not targets:
        return
    permissions = ChannelPolicy(actor).permissions
    recipients = PositionAssignment.objects.select_related("employee__user_account", "position__unit", "position__job_role").filter(
        employee_id__in=targets, employee__is_active=True,
        employee__user_account__is_active=True, is_active=True, released_at__isnull=True).exclude(employee_id=message.author_id)
    for recipient in recipients:
        is_mention = recipient.employee_id in mentioned and event_preferences(recipient.employee.user_account.notification_settings)["slack.mentioned"]
        if not is_mention and (mentioned_only is not None or recipient.employee_id not in followed):
            continue
        if not ChannelPolicy(recipient, permissions=permissions).allows("slack.channel.read", message.channel.unit, message.channel_id, require_assurance=False):
            continue
        create_notification(recipient=recipient, actor=actor, event_type="slack.mentioned" if is_mention else "slack.message_created",
            title="Te mencionaron en Slack" if is_mention else "Nuevo mensaje en una conversación seguida",
            body="Tienes una mención pendiente en Slack." if is_mention else "Tienes una conversación pendiente en Slack.",
            route={"module": "slack", "channel_id": str(message.channel_id), "parent_id": str(message.parent_id or message.pk) if is_mention or message.parent_id else None},
            resource_type="slack_channel", resource_id=message.channel_id,
            metadata={"message_id": str(message.pk), "sequence": message.sequence, "parent_id": str(message.parent_id) if message.parent_id else ""},
            dedupe_key=("slack.mention:" if is_mention else "slack.message:") + str(message.pk), robust_dispatch=True)


def mark_channel_notices_read(channel_id, employee_id, *, sequence=None, parent_id=None):
    rows = Notification.objects.filter(module="slack", resource_type="slack_channel", resource_id=channel_id,
        recipient_assignment__employee_id=employee_id, is_read=False)
    if sequence is not None:
        rows = rows.filter(metadata__sequence__lte=sequence, metadata__parent_id=str(parent_id) if parent_id else "")
    _mark_read(rows)


def _mark_read(rows):
    assignments = list(rows.values_list("recipient_assignment_id", flat=True).distinct())
    if rows.update(is_read=True, read_at=timezone.now()):
        for assignment_id in assignments:
            dispatch_invalidation(assignment_id)


def mark_unfollowed_notices_read(channel_id, employee_id):
    if ChannelSubscription.objects.filter(channel_id=channel_id, employee_id=employee_id, following=True).exists():
        return
    followed = [str(pk) for pk in ChannelThreadSubscription.objects.filter(employee_id=employee_id,
        parent__channel_id=channel_id, following=True, parent__parent__isnull=True).values_list("parent_id", flat=True)]
    rows = Notification.objects.filter(module="slack", resource_type="slack_channel", resource_id=channel_id,
        recipient_assignment__employee_id=employee_id, is_read=False).exclude(type="slack.mentioned")
    if followed:
        rows = rows.exclude(metadata__parent_id__in=followed)
    _mark_read(rows)


def notification_channel_readable(assignment, notification, session=None, *, push=False):
    if notification.resource_type == 'slack_page':
        from .page_mentions import notification_page_readable
        return notification_page_readable(assignment, notification, session, push=push)
    if notification.resource_type != "slack_channel":
        return False
    channel = DepartmentChannel.objects.select_related("unit").filter(pk=notification.resource_id).first()
    if not channel:
        return False
    if push:
        if notification.is_read or notification.dismissed_at:
            return False
        if notification.type == "slack.mentioned":
            try:
                message_id = uuid.UUID(notification.metadata.get("message_id", ""))
            except (ValueError, TypeError, AttributeError):
                return False
            if not event_preferences(assignment.employee.user_account.notification_settings)["slack.mentioned"] or not active_channel_mention(channel.pk, message_id, assignment.employee_id):
                return False
            return ChannelPolicy(assignment, SimpleNamespace(auth=session)).allows("slack.channel.read", channel.unit, channel.pk)
        opted_in = ChannelSubscription.objects.filter(channel=channel, employee_id=assignment.employee_id, following=True).exists()
        if not opted_in:
            try:
                parent_id = uuid.UUID(notification.metadata.get("parent_id", ""))
            except (ValueError, TypeError, AttributeError):
                return False
            if not ChannelThreadSubscription.objects.filter(parent_id=parent_id, parent__channel=channel,
                    parent__parent__isnull=True, employee_id=assignment.employee_id, following=True).exists():
                return False
    return ChannelPolicy(assignment, SimpleNamespace(auth=session)).allows("slack.channel.read", channel.unit, channel.pk)
