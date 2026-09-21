import uuid

from django.conf import settings
from django.db import models

from boldApp.core.models import OrganizationalUnit, Permission, PositionAssignment


class PermissionPolicyState(models.Model):
    GLOBAL_KEY = "global"

    key = models.CharField(max_length=30, primary_key=True, default=GLOBAL_KEY, editable=False)
    revision = models.PositiveBigIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "permission_policy_state"

    @classmethod
    def current_revision(cls):
        state, _ = cls.objects.get_or_create(key=cls.GLOBAL_KEY)
        return state.revision


class PermissionPolicyEvent(models.Model):
    OUTCOME_SUCCESS = "success"
    OUTCOME_DENIED = "denied"
    OUTCOME_FAILURE = "failure"
    OUTCOME_CHOICES = [
        (OUTCOME_SUCCESS, "Éxito"),
        (OUTCOME_DENIED, "Denegado"),
        (OUTCOME_FAILURE, "Error"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    revision = models.PositiveBigIntegerField(null=True, blank=True)
    actor_account = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="permission_policy_events",
    )
    actor_assignment = models.ForeignKey(
        PositionAssignment,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="permission_policy_events",
    )
    session_id = models.UUIDField(null=True, blank=True)
    event_type = models.CharField(max_length=100)
    outcome = models.CharField(max_length=20, choices=OUTCOME_CHOICES, default=OUTCOME_SUCCESS)
    target_type = models.CharField(max_length=80)
    target_id = models.CharField(max_length=120, blank=True)
    permission = models.ForeignKey(
        Permission,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="policy_events",
    )
    target_unit = models.ForeignKey(
        OrganizationalUnit,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="permission_policy_events",
    )
    reason = models.TextField()
    before = models.JSONField(default=dict, blank=True)
    after = models.JSONField(default=dict, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    mfa_verified = models.BooleanField(default=False)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True)
    correlation_id = models.UUIDField(default=uuid.uuid4)
    occurred_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "permission_policy_events"
        ordering = ["-occurred_at"]
        indexes = [
            models.Index(fields=["event_type", "occurred_at"], name="idx_perm_event_type_time"),
            models.Index(fields=["actor_account", "occurred_at"], name="idx_perm_event_actor_time"),
            models.Index(fields=["revision"], name="idx_perm_event_revision"),
        ]

