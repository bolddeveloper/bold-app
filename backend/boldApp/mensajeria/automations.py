"""Three bounded actions. Transactions persist effects and their receipts together.

Lock order: channel -> budget -> rule -> run. Task capture locks its Task then
budget, never a channel/rule. Workers never lock or write Tasks. No provider I/O.
"""
import copy
import logging
import uuid
from datetime import timedelta
from types import SimpleNamespace

from django.conf import settings
from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone
from rest_framework.exceptions import NotFound, ValidationError
from .automation_models import AutomationBudget, ChannelAutomation, AutomationRun, AutomationAudit
from .channel_access import ChannelPolicy
from .channel_tasks import TaskReferences
from .page_content import digest, validate_blocks

log = logging.getLogger(__name__)


class ScopeUnavailable(Exception):
    def __init__(self, reason):
        self.reason = reason


def enabled():
    return settings.MESSAGING_AUTOMATIONS_ENABLED


def changed(rule):
    from .channel_events import publish_channel
    # Private invalidation only, not the rule name, criteria, body or task IDs.
    publish_channel(rule.channel, 'automation.changed', employee_id=rule.assignment.employee_id)


def budget_lock():
    AutomationBudget.objects.get_or_create(pk=1)
    return AutomationBudget.objects.select_for_update().get(pk=1)


def room(account_id, extra=1):
    # A hard logical budget. Never delete audit/effects to make room for more.
    total = AutomationRun.objects.count() + AutomationAudit.objects.count()
    own = AutomationRun.objects.filter(rule__account_id=account_id).count() + AutomationAudit.objects.filter(rule__account_id=account_id).count()
    return total + extra <= settings.MESSAGING_AUTOMATION_MAX_RECORDS and own + extra <= settings.MESSAGING_AUTOMATION_ACCOUNT_RECORDS


def identity(rule):
    from boldApp.core.models import PositionAssignment, UserAccount
    from .access import assignment_can_chat
    account = UserAccount.objects.filter(pk=rule.account_id, is_active=True, must_change_password=False).first()
    assignment = PositionAssignment.objects.select_related('employee', 'position__unit', 'position__job_role').filter(pk=rule.assignment_id).first()
    if not account or not assignment_can_chat(assignment) or account.employee_id != assignment.employee_id:
        raise ScopeUnavailable('identity_unavailable')
    if rule.credentials_version != account.credentials_version or rule.assignment_unit_id != assignment.position.unit_id:
        raise ScopeUnavailable('identity_changed')
    request = SimpleNamespace(user=account, assignment=assignment, auth=None)
    return request, ChannelPolicy(assignment, request)


def source(rule, request, policy, channel):
    """Current permission check, also used before explicit activation.

    No recent-session MFA can be fabricated for unattended work. A permission
    configured to require it stops this action, including on company owners.
    """
    if channel.archived_at or not all(policy.allows(code, channel.unit, channel.pk) for code in
            ('slack.channel.read', 'slack.automation.read', 'slack.automation.manage')):
        raise ScopeUnavailable('channel_permission')
    if rule.kind in ('task_status', 'reminder'):
        if not policy.allows('slack.message.create', channel.unit, channel.pk):
            raise ScopeUnavailable('message_permission')
    if rule.kind == 'task_status':
        from boldApp.tareas.models import Project, TaskStatus
        from boldApp.tareas.views import TaskViewSet
        from boldApp.core.models import Permission
        from boldApp.core.authorization import resolve_access, apply_session_assurance
        view = TaskViewSet(); view.request = request
        project = view.visible_projects(Project.objects.filter(pk=rule.project_id, is_archived=False)).select_related('unit').first()
        permission = Permission.objects.filter(code='tasks.project.read', is_active=True).first()
        if not project or not permission or not apply_session_assurance(resolve_access(request.assignment,
                permission, project.unit, resource_id=project.pk), permission, request).allowed:
            raise ScopeUnavailable('project_permission')
        if rule.source_unit_id and project.unit_id != rule.source_unit_id:
            raise ScopeUnavailable('source_changed')
        statuses = TaskStatus.objects.filter(Q(unit=project.unit) | Q(unit__isnull=True))
        if not statuses.filter(pk=rule.to_status_id).exists() or rule.from_status_id and not statuses.filter(pk=rule.from_status_id).exists():
            raise ScopeUnavailable('status_unavailable')
        return project
    if rule.kind == 'recurring_page':
        from .page_models import PageTemplate
        if not all(policy.allows(code, channel.unit, channel.pk) for code in
                ('slack.template.read', 'slack.page.read', 'slack.page.create')):
            raise ScopeUnavailable('page_permission')
        template = PageTemplate.objects.filter(pk=rule.template_id, channel=channel, archived_at__isnull=True).first()
        if not template or template.version != rule.template_version:
            raise ScopeUnavailable('template_changed')
        # New references must still be readable; no opaque old block exception.
        validate_blocks(template.blocks, request.assignment, request)
        return template
    if rule.kind != 'reminder':
        raise ScopeUnavailable('unsupported_kind')


