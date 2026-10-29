"""Explicit, owner-scoped schedules; no generic expression/action interpreter."""
from django.conf import settings
from django.db import models
from boldApp.core.models.mixins import UUIDPrimaryKeyModel


class AutomationBudget(models.Model):
    id = models.PositiveSmallIntegerField(primary_key=True, default=1)


class ChannelAutomation(UUIDPrimaryKeyModel):
    channel = models.ForeignKey('boldApp_mensajeria.DepartmentChannel', on_delete=models.PROTECT, related_name='automations')
    account = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    assignment = models.ForeignKey('boldApp_core.PositionAssignment', on_delete=models.PROTECT)
    client_id = models.UUIDField()
    creation_digest = models.CharField(max_length=64)
    name = models.CharField(max_length=120)
    kind = models.CharField(max_length=20, choices=[(v, v) for v in ('task_status', 'reminder', 'recurring_page')])
    # No snapshots of project/status/template titles or source task content.
    project_id = models.UUIDField(null=True)
    to_status_id = models.UUIDField(null=True)
    from_status_id = models.UUIDField(null=True)
    template_id = models.UUIDField(null=True)
    template_version = models.PositiveIntegerField(null=True)
    body = models.CharField(max_length=2000, blank=True)
    next_at = models.DateTimeField(null=True)
    interval_days = models.PositiveSmallIntegerField(null=True)
    active = models.BooleanField(default=False)
    version = models.PositiveIntegerField(default=1)
    activated_at = models.DateTimeField(null=True)
    credentials_version = models.PositiveIntegerField(null=True)
    assignment_unit_id = models.UUIDField(null=True)
    source_unit_id = models.UUIDField(null=True)
    pause_reason = models.CharField(max_length=40, blank=True)
    last_stop_client_id = models.UUIDField(null=True)
    last_stop_digest = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'messaging_channel_automations'
        constraints = [models.UniqueConstraint(fields=['account', 'client_id'], name='slack_automation_create_retry'),
            models.CheckConstraint(condition=models.Q(kind__in=['task_status', 'reminder', 'recurring_page']), name='slack_automation_kind'),
            models.CheckConstraint(condition=models.Q(interval_days__isnull=True) | models.Q(interval_days__gte=1, interval_days__lte=365), name='slack_automation_interval')]
        indexes = [models.Index(fields=['active', 'next_at'], name='slack_automation_due'),
            models.Index(fields=['project_id', 'to_status_id'], condition=models.Q(active=True, kind='task_status'), name='slack_automation_status')]


class AutomationRun(UUIDPrimaryKeyModel):
    rule = models.ForeignKey(ChannelAutomation, on_delete=models.PROTECT, related_name='runs')
    occurrence = models.CharField(max_length=100)
    rule_version = models.PositiveIntegerField()
    task_id = models.UUIDField(null=True)
    from_status_id = models.UUIDField(null=True)
    to_status_id = models.UUIDField(null=True)
    state = models.CharField(max_length=12, default='pending', choices=[(v, v) for v in ('pending', 'published', 'skipped', 'failed')])
    reason = models.CharField(max_length=40, blank=True)
    attempts = models.PositiveSmallIntegerField(default=0)
    next_attempt_at = models.DateTimeField()
    message = models.OneToOneField('boldApp_mensajeria.ChannelMessage', null=True, on_delete=models.PROTECT, related_name='automation_run')
    page = models.OneToOneField('boldApp_mensajeria.ChannelPage', null=True, on_delete=models.PROTECT, related_name='automation_run')
    created_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True)

    class Meta:
        db_table = 'messaging_automation_runs'
        constraints = [models.UniqueConstraint(fields=['rule', 'occurrence'], name='slack_automation_occurrence')]
        indexes = [models.Index(fields=['state', 'next_attempt_at'], name='slack_automation_pending')]


class AutomationAudit(UUIDPrimaryKeyModel):
    rule = models.ForeignKey(ChannelAutomation, on_delete=models.PROTECT, related_name='audit')
    client_id = models.UUIDField()
    digest = models.CharField(max_length=64)
    action = models.CharField(max_length=20)
    version = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'messaging_automation_audit'
        constraints = [models.UniqueConstraint(fields=['rule', 'client_id'], name='slack_automation_action_retry')]
