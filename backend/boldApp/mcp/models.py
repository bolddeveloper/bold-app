import uuid

from django.db import models


class McpClient(models.Model):
    id = models.CharField(primary_key=True, max_length=200)
    metadata = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)


class McpAuthorization(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    request_hash = models.CharField(max_length=64, unique=True)
    client = models.ForeignKey(McpClient, on_delete=models.CASCADE)
    parameters = models.JSONField()
    scopes = models.JSONField(default=list)
    session = models.ForeignKey("boldApp_autenticacion.AuthSession", null=True, on_delete=models.CASCADE)
    assignment = models.ForeignKey("boldApp_core.PositionAssignment", null=True, on_delete=models.CASCADE)
    code_hash = models.CharField(max_length=64, null=True, unique=True)
    expires_at = models.DateTimeField()
    consumed_at = models.DateTimeField(null=True)
    revoked_at = models.DateTimeField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)


class McpAccessToken(models.Model):
    token_hash = models.CharField(max_length=64, unique=True)
    authorization = models.ForeignKey(McpAuthorization, on_delete=models.CASCADE, related_name="tokens")
    expires_at = models.DateTimeField()
