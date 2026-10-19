import uuid

from django.conf import settings
from django.db import models


class Folder(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    name = models.CharField(max_length=160)
    parent = models.ForeignKey("self", null=True, blank=True, on_delete=models.PROTECT)
    deleted_at = models.DateTimeField(null=True, blank=True)


class Workbook(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="sheet_files")
    creator = models.ForeignKey("boldApp_core.PositionAssignment", on_delete=models.PROTECT)
    folder = models.ForeignKey(Folder, null=True, blank=True, on_delete=models.PROTECT)
    name = models.CharField(max_length=160)
    document = models.JSONField(default=dict)
    revision = models.PositiveBigIntegerField(default=0)
    initial_agenda = models.BooleanField(default=False)
    is_template = models.BooleanField(default=False)
    system_template = models.CharField(max_length=24, blank=True, default="")
    deleted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    drive_account = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="sheet_drive_bindings")
    drive_folder = models.CharField(max_length=200, blank=True)
    drive_id = models.CharField(max_length=200, blank=True)
    drive_created = models.BooleanField(default=False)
    drive_version = models.CharField(max_length=80, blank=True)
    drive_checksum = models.CharField(max_length=80, blank=True)
    upload_checksum = models.CharField(max_length=80, blank=True)
    upload_uncertain = models.BooleanField(default=False)
    upload_revision = models.PositiveBigIntegerField(default=0)
    upload_name = models.CharField(max_length=160, blank=True)
    upload_folder = models.CharField(max_length=200, blank=True)
    calculated_revision = models.PositiveBigIntegerField(default=0)
    calculation_error = models.TextField(blank=True)
    excel_content = models.BinaryField(null=True, blank=True)
    excel_revision = models.PositiveBigIntegerField(default=0)
    office_lock = models.CharField(max_length=1024, blank=True)
    office_lock_until = models.DateTimeField(null=True, blank=True)
    drive_url = models.URLField(max_length=500, blank=True)
    sync_state = models.CharField(max_length=24, default="unbound")
    sync_error = models.TextField(blank=True)
    synced_revision = models.PositiveBigIntegerField(default=0)
    pending_since = models.DateTimeField(null=True, blank=True)
    sync_after = models.DateTimeField(null=True, blank=True, db_index=True)
    sync_lease = models.UUIDField(null=True, blank=True)
    lease_until = models.DateTimeField(null=True, blank=True)
    attempts = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["-updated_at"]
        constraints = [models.UniqueConstraint(fields=["initial_agenda"], condition=models.Q(initial_agenda=True), name="one_initial_sheet_agenda"), models.UniqueConstraint(fields=["owner", "system_template"], condition=~models.Q(system_template=""), name="unique_owner_system_template")]


class Member(models.Model):
    workbook = models.ForeignKey(Workbook, on_delete=models.CASCADE, related_name="members")
    account = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    role = models.CharField(max_length=8, choices=[("reader", "Lector"), ("editor", "Editor")])

    class Meta:
        constraints = [models.UniqueConstraint(fields=["workbook", "account"], name="unique_sheet_member")]


class OfficeSession(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workbook = models.ForeignKey(Workbook, on_delete=models.CASCADE)
    assignment = models.ForeignKey("boldApp_core.PositionAssignment", on_delete=models.CASCADE)
    auth_session = models.ForeignKey("boldApp_autenticacion.AuthSession", on_delete=models.CASCADE)
    base_revision = models.PositiveBigIntegerField()
    expires_at = models.DateTimeField()


class Operation(models.Model):
    id = models.UUIDField(primary_key=True)
    workbook = models.ForeignKey(Workbook, on_delete=models.CASCADE, related_name="operations")
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    request_hash = models.CharField(max_length=64)
    base_revision = models.PositiveBigIntegerField()
    revision = models.PositiveBigIntegerField()
    changes = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True)


class TaskLink(models.Model):
    workbook = models.ForeignKey(Workbook, on_delete=models.PROTECT, related_name="task_links")
    sheet_id = models.CharField(max_length=80)
    block_id = models.UUIDField()
    row_id = models.UUIDField()
    task = models.OneToOneField("boldApp_tareas.Task", on_delete=models.PROTECT, related_name="sheet_link")
    active = models.BooleanField(default=True)
    note_hash = models.CharField(max_length=64, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["workbook", "row_id"], name="unique_sheet_row_task")]


class Revision(models.Model):
    workbook = models.ForeignKey(Workbook, on_delete=models.CASCADE, related_name="versions")
    revision = models.PositiveBigIntegerField()
    document = models.JSONField()
    excel_content = models.BinaryField(null=True, blank=True)
    reason = models.CharField(max_length=40)
    created_at = models.DateTimeField(auto_now_add=True)


class ImportReview(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workbook = models.ForeignKey(Workbook, on_delete=models.CASCADE)
    reviewer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    drive_version = models.CharField(max_length=80)
    drive_checksum = models.CharField(max_length=80)
    base_revision = models.PositiveBigIntegerField()
    document = models.JSONField()
    excel_content = models.BinaryField(null=True, blank=True)
    issues = models.JSONField(default=list)
    changes = models.JSONField(default=list)
    applied_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


class Preference(models.Model):
    account = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    workbook = models.ForeignKey(Workbook, on_delete=models.CASCADE)
    filters = models.JSONField(default=dict)
    favorite = models.BooleanField(default=False)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["account", "workbook"], name="unique_sheet_preference")]
