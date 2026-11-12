"""Task-owned execution, independent of personal boards and project pipelines."""
from django.db import models
from django.db.models import Q
from .mixins import UUIDPrimaryKeyModel


class TaskExecution(models.Model):
    task = models.OneToOneField('Task', primary_key=True, on_delete=models.CASCADE, related_name='execution')
    version = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class TaskPhase(UUIDPrimaryKeyModel):
    STATES = [(key, label) for key, label in (
        ('pending', 'Pendiente de dependencia'), ('available', 'Disponible'),
        ('in_progress', 'En curso'), ('blocked', 'Bloqueada'),
        ('completed', 'Completada'), ('skipped', 'Omitida con autorización'))]
    execution = models.ForeignKey(TaskExecution, on_delete=models.CASCADE, related_name='phases')
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True)
    completion_criteria = models.CharField(max_length=1000, blank=True)
    position = models.PositiveIntegerField(default=0)
    unit = models.ForeignKey('boldApp_core.OrganizationalUnit', on_delete=models.PROTECT)
    lead = models.ForeignKey('boldApp_core.PositionAssignment', on_delete=models.PROTECT, related_name='led_task_phases')
    responsible = models.ManyToManyField('boldApp_core.PositionAssignment', related_name='task_phases')
    prerequisites = models.ManyToManyField('self', symmetrical=False, related_name='successors')
    required = models.BooleanField(default=True)
    status = models.CharField(max_length=16, choices=STATES, default='pending')
    review_required = models.BooleanField(default=False)
    block_reason = models.CharField(max_length=1000, blank=True)
    due_at = models.DateTimeField(null=True, blank=True)
    estimated_minutes = models.PositiveIntegerField(null=True, blank=True)
    ready_at = models.DateTimeField(null=True, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    archived_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['position', 'id']
        indexes = [models.Index(fields=['execution', 'archived_at', 'status'], name='phase_execution_state')]
        constraints = [models.CheckConstraint(condition=Q(status__in=[s for s, _ in (
            ('pending',''),('available',''),('in_progress',''),('blocked',''),('completed',''),('skipped',''))]), name='phase_valid_state')]


class TaskTimelineEvent(UUIDPrimaryKeyModel):
    task = models.ForeignKey('Task', on_delete=models.CASCADE, related_name='timeline_events')
    phase = models.ForeignKey(TaskPhase, on_delete=models.SET_NULL, null=True, blank=True, related_name='events')
    kind = models.CharField(max_length=50)
    sequence = models.PositiveBigIntegerField()
    responsible_assignment_id = models.UUIDField(null=True, blank=True, db_index=True)
    responsible_employee_id = models.UUIDField(null=True, blank=True, db_index=True)
    responsible_unit_id = models.UUIDField(null=True, blank=True, db_index=True)
    actor = models.ForeignKey('boldApp_core.PositionAssignment', on_delete=models.SET_NULL, null=True, blank=True)
    actor_snapshot = models.JSONField(default=dict)
    responsibility_snapshot = models.JSONField(default=list)
    before = models.JSONField(default=dict)
    after = models.JSONField(default=dict)
    reason = models.CharField(max_length=1000, blank=True)
    occurred_at = models.DateTimeField(db_index=True)

    class Meta:
        ordering = ['task_id', 'sequence']
        indexes = [models.Index(fields=['task', 'kind', 'occurred_at'], name='task_timeline_kind_time'),
                   models.Index(fields=['kind','occurred_at','task'],name='timeline_metric_period')]
        constraints = [models.UniqueConstraint(fields=['task','sequence'],name='task_timeline_sequence')]


class TaskTracking(models.Model):
    task = models.OneToOneField('Task', primary_key=True, on_delete=models.CASCADE, related_name='tracking')
    observed_since = models.DateTimeField()
    complete_history = models.BooleanField(default=False)


class ExecutionCommand(models.Model):
    execution = models.ForeignKey(TaskExecution, on_delete=models.CASCADE, related_name='commands')
    operation_id = models.UUIDField()
    fingerprint = models.CharField(max_length=64)
    actor = models.ForeignKey('boldApp_core.PositionAssignment', on_delete=models.PROTECT)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['execution', 'operation_id'], name='execution_idempotent_command')]


class ExecutionTemplate(UUIDPrimaryKeyModel):
    owner = models.ForeignKey('boldApp_core.PositionAssignment', on_delete=models.PROTECT)
    name = models.CharField(max_length=120)
    definition = models.JSONField(default=list)
    shared_with = models.ManyToManyField('boldApp_core.PositionAssignment', related_name='execution_templates')
    version = models.PositiveIntegerField(default=1)
    archived_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
