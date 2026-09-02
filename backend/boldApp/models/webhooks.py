import secrets

from django.core.serializers.json import DjangoJSONEncoder
from django.db import models

from .mixins import UUIDPrimaryKeyModel
from .workspaces import Workspace


# Genera un secreto aleatorio usado para firmar (HMAC) las entregas de un endpoint.
def generate_webhook_secret():
    return secrets.token_hex(32)


# Define un suscriptor de webhooks: una URL externa que quiere recibir eventos de tareas.
class WebhookEndpoint(UUIDPrimaryKeyModel):
    workspace = models.ForeignKey(
        Workspace,
        on_delete=models.CASCADE,
        related_name="webhook_endpoints",
    )
    target_url = models.URLField()
    secret = models.CharField(max_length=64, default=generate_webhook_secret, editable=False)
    event_types = models.JSONField(
        default=list,
        blank=True,
        help_text="Lista de event_type a los que esta suscrito. Vacio = todos los eventos.",
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "webhook_endpoints"
        ordering = ["-created_at"]

    def __str__(self):
        return self.target_url


# Define el log de auditoria de cada intento de entrega hacia un WebhookEndpoint.
class WebhookDelivery(UUIDPrimaryKeyModel):
    endpoint = models.ForeignKey(
        WebhookEndpoint,
        on_delete=models.CASCADE,
        related_name="deliveries",
    )
    event_id = models.UUIDField()
    event_type = models.CharField(max_length=40)
    payload = models.JSONField(encoder=DjangoJSONEncoder)
    response_status_code = models.PositiveSmallIntegerField(null=True, blank=True)
    response_body = models.TextField(null=True, blank=True)
    succeeded = models.BooleanField(default=False)
    attempt_number = models.PositiveSmallIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "webhook_deliveries"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["endpoint", "created_at"], name="idx_webhookdel_ep_created"),
        ]

    def __str__(self):
        return f"{self.event_type} -> {self.endpoint_id} ({'ok' if self.succeeded else 'fallo'})"
