"""Department channels are company resources, never extensions of private DMs."""
from datetime import timedelta
from django.core.validators import RegexValidator

from django.db import models
from django.db.models.functions import Lower

from boldApp.core.models.mixins import UUIDPrimaryKeyModel


class PrivateServer(UUIDPrimaryKeyModel):
    name = models.CharField(max_length=80)
    color = models.CharField(max_length=7, default="#ed3033", validators=[RegexValidator(r"^#[0-9a-fA-F]{6}$")])
    creator = models.ForeignKey("boldApp_core.PositionAssignment", on_delete=models.PROTECT)
    version = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "messaging_private_servers"
        ordering = ["name", "id"]


class PrivateServerMember(models.Model):
    server = models.ForeignKey(PrivateServer, on_delete=models.CASCADE, related_name="members")
    employee = models.ForeignKey("boldApp_core.Employee", on_delete=models.CASCADE)
    access = models.CharField(max_length=8, choices=[("read", "Solo lectura"), ("write", "Leer y participar")])

    class Meta:
        db_table = "messaging_private_server_members"
        constraints = [models.UniqueConstraint(fields=["server", "employee"], name="unique_private_server_member")]


class ServerIcon(models.Model):
    unit = models.OneToOneField("boldApp_core.OrganizationalUnit", on_delete=models.PROTECT, null=True, blank=True, related_name="slack_icon")
    server = models.OneToOneField(PrivateServer, on_delete=models.PROTECT, null=True, blank=True, related_name="slack_icon")
    # Protected Drive reference. New writes never store Base64 image bytes.
    image = models.TextField(null=True, blank=True)
    version = models.PositiveIntegerField(default=1)

    class Meta:
        db_table = "messaging_server_icons"
        constraints = [models.CheckConstraint(condition=models.Q(unit__isnull=False, server__isnull=True) | models.Q(unit__isnull=True, server__isnull=False), name="slack_icon_one_server")]


class ChannelCategory(UUIDPrimaryKeyModel):
    unit = models.ForeignKey("boldApp_core.OrganizationalUnit", on_delete=models.PROTECT, null=True, blank=True)
    server = models.ForeignKey(PrivateServer, on_delete=models.PROTECT, null=True, blank=True)
    name = models.CharField(max_length=80)
    position = models.PositiveIntegerField(default=0)
    version = models.PositiveIntegerField(default=1)
    creator = models.ForeignKey("boldApp_core.PositionAssignment", on_delete=models.PROTECT)

    class Meta:
        db_table = "messaging_channel_categories"
        ordering = ["position", "id"]
        constraints = [
            models.UniqueConstraint(Lower("name"), "unit", name="unique_unit_category_name"),
            models.UniqueConstraint(Lower("name"), "server", name="unique_server_category_name"),
            models.UniqueConstraint(Lower("name"), condition=models.Q(unit__isnull=True, server__isnull=True), name="unique_independent_category"),
            models.CheckConstraint(condition=models.Q(unit__isnull=True) | models.Q(server__isnull=True), name="category_one_server_scope"),
        ]


