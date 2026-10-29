"""One local search projection per source; source membership remains authoritative."""
from django.db import models
from boldApp.core.models.mixins import UUIDPrimaryKeyModel


class SearchDocument(UUIDPrimaryKeyModel):
    direct = models.OneToOneField("boldApp_mensajeria.DirectMessage", on_delete=models.CASCADE, null=True, related_name="search_document")
    channel_message = models.OneToOneField("boldApp_mensajeria.ChannelMessage", on_delete=models.CASCADE, null=True, related_name="search_document")
    page = models.OneToOneField("boldApp_mensajeria.ChannelPage", on_delete=models.CASCADE, null=True, related_name="search_document")
    text = models.TextField()
    has_links = models.BooleanField(default=False, db_default=False)
    reaction_version = models.PositiveBigIntegerField(default=0, db_default=0)
    # Immutable source creation time: editing must not move a pagination boundary.
    created_at = models.DateTimeField()

    class Meta:
        db_table = "messaging_search_documents"
        constraints = [models.CheckConstraint(condition=(
            models.Q(direct__isnull=False, channel_message__isnull=True, page__isnull=True) |
            models.Q(direct__isnull=True, channel_message__isnull=False, page__isnull=True) |
            models.Q(direct__isnull=True, channel_message__isnull=True, page__isnull=False)
        ), name="slack_search_one_source")]
        indexes = [models.Index(fields=["-created_at", "-id"], name="slack_search_history"),
            models.Index(fields=["-created_at", "-id"], condition=models.Q(has_links=True), name="slack_resource_links")]
