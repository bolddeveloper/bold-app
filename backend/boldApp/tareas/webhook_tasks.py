import hashlib
import hmac
import json

import requests
from celery import shared_task
from rest_framework.utils.encoders import JSONEncoder as DRFJSONEncoder


# Define el tiempo maximo de espera por intento de entrega hacia el suscriptor.
webhook_delivery_timeout_seconds = 5


# Firma el cuerpo del webhook con HMAC-SHA256 usando el secreto del endpoint,
# para que el suscriptor pueda verificar que la entrega vino de boldApp.
def sign_payload(secret, body_bytes):
    return hmac.new(secret.encode("utf-8"), body_bytes, hashlib.sha256).hexdigest()


# Entrega un evento a un WebhookEndpoint especifico, con reintentos automaticos
# y backoff exponencial ante errores de red; cada intento queda registrado en
# WebhookDelivery, exista o no una entrega exitosa.
@shared_task(
    bind=True,
    autoretry_for=(requests.RequestException,),
    retry_backoff=True,
    retry_backoff_max=60,
    max_retries=5,
)
def deliver_webhook(self, endpoint_id, envelope):
    from .models import WebhookDelivery, WebhookEndpoint

    try:
        endpoint = WebhookEndpoint.objects.get(id=endpoint_id, is_active=True)
    except WebhookEndpoint.DoesNotExist:
        return None

    body_bytes = json.dumps(envelope, sort_keys=True, cls=DRFJSONEncoder).encode("utf-8")
    signature = sign_payload(endpoint.secret, body_bytes)
    headers = {
        "Content-Type": "application/json",
        "X-BoldApp-Event": envelope["event_type"],
        "X-BoldApp-Signature": signature,
    }

    try:
        response = requests.post(
            endpoint.target_url,
            data=body_bytes,
            headers=headers,
            timeout=webhook_delivery_timeout_seconds,
        )
    except requests.RequestException as exc:
        WebhookDelivery.objects.create(
            endpoint=endpoint,
            event_id=envelope["event_id"],
            event_type=envelope["event_type"],
            payload=envelope,
            response_status_code=None,
            response_body=str(exc),
            succeeded=False,
            attempt_number=self.request.retries + 1,
        )
        raise

    WebhookDelivery.objects.create(
        endpoint=endpoint,
        event_id=envelope["event_id"],
        event_type=envelope["event_type"],
        payload=envelope,
        response_status_code=response.status_code,
        response_body=response.text[:2000],
        succeeded=response.ok,
        attempt_number=self.request.retries + 1,
    )

    return response.status_code