class DepartmentChannel(UUIDPrimaryKeyModel):
    VISIBILITIES = [("public", "Todos los empleados"), ("department", "Departamento e invitados"), ("private", "Solo personas invitadas")]
    unit = models.ForeignKey("boldApp_core.OrganizationalUnit", on_delete=models.PROTECT, related_name="communication_channels", null=True, blank=True)
    server = models.ForeignKey(PrivateServer, on_delete=models.PROTECT, related_name="channels", null=True, blank=True)
    category = models.ForeignKey(ChannelCategory, on_delete=models.PROTECT, related_name="channels", null=True, blank=True)
    visibility = models.CharField(max_length=12, choices=VISIBILITIES, default="public")
    name = models.CharField(max_length=80)
    description = models.CharField(max_length=500, blank=True)
    color = models.CharField(max_length=7, blank=True, default="", validators=[RegexValidator(r"^#[0-9a-fA-F]{6}$", "Usa un color hexadecimal de seis dígitos.")])
    creator = models.ForeignKey("boldApp_core.PositionAssignment", on_delete=models.PROTECT)
    archived_at = models.DateTimeField(null=True, blank=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    version = models.PositiveIntegerField(default=1)
    activity_version = models.PositiveBigIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "messaging_department_channels"
        ordering = ["name", "id"]
        constraints = [
            models.UniqueConstraint(Lower("name"), "unit", condition=models.Q(deleted_at__isnull=True), name="unique_department_channel_name"),
            models.UniqueConstraint(Lower("name"), condition=models.Q(unit__isnull=True, server__isnull=True, deleted_at__isnull=True), name="unique_independent_channel_name"),
            models.UniqueConstraint(Lower("name"), "server", condition=models.Q(deleted_at__isnull=True), name="unique_private_server_channel"),
            models.CheckConstraint(condition=models.Q(server__isnull=True) | models.Q(unit__isnull=True, visibility="private"), name="private_server_channel_boundary"),
            models.CheckConstraint(condition=~models.Q(visibility="department") | models.Q(unit__isnull=False), name="department_channel_has_unit"),
        ]
        indexes = [models.Index(fields=["unit", "archived_at"], name="slack_department_channels")]


class ChannelAccessRule(models.Model):
    channel = models.ForeignKey(DepartmentChannel, on_delete=models.CASCADE, related_name="access_rules")
    employee = models.ForeignKey("boldApp_core.Employee", on_delete=models.CASCADE)
    access = models.CharField(max_length=8, choices=[("read", "Solo lectura"), ("write", "Leer y participar"), ("blocked", "Sin acceso")])

    class Meta:
        db_table = "messaging_channel_access"
        constraints = [models.UniqueConstraint(fields=["channel", "employee"], name="unique_channel_access_employee")]


class ChannelAccessEpoch(models.Model):
    # Only access changes increment this counter. Creating/renaming a channel
    # or sending a message must not clear everybody's open drafts.
    employee = models.OneToOneField("boldApp_core.Employee", primary_key=True, on_delete=models.CASCADE)
    revision = models.PositiveBigIntegerField(default=0)

    class Meta:
        db_table = "messaging_channel_access_epochs"


class ChannelMessage(UUIDPrimaryKeyModel):
    EDIT_WINDOW = timedelta(minutes=10)
    channel = models.ForeignKey(DepartmentChannel, on_delete=models.CASCADE, related_name="messages")
    author = models.ForeignKey("boldApp_core.Employee", on_delete=models.PROTECT, related_name="channel_messages")
    author_assignment = models.ForeignKey("boldApp_core.PositionAssignment", on_delete=models.PROTECT)
    # Snapshot the active department, not all the employee's other assignments.
    department_name = models.CharField(max_length=120)
    department_color = models.CharField(max_length=7)
    client_id = models.UUIDField()
    payload_digest = models.CharField(max_length=64)
    sequence = models.PositiveBigIntegerField()
    body = models.TextField(max_length=5000)
    automation_kind = models.CharField(max_length=20, blank=True, default='')
    # An immutable reference, not a grant or a copy of confidential task data.
    # Retain the UUID after task deletion so history can show an unavailable card.
    task_id = models.UUIDField(null=True, blank=True)
    page_id = models.UUIDField(null=True, blank=True)
    parent = models.ForeignKey("self", on_delete=models.PROTECT, related_name="replies", null=True, blank=True)
    thread_title = models.CharField(max_length=120, blank=True, default="")
    thread_started_at = models.DateTimeField(null=True, blank=True)
    thread_starter = models.ForeignKey("boldApp_core.Employee", on_delete=models.PROTECT, null=True, blank=True, related_name="started_channel_threads")
    thread_closed_at = models.DateTimeField(null=True, blank=True)
    thread_locked = models.BooleanField(default=False)
    thread_deleted_at = models.DateTimeField(null=True, blank=True)
    pinned_at = models.DateTimeField(null=True, blank=True)
    pinned_by = models.ForeignKey("boldApp_core.Employee", on_delete=models.PROTECT, null=True, blank=True, related_name="pinned_channel_messages")
    created_at = models.DateTimeField(auto_now_add=True)
    edited_at = models.DateTimeField(null=True, blank=True)
    version = models.PositiveIntegerField(default=1)

    @property
    def editable_until(self):
        return self.created_at + self.EDIT_WINDOW

    class Meta:
        db_table = "messaging_channel_messages"
        ordering = ["-sequence"]
        constraints = [
            models.UniqueConstraint(fields=["channel", "author", "client_id"], name="unique_channel_send_retry"),
            models.UniqueConstraint(fields=["channel", "sequence"], name="unique_channel_sequence"),
            models.CheckConstraint(condition=models.Q(sequence__gt=0), name="positive_channel_sequence"),
        ]
        indexes = [models.Index(fields=["channel", "parent", "-sequence"], name="slack_message_history")]


class ChannelReadState(models.Model):
    channel = models.ForeignKey(DepartmentChannel, on_delete=models.CASCADE, related_name="read_states")
    employee = models.ForeignKey("boldApp_core.Employee", on_delete=models.CASCADE)
    sequence = models.PositiveBigIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "messaging_channel_read_states"
        constraints = [models.UniqueConstraint(fields=["channel", "employee"], name="unique_channel_reader")]


class ChannelMedia(UUIDPrimaryKeyModel):
    message = models.OneToOneField(ChannelMessage, on_delete=models.CASCADE, related_name="media")
    root = models.ForeignKey("boldApp_workspace.ImageStorageRoot", on_delete=models.PROTECT)
    drive_id = models.CharField(max_length=200)
    kind = models.CharField(max_length=10, choices=[("image", "Imagen"), ("audio", "Nota de voz"), ("document", "Documento")])
    mime_type = models.CharField(max_length=100)
    size_bytes = models.PositiveIntegerField()
    digest = models.CharField(max_length=64)
    filename = models.CharField(max_length=180, blank=True, default="")
    width = models.PositiveIntegerField(null=True)
    height = models.PositiveIntegerField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "messaging_channel_media"


class ChannelSubscription(models.Model):
    channel = models.ForeignKey(DepartmentChannel, on_delete=models.CASCADE, related_name="subscriptions")
    employee = models.ForeignKey("boldApp_core.Employee", on_delete=models.CASCADE)
    following = models.BooleanField(default=False)
    revision = models.PositiveBigIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "messaging_channel_subscriptions"
        constraints = [models.UniqueConstraint(fields=["channel", "employee"], name="unique_channel_subscription")]


class ChannelThreadReadState(models.Model):
    # Separate cursors prevent reading the main channel from acknowledging
    # replies that were never opened. Only root messages are accepted by the API.
    parent = models.ForeignKey(ChannelMessage, on_delete=models.CASCADE, related_name="reader_states")
    employee = models.ForeignKey("boldApp_core.Employee", on_delete=models.CASCADE)
    sequence = models.PositiveBigIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "messaging_channel_thread_reads"
        constraints = [models.UniqueConstraint(fields=["parent", "employee"], name="unique_channel_thread_reader")]


class ChannelThreadSubscription(models.Model):
    # Explicit opt-in only. Posting/replying/reading never enrolls an employee.
    parent = models.ForeignKey(ChannelMessage, on_delete=models.CASCADE, related_name="thread_subscriptions")
    employee = models.ForeignKey("boldApp_core.Employee", on_delete=models.CASCADE)
    following = models.BooleanField(default=False)
    favorite = models.BooleanField(default=False)
    left = models.BooleanField(default=False)
    notification_level = models.CharField(max_length=10, default="inherit", choices=[("inherit", "Heredar seguimiento"), ("all", "Todos"), ("mentions", "Menciones"), ("none", "Ninguna")])
    muted_until = models.DateTimeField(null=True, blank=True)
    muted_forever = models.BooleanField(default=False)
    last_client_id = models.UUIDField(null=True, blank=True)
    last_digest = models.CharField(max_length=64, blank=True, default="")
    revision = models.PositiveBigIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "messaging_thread_subscriptions"
        constraints = [models.UniqueConstraint(fields=["parent", "employee"], name="unique_thread_subscription")]
        indexes = [models.Index(fields=["employee", "parent"], condition=models.Q(following=True), name="slack_followed_threads")]