def pause(rule, reason):
    rule.active = False; rule.pause_reason = reason; rule.version += 1
    rule.save(update_fields=['active', 'pause_reason', 'version', 'updated_at'])


def capture_previous(sender, instance, raw=False, **kwargs):
    if raw or not enabled():
        return
    from boldApp.tareas.models import Task
    # Task.save wraps pre/post-save in atomic. Serialize stale ORM instances too.
    instance._slack_automation_previous = Task.all_objects.select_for_update().filter(pk=instance.pk).values('status_id').first()


def capture_change(sender, instance, created=False, raw=False, **kwargs):
    if raw or created or not enabled():
        return
    from boldApp.tareas.models import Task, TaskProject
    old = getattr(instance, '_slack_automation_previous', None)
    current = Task.objects.filter(pk=instance.pk).values('status_id').first()
    if not old or not current or old['status_id'] == current['status_id']:
        return
    candidates = ChannelAutomation.objects.filter(active=True, kind='task_status', to_status_id=current['status_id'],
        project_id__in=TaskProject.objects.filter(task_id=instance.pk).values('project_id')).filter(
            Q(from_status_id__isnull=True) | Q(from_status_id=old['status_id']))
    if not candidates.exists():
        return
    budget_lock()
    occurrence = 'task:' + str(uuid.uuid4())
    # Total rule count is limited at creation. This query cannot fan out unbounded.
    rules = list(candidates.order_by('pk').only('id', 'account_id', 'version')[:settings.MESSAGING_AUTOMATION_MAX_RULES])
    account_ids = {row.account_id for row in rules}
    total = AutomationRun.objects.count() + AutomationAudit.objects.count()
    own = dict.fromkeys(account_ids, 0)
    # All reservations/audit appends hold budget. Count once per batch, not four
    # full-history COUNT queries for each matched rule inside the Task save.
    for model in (AutomationRun, AutomationAudit):
        for value in model.objects.filter(rule__account_id__in=account_ids).values('rule__account_id').annotate(n=Count('pk')):
            own[value['rule__account_id']] += value['n']
    pending = []
    for rule in rules:
        if total + 1 > settings.MESSAGING_AUTOMATION_MAX_RECORDS or own[rule.account_id] + 1 > settings.MESSAGING_AUTOMATION_ACCOUNT_RECORDS:
            # Do not take a rule lock after Task/budget; an explicit worker pass
            # will reconcile capacity. Record no unbounded backlog at the limit.
            ChannelAutomation.objects.filter(pk=rule.pk, active=True, version=rule.version).update(
                active=False, pause_reason='capacity', version=rule.version + 1)
            continue
        pending.append(AutomationRun(rule=rule, occurrence=occurrence, rule_version=rule.version,
            task_id=instance.pk, from_status_id=old['status_id'], to_status_id=current['status_id'], next_attempt_at=timezone.now()))
        total += 1; own[rule.account_id] += 1
    AutomationRun.objects.bulk_create(pending)


