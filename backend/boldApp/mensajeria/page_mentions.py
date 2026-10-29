"""Page references share source transactions and existing Slack preferences."""
from types import SimpleNamespace
from bisect import bisect_right

from boldApp.autenticacion.notification_settings import event_preferences
from boldApp.core.models import PositionAssignment
from boldApp.notificaciones.services import create_notification
from boldApp.notificaciones.models import Notification
from .channel_access import ChannelPolicy
from .mentions import LITERAL, TOKEN, _people_for_tokens, authorized_people, mention_tokens, sync_resource_mentions, with_mention_assignments
from .models import ChannelPage, ResourceMention
from .search_text import page_text
from .page_formatting import mention_text

PAGE_READ_CODES = ("slack.channel.read", "slack.page.read")
MAX_PAGE_MENTIONS = 50


def page_mention_locations(page):
    fields = [('title', page.title), *((block['id'], mention_text(block)) for block in page.blocks if block.get('type') not in ('task','code'))]
    text = '\n'.join(value for _, value in fields)
    if '@' not in text:
        return {}
    starts, offset = [], 0
    for _, value in fields:
        starts.append(offset);offset += len(value) + 1
    plain = LITERAL.sub(lambda match: ' ' * len(match.group()), text)
    result = {}
    for match in TOKEN.finditer(plain):
        field = fields[bisect_right(starts, match.start())-1][0]
        result.setdefault(field, set()).add(match.group(1).lower())
    return result


def page_mentions(page, *, title=None, blocks=None):
    if title is None and blocks is None and hasattr(page, '_mentions'):
        return page._mentions
    tokens = mention_tokens(page_text(SimpleNamespace(title=page.title if title is None else title,
        blocks=page.blocks if blocks is None else blocks),include_code=False))
    if not tokens:
        return []
    return [{"employee_id": str(row['employee_id']), "token": row['token'], "name": row['name']}
        for row in ResourceMention.objects.filter(document__page=page, token__in=tokens).values('employee_id', 'token', 'name')]


def sync_page_mentions(page, policy, *, notify=True, previous=None):
    sync_resource_mentions(page, 'page', page_text(page,include_code=False), lambda tokens: authorized_people(
        with_mention_assignments(_people_for_tokens(tokens)), page.channel, policy.permissions, PAGE_READ_CODES), maximum=MAX_PAGE_MENTIONS)
    if notify and page._mentions and not page.archived_at and not page.channel.archived_at:
        introduced = {field:tokens - (previous or {}).get(field, set()) for field, tokens in page_mention_locations(page).items()}
        targets = {}
        for row in page._mentions:
            for field, tokens in introduced.items():
                if row['token'] in tokens:
                    targets.setdefault(row['employee_id'], set()).add(field)
        if targets:
            notify_page_mentions(page, policy, targets)


def notify_page_mentions(page, policy, targets):
    recipients = list(PositionAssignment.objects.select_related('employee__user_account', 'position__unit', 'position__job_role').filter(
        employee_id__in=targets, employee__is_active=True, employee__user_account__is_active=True,
        is_active=True, released_at__isnull=True).exclude(employee_id=policy.assignment.employee_id))
    fields = ['title', *(block['id'] for block in page.blocks if block.get('type') not in ('task','code'))]
    keys = {field:'slack.page_mention:' + str(page.pk) + ':' + field for field in fields}
    notified = set(Notification.objects.filter(recipient_assignment_id__in=[row.pk for row in recipients],
        dedupe_key__in=keys.values()).values_list('recipient_assignment_id', 'dedupe_key'))
    for recipient in recipients:
        if not event_preferences(recipient.employee.user_account.notification_settings)['slack.mentioned']:
            continue
        recipient_policy = ChannelPolicy(recipient, permissions=policy.permissions)
        if not all(recipient_policy.allows(code, page.channel.unit, page.channel_id, require_assurance=False) for code in PAGE_READ_CODES):
            continue
        field = next((field for field in fields if field in targets[str(recipient.employee_id)] and (recipient.pk, keys[field]) not in notified), None)
        if field is None:
            continue
        create_notification(recipient=recipient, actor=policy.assignment, event_type='slack.mentioned',
            title='Te mencionaron en una página de Slack', body='Tienes una mención pendiente en una página del equipo.',
            route={'module':'slack', 'channel_id':str(page.channel_id), 'page_id':str(page.pk), 'block_id':field},
            resource_type='slack_page', resource_id=page.pk, metadata={},
            dedupe_key=keys[field], robust_dispatch=True)


def notification_page_readable(assignment, notification, session=None, *, push=False):
    page = ChannelPage.objects.select_related('channel__unit').filter(pk=notification.resource_id).first()
    if not page:
        return False
    policy = ChannelPolicy(assignment, SimpleNamespace(auth=session))
    if not all(policy.allows(code, page.channel.unit, page.channel_id) for code in PAGE_READ_CODES):
        return False
    if push:
        if notification.is_read or notification.dismissed_at or page.archived_at or page.channel.archived_at:
            return False
        if not event_preferences(assignment.employee.user_account.notification_settings)['slack.mentioned']:
            return False
        tokens = page_mention_locations(page).get(notification.route.get('block_id'), set())
        return any(row['employee_id'] == str(assignment.employee_id) and row['token'] in tokens for row in page_mentions(page))
    return True
