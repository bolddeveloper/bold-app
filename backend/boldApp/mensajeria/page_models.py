"""Channel-owned documents. Revisions are immutable; archiving never erases them."""
from django.db import models
from boldApp.core.models.mixins import UUIDPrimaryKeyModel


class ChannelPage(UUIDPrimaryKeyModel):
    channel = models.ForeignKey("boldApp_mensajeria.DepartmentChannel", on_delete=models.PROTECT, related_name="pages")
    creator = models.ForeignKey("boldApp_core.Employee", on_delete=models.PROTECT, related_name="channel_pages")
    updated_by = models.ForeignKey("boldApp_core.Employee", on_delete=models.PROTECT, related_name="updated_channel_pages")
    client_id = models.UUIDField()
    creation_digest = models.CharField(max_length=64)
    title = models.CharField(max_length=160)
    icon = models.CharField(max_length=16, default="note")
    blocks = models.JSONField(default=list)
    version = models.PositiveIntegerField(default=1)
    archived_at = models.DateTimeField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "messaging_channel_pages"
        constraints = [models.UniqueConstraint(fields=["channel", "creator", "client_id"], name="slack_page_create_retry")]
        indexes = [models.Index(fields=["channel", "-created_at", "-id"], name="slack_page_list")]


class PageRevision(UUIDPrimaryKeyModel):
    page = models.ForeignKey(ChannelPage, on_delete=models.PROTECT, related_name="revisions")
    version = models.PositiveIntegerField()
    actor = models.ForeignKey("boldApp_core.Employee", on_delete=models.PROTECT)
    client_id = models.UUIDField()
    payload_digest = models.CharField(max_length=64)
    title = models.CharField(max_length=160)
    icon = models.CharField(max_length=16)
    blocks = models.JSONField(default=list)
    archived = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "messaging_page_revisions"
        constraints = [models.UniqueConstraint(fields=["page", "version"], name="slack_page_revision"),
                       models.UniqueConstraint(fields=["page", "actor", "client_id"], name="slack_page_save_retry")]