def connect():
    from django.db.models.signals import pre_save, post_save
    from boldApp.tareas.models import Task
    pre_save.connect(capture_previous, sender=Task, dispatch_uid='slack_automation_task_before')
    post_save.connect(capture_change, sender=Task, dispatch_uid='slack_automation_task_after')


def publish_message(rule, run, request, channel):
    from .channel_models import ChannelMessage
    from .channel_views import department_data
    from .channel_events import publish_channel
    from .channel_notifications import notify_channel_message
    body = 'Automatización: una tarea del proyecto cambió al estado configurado.' if rule.kind == 'task_status' else rule.body
    department = department_data(request.assignment.position.unit)
    channel.activity_version += 1
    message = ChannelMessage.objects.create(channel=channel, author_id=request.assignment.employee_id,
        author_assignment=request.assignment, department_name=department['name'], department_color=department['color'],
        client_id=run.pk, payload_digest=digest({'automation':str(run.pk)}), sequence=channel.activity_version,
        body=body, task_id=run.task_id, automation_kind=rule.kind)
    channel.updated_at = message.created_at
    channel.save(update_fields=['activity_version', 'updated_at'])
    # Deliberately no mention parser: a schedule must not become a mass-mention bot.
    notify_channel_message(message, request.assignment)
    publish_channel(channel, 'message.created')
    run.message = message


def publish_page(rule, run, request, policy, channel, template):
    from .page_models import ChannelPage
    from .page_views import record
    from .page_mentions import sync_page_mentions
    from .channel_events import publish_channel
    blocks = copy.deepcopy(template.blocks)
    for block in blocks:
        block['id'] = str(uuid.uuid4())
    receipt = digest({'automation':str(run.pk), 'template_version':rule.template_version})
    page = ChannelPage.objects.create(channel=channel, creator_id=request.assignment.employee_id,
        updated_by_id=request.assignment.employee_id, client_id=run.pk, creation_digest=receipt,
        title=template.title, icon=template.icon, blocks=blocks)
    sync_page_mentions(page, policy, notify=False)
    record(page, request.assignment.employee_id, run.pk, receipt)
    publish_channel(channel, 'page.structure_changed')
    run.page = page


