from django.db import models
from boldApp.core.models.mixins import UUIDPrimaryKeyModel


class SupportRequest(UUIDPrimaryKeyModel):
    source = models.OneToOneField('ChannelMessage', on_delete=models.CASCADE, related_name='support_request')
    source_version = models.PositiveIntegerField()
    session = models.ForeignKey('boldApp_autenticacion.AuthSession', null=True, on_delete=models.CASCADE)
    reply = models.OneToOneField('ChannelMessage', null=True, on_delete=models.SET_NULL, related_name='support_result')
    state = models.CharField(max_length=12, default='pending', db_index=True)
    admitted = models.BooleanField(default=True)
    reason = models.CharField(max_length=40, blank=True)
    model = models.CharField(max_length=80, blank=True)
    input_tokens = models.PositiveIntegerField(default=0)
    cached_input_tokens = models.PositiveIntegerField(default=0)
    output_tokens = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    started_at = models.DateTimeField(null=True)
    finished_at = models.DateTimeField(null=True)

    class Meta:
        db_table = 'messaging_support_requests'
