"""Bounded invalidation hints on the existing socket; no message-body fanout."""
import logging
from types import SimpleNamespace

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import transaction

from boldApp.core.events import build_event_envelope
from boldApp.core.models import PositionAssignment
from .channel_access import ChannelPolicy
from .models import DepartmentChannel

log = logging.getLogger(__name__)


def publish_channel(channel, kind, employee_id=None):
    event = {"type": "slack.changed", "channel_id": str(channel.pk), "kind": kind,
             "activity_version": channel.activity_version, "version": channel.version}

    def dispatch():
        try:
            layer = get_channel_layer()
            if layer is not None:
                async_to_sync(layer.group_send)(f"messaging_employee_{employee_id}" if employee_id else "slack_watch", event)
        except Exception:
            log.warning("Slack push unavailable; persisted channel remains available")
    transaction.on_commit(dispatch, robust=True)


def channel_event(assignment_id, event, session_id=None):
    assignment = PositionAssignment.objects.select_related("employee__user_account", "position__unit", "position__job_role").filter(pk=assignment_id).first()
    channel = DepartmentChannel.objects.select_related("unit").filter(pk=event.get("channel_id")).first()
    request = None
    if session_id:
        from boldApp.autenticacion.models import AuthSession
        session = AuthSession.objects.filter(pk=session_id, user_account__employee_id=getattr(assignment, "employee_id", None)).first()
        request = SimpleNamespace(auth=session)
    if not assignment or not channel or not ChannelPolicy(assignment, request).allows("slack.channel.read", channel.unit, channel.pk):
        return None
    if event.get('kind')=='page.comments_changed':
        policy=ChannelPolicy(assignment,request)
        if not all(policy.allows(code,channel.unit,channel.pk) for code in ('slack.page.read','slack.page_comment.read')):
            return None
    if event.get('kind') == 'page.links_changed':
        related=DepartmentChannel.objects.select_related('unit').filter(pk=event.get('related_channel_id')).first()
        policy=ChannelPolicy(assignment,request)
        if not related or not all(policy.allows(code,row.unit,row.pk)
            for row in (channel,related) for code in ('slack.channel.read','slack.page.read')):
            return None
    # Read current revisions, not a delayed or reordered broadcast's old values.
    return build_event_envelope("slack.changed", "slack_channel", channel.pk,
        {"channel_id": str(channel.pk), "kind": event["kind"], "activity_version": channel.activity_version, "version": channel.version})


def publish_page_link_hint(channel_id, related_channel_id):
    # Internal second boundary is checked separately for each receiving session.
    # Never put a related private channel/page ID, title, count or body in the DTO.
    event={'type':'slack.changed','channel_id':str(channel_id),'related_channel_id':str(related_channel_id),'kind':'page.links_changed'}
    def dispatch():
        try:
            layer=get_channel_layer()
            if layer is not None:
                async_to_sync(layer.group_send)('slack_watch',event)
        except Exception:
            log.warning('Page link hint unavailable; persisted links remain available')
    transaction.on_commit(dispatch,robust=True)