@transaction.atomic
def execute(rule_id, run_id=None, *, now=None):
    """Exactly one local effect and receipt, or neither. Safe after lost replies."""
    from .channel_models import DepartmentChannel
    from boldApp.tareas.models import TaskProject
    now = now or timezone.now()
    channel_id = ChannelAutomation.objects.filter(pk=rule_id).values_list('channel_id', flat=True).first()
    if channel_id is None:
        return 'missing'
    channel = DepartmentChannel.objects.select_for_update(of=('self',)).select_related('unit').get(pk=channel_id)
    budget_lock()
    rule = ChannelAutomation.objects.select_for_update().get(pk=rule_id)
    run = rule.runs.select_for_update().filter(pk=run_id).first() if run_id else None
    if run_id and (not run or run.state != 'pending' or run.next_attempt_at > now):
        return 'settled'
    if not run_id:
        if not rule.active or rule.kind == 'task_status' or not rule.next_at or rule.next_at > now:
            return 'not_due'
        occurrence = 'due:' + rule.next_at.isoformat()
        run = rule.runs.filter(occurrence=occurrence).first()
        if not run:
            if not room(rule.account_id):
                pause(rule, 'capacity'); changed(rule); return 'capacity'
            run = rule.runs.create(occurrence=occurrence, rule_version=rule.version, next_attempt_at=now)
        if run.state != 'pending' or run.next_attempt_at > now:
            return 'settled'
    if not rule.active or run.rule_version != rule.version:
        run.state = 'skipped'; run.reason = 'rule_changed'
    else:
        try:
            request, policy = identity(rule)
            template = source(rule, request, policy, channel)
            if rule.kind == 'task_status':
                if not TaskProject.objects.filter(project_id=rule.project_id, task_id=run.task_id).exists():
                    raise ScopeUnavailable('task_scope_changed')
                TaskReferences(request.assignment, request).require(run.task_id)
            if rule.kind == 'recurring_page':
                publish_page(rule, run, request, policy, channel, template)
            else:
                publish_message(rule, run, request, channel)
            run.state = 'published'; run.reason = ''
        except ScopeUnavailable as error:
            pause(rule, error.reason); run.state = 'skipped'; run.reason = error.reason
        except (NotFound, ValidationError):
            pause(rule, 'source_permission'); run.state = 'skipped'; run.reason = 'source_permission'
    run.attempts += 1; run.finished_at = now
    run.save(update_fields=['state', 'reason', 'attempts', 'finished_at', 'message', 'page'])
    if run.state == 'published' and rule.kind != 'task_status':
        if rule.interval_days:
            # Fixed UTC intervals, explicitly NOT monthly/local-time/DST schedules.
            step = timedelta(days=rule.interval_days)
            rule.next_at += step * (int((now - rule.next_at) // step) + 1)
            rule.save(update_fields=['next_at', 'updated_at'])
        else:
            pause(rule, 'completed')
    changed(rule)
    return run.state


def drain(*, limit=25, now=None):
    if not enabled():
        return {'examined':0, 'published':0, 'failed':0, 'enabled':False}
    now = now or timezone.now()
    pending = list(AutomationRun.objects.filter(state='pending', next_attempt_at__lte=now).order_by('next_attempt_at', 'pk')
        .values_list('rule_id', 'pk', 'rule_version')[:limit])
    due = list(ChannelAutomation.objects.filter(active=True, next_at__lte=now).exclude(kind='task_status')
        .exclude(pk__in=[item[0] for item in pending]).order_by('next_at', 'pk')
        .values_list('pk', 'version', 'next_at')[:max(0, limit - len(pending))])
    result = {'examined':0, 'published':0, 'failed':0, 'enabled':True}
    for rule_id, run_id, version, planned in [*((pk, run, version, None) for pk, run, version in pending),
            *((pk, None, version, planned) for pk, version, planned in due)]:
        result['examined'] += 1
        try:
            state = execute(rule_id, run_id, now=now)
            result['published'] += state == 'published'
        except Exception as error:
            # A rolled-back run can be retried. Persist backoff without logging
            # source content/credentials or creating a replacement occurrence.
            result['failed'] += 1
            log.warning('Channel automation transaction failed (%s); preserving occurrence for bounded retry', type(error).__name__)
            record_failure(rule_id, run_id, now, version=version, planned=planned)
    return result


@transaction.atomic
def record_failure(rule_id, run_id, now, *, version=None, planned=None):
    from .channel_models import DepartmentChannel
    channel_id = ChannelAutomation.objects.filter(pk=rule_id).values_list('channel_id', flat=True).first()
    if channel_id is None:
        return
    DepartmentChannel.objects.select_for_update().get(pk=channel_id)
    budget_lock()
    rule = ChannelAutomation.objects.select_for_update().get(pk=rule_id)
    if not rule.active or version is not None and rule.version != version:
        return
    run = rule.runs.select_for_update().filter(pk=run_id).first() if run_id else None
    if not run:
        if not rule.next_at or rule.next_at > now or planned is not None and rule.next_at != planned:
            return  # Another worker/editor already settled or replaced this occurrence.
        occurrence = 'due:' + rule.next_at.isoformat()
        run = rule.runs.filter(occurrence=occurrence).first()
        if not run:
            if not room(rule.account_id):
                pause(rule, 'capacity'); return
            run = rule.runs.create(occurrence=occurrence, rule_version=rule.version, next_attempt_at=now)
    if run.state != 'pending':
        return
    run.attempts += 1; run.reason = 'worker_error'
    run.next_attempt_at = now + timedelta(seconds=60 * 5 ** min(run.attempts - 1, 2))
    if run.attempts >= 3:
        run.state = 'failed'; run.finished_at = now; pause(rule, 'worker_error')
    run.save(update_fields=['attempts', 'reason', 'next_attempt_at', 'state', 'finished_at'])
    changed(rule)
