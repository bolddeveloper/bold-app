import uuid

from django.conf import settings
from django.db import models

from boldApp.core.models import Employee, OrganizationalUnit, PositionAssignment


class AdministrativeAction(models.Model):
    STATUS_PENDING = "pending"
    STATUS_COMPLETED = "completed"
    STATUS_FAILED = "failed"
    STATUS_CANCELLED = "cancelled"
    STATUS_CHOICES = [
        (STATUS_PENDING, "Pendiente"),
        (STATUS_COMPLETED, "Completada"),
        (STATUS_FAILED, "Fallida"),
        (STATUS_CANCELLED, "Cancelada"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    actor_account = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="administrative_actions")
    target_employee = models.ForeignKey(Employee, on_delete=models.PROTECT, null=True, blank=True, related_name="administrative_actions")
    target_account = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="administrative_actions_received")
    action_type = models.CharField(max_length=80)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_PENDING)
    reason = models.TextField()
    metadata = models.JSONField(default=dict, blank=True)
    correlation_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    requested_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    error_code = models.CharField(max_length=80, blank=True)

    class Meta:
        db_table = "administrative_actions"
        ordering = ["-requested_at"]
        indexes = [
            models.Index(fields=["action_type", "requested_at"], name="idx_admin_action_type_time"),
            models.Index(fields=["target_employee", "requested_at"], name="idx_admin_action_employee"),
        ]


class OffboardingCase(models.Model):
    STATUS_DRAFT = "draft"
    STATUS_READY = "ready"
    STATUS_COMPLETED = "completed"
    STATUS_CANCELLED = "cancelled"
    STATUS_FAILED = "failed"
    STATUS_CHOICES = [
        (STATUS_DRAFT, "Borrador"),
        (STATUS_READY, "Lista"),
        (STATUS_COMPLETED, "Completada"),
        (STATUS_CANCELLED, "Cancelada"),
        (STATUS_FAILED, "Fallida"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    employee = models.ForeignKey(Employee, on_delete=models.PROTECT, related_name="offboarding_cases")
    initiated_by_account = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="offboarding_cases_initiated")
    administrative_action = models.OneToOneField(AdministrativeAction, on_delete=models.SET_NULL, null=True, blank=True, related_name="offboarding_case")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_DRAFT)
    reason = models.TextField()
    effective_at = models.DateTimeField()
    responsibility_snapshot = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "offboarding_cases"
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["employee", "status"], name="idx_offboard_employee_status")]


class ResponsibilityTransfer(models.Model):
    STATUS_PENDING = "pending"
    STATUS_COMPLETED = "completed"
    STATUS_FAILED = "failed"
    STATUS_SKIPPED = "skipped"
    STATUS_CHOICES = [
        (STATUS_PENDING, "Pendiente"),
        (STATUS_COMPLETED, "Completada"),
        (STATUS_FAILED, "Fallida"),
        (STATUS_SKIPPED, "Omitida"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    offboarding_case = models.ForeignKey(OffboardingCase, on_delete=models.CASCADE, related_name="transfers")
    source_assignment = models.ForeignKey(PositionAssignment, on_delete=models.PROTECT, related_name="administrative_transfers_from")
    target_assignment = models.ForeignKey(PositionAssignment, on_delete=models.PROTECT, null=True, blank=True, related_name="administrative_transfers_to")
    source_module = models.CharField(max_length=50)
    resource_type = models.CharField(max_length=80)
    resource_id = models.UUIDField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_PENDING)
    transferred_at = models.DateTimeField(null=True, blank=True)
    error_detail = models.TextField(blank=True)

    class Meta:
        db_table = "responsibility_transfers"
        ordering = ["source_module", "resource_type", "resource_id"]
        constraints = [
            models.UniqueConstraint(
                fields=["offboarding_case", "source_module", "resource_type", "resource_id"],
                name="unique_offboarding_resource_transfer",
            ),
        ]


class SystemAuditEvent(models.Model):
    OUTCOME_SUCCESS = "success"
    OUTCOME_FAILURE = "failure"
    OUTCOME_DENIED = "denied"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    actor_account = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="system_audit_events")
    administrative_action = models.ForeignKey(AdministrativeAction, on_delete=models.SET_NULL, null=True, blank=True, related_name="audit_events")
    organizational_unit = models.ForeignKey(OrganizationalUnit, on_delete=models.SET_NULL, null=True, blank=True, related_name="system_audit_events")
    module_code = models.CharField(max_length=50)
    event_type = models.CharField(max_length=100)
    target_type = models.CharField(max_length=80, blank=True)
    target_id = models.UUIDField(null=True, blank=True)
    outcome = models.CharField(max_length=20, default=OUTCOME_SUCCESS)
    changes = models.JSONField(default=dict, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True)
    correlation_id = models.UUIDField(default=uuid.uuid4)
    occurred_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "system_audit_events"
        ordering = ["-occurred_at"]
        indexes = [
            models.Index(fields=["module_code", "occurred_at"], name="idx_sysaudit_module_time"),
            models.Index(fields=["event_type", "occurred_at"], name="idx_sysaudit_event_time"),
            models.Index(fields=["actor_account", "occurred_at"], name="idx_sysaudit_actor_time"),
        ]


class OrganizationCatalogOption(models.Model):
    UNIT_TYPE = "unit_type"
    SENSITIVITY = "sensitivity"
    ROLE_LEVEL = "role_level"
    KIND_CHOICES = [(UNIT_TYPE, "Tipo de unidad"), (SENSITIVITY, "Sensibilidad"), (ROLE_LEVEL, "Nivel de cargo")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    kind = models.CharField(max_length=20, choices=KIND_CHOICES)
    value = models.CharField(max_length=30)

    class Meta:
        db_table = "organization_catalog_options"
        ordering = ["kind", "value"]
        constraints = [models.UniqueConstraint(fields=["kind", "value"], name="unique_organization_catalog_option")]

