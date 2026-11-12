import uuid
from django.db import models
from django.db.models import Q


ACTIVE = ('intent_queued', 'intent_processing', 'awaiting_scope', 'prepare_queued',
          'preparing', 'awaiting_approval', 'execute_queued', 'executing')


class AssistantRequest(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    account = models.ForeignKey('boldApp_core.UserAccount', on_delete=models.CASCADE)
    assignment = models.ForeignKey('boldApp_core.PositionAssignment', on_delete=models.PROTECT)
    session = models.ForeignKey('boldApp_autenticacion.AuthSession', on_delete=models.CASCADE)
    client_id = models.UUIDField()
    text = models.TextField()
    context = models.JSONField(default=dict)
    version = models.PositiveIntegerField(default=1)
    state = models.CharField(max_length=24, default='intent_queued', db_index=True)
    summary = models.TextField(blank=True)
    scope = models.JSONField(default=dict)
    clarification = models.TextField(blank=True)
    error = models.CharField(max_length=240, blank=True)
    execution_id = models.UUIDField(null=True)
    cancel_requested = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)
    finished_at = models.DateTimeField(null=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['account', 'client_id'], name='assistant_request_idempotent'),
            models.UniqueConstraint(fields=['account'], condition=Q(state__in=ACTIVE), name='assistant_one_active_account'),
        ]


class Proposal(models.Model):
    request = models.ForeignKey(AssistantRequest, on_delete=models.CASCADE, related_name='proposals')
    version = models.PositiveIntegerField()
    summary = models.TextField()
    steps = models.JSONField(default=list)
    sources = models.JSONField(default=list)
    answer = models.TextField(blank=True)
    digest = models.CharField(max_length=64)
    approved_at = models.DateTimeField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['request', 'version'], name='assistant_proposal_revision')]


class ActionReceipt(models.Model):
    request = models.ForeignKey(AssistantRequest, on_delete=models.CASCADE, related_name='receipts')
    proposal = models.ForeignKey(Proposal, on_delete=models.PROTECT)
    step_id = models.CharField(max_length=40)
    capability = models.CharField(max_length=64)
    state = models.CharField(max_length=20, default='pending')
    result = models.JSONField(default=dict)
    error = models.CharField(max_length=240,blank=True)
    started_at = models.DateTimeField(null=True)
    finished_at = models.DateTimeField(null=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['proposal', 'step_id'], name='assistant_once_step')]


class InferenceAttempt(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    request = models.ForeignKey(AssistantRequest, on_delete=models.CASCADE, related_name='inferences')
    kind = models.CharField(max_length=20)
    model = models.CharField(max_length=80)
    state = models.CharField(max_length=20, default='processing')
    wait_seconds = models.FloatField(null=True)
    input_tokens = models.PositiveBigIntegerField(null=True)
    cached_input_tokens = models.PositiveBigIntegerField(null=True)
    output_tokens = models.PositiveBigIntegerField(null=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    finished_at = models.DateTimeField(null=True)


class InferenceGate(models.Model):
    id = models.PositiveSmallIntegerField(primary_key=True, default=1)
    owner = models.UUIDField(null=True)
    expires_at = models.DateTimeField(null=True)


class Approval(models.Model):
    request = models.ForeignKey(AssistantRequest,on_delete=models.CASCADE,related_name='approvals')
    version = models.PositiveIntegerField()
    kind = models.CharField(max_length=12)
    request_text = models.TextField()
    content = models.JSONField()
    digest = models.CharField(max_length=64)
    session = models.ForeignKey('boldApp_autenticacion.AuthSession',on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints=[models.UniqueConstraint(fields=['request','version','kind'],name='assistant_approval_revision')]
