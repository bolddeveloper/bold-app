"""Receipts and private provenance for ordinary channel pages, not another wiki."""
from django.db import models
from boldApp.core.models.mixins import UUIDPrimaryKeyModel


class MessageAgreement(UUIDPrimaryKeyModel):
    page = models.ForeignKey('boldApp_mensajeria.ChannelPage', null=True, on_delete=models.SET_NULL, related_name='message_agreements')
    employee = models.ForeignKey('boldApp_core.Employee', on_delete=models.PROTECT)
    assignment = models.ForeignKey('boldApp_core.PositionAssignment', on_delete=models.PROTECT)
    client_id = models.UUIDField()
    digest = models.CharField(max_length=64)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'messaging_message_agreements'
        constraints = [models.UniqueConstraint(fields=['employee', 'client_id'], name='slack_agreement_retry')]


class AgreementSource(UUIDPrimaryKeyModel):
    agreement = models.ForeignKey(MessageAgreement, on_delete=models.CASCADE, related_name='sources')
    document = models.ForeignKey('boldApp_mensajeria.SearchDocument', null=True, on_delete=models.SET_NULL)
    source_version = models.PositiveIntegerField()
    block_ids = models.JSONField(default=list)
    position = models.PositiveSmallIntegerField()

    class Meta:
        db_table = 'messaging_agreement_sources'
        constraints = [models.UniqueConstraint(fields=['agreement', 'position'], name='slack_agreement_position')]
