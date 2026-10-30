"""Opt-in Web Push. Providers receive encrypted identifiers, never notice text.

The service worker must resolve each hint against the current cookie session and
resource ACL. A delayed hint cannot display an old account's private content.
"""
import base64
import hashlib
import json
import re
from datetime import timedelta
from types import SimpleNamespace
from urllib.parse import urlsplit

from cryptography.hazmat.primitives.asymmetric import ec
from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import serializers

from boldApp.autenticacion.notification_settings import DEFAULTS, event_preferences
from boldApp.autenticacion.services import decrypt_secret, encrypt_secret
from .models import PushDelivery, PushDevice


def configured():
    return bool(settings.WEB_PUSH_ENABLED and settings.WEB_PUSH_PUBLIC_KEY and settings.WEB_PUSH_PRIVATE_KEY)


def endpoint_allowed(value):
    try:
        url = urlsplit(value)
        if len(value) > 2048 or any(ord(char) <= 32 for char in value) or url.scheme != "https" or url.username or url.password or url.fragment or url.port not in (None, 443):
            return False
        host = url.hostname or ""
        if host == "fcm.googleapis.com":
            return url.path.startswith(("/fcm/send/", "/wp/"))
        if host == "updates.push.services.mozilla.com":
            return url.path.startswith(("/wpush/v1/", "/wpush/v2/", "/push/v1/"))
        if host == "web.push.apple.com":
            return len(url.path) > 1
        return bool(re.fullmatch(r"[a-z0-9-]+\.notify\.windows\.com", host) and url.path.startswith("/w/"))
    except (TypeError, ValueError):
        return False


def _decoded(value):
    if not re.fullmatch(r"[A-Za-z0-9_-]+={0,2}", value or ""):
        raise ValueError()
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


class PushSubscriptionInput(serializers.Serializer):
    endpoint = serializers.CharField(max_length=2048)
    keys = serializers.DictField(child=serializers.CharField(max_length=100), allow_empty=False)

    def validate(self, attrs):
        if set(self.initial_data) - {"endpoint", "keys", "expirationTime"} or set(attrs["keys"]) != {"auth", "p256dh"}:
            raise serializers.ValidationError("Suscripción de notificaciones inválida.")
        try:
            if not endpoint_allowed(attrs["endpoint"]) or len(_decoded(attrs["keys"]["auth"])) != 16:
                raise ValueError()
            ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), _decoded(attrs["keys"]["p256dh"]))
        except (ValueError, TypeError):
            raise serializers.ValidationError("El proveedor o las claves de notificaciones no son válidos.")
        return attrs


def session_valid(session, assignment, now=None):
    now = now or timezone.now()
    user = session.user_account
    return bool(not session.revoked_at and session.expires_at > now
        and (not session.idle_expires_at or session.idle_expires_at > now)
        and user.is_active and not user.must_change_password
        and user.credentials_version == session.credentials_version
        and assignment.is_active and not assignment.released_at and assignment.employee.is_active
        and assignment.employee_id == user.employee_id
        and (not settings.AUTH_MFA_REQUIRED or user.mfa_methods.filter(is_active=True).exists()))


def enabled_for(user, notice):
    prefs = {**DEFAULTS, **user.notification_settings}
    return prefs["desktop_enabled"] and event_preferences(prefs).get(notice.type, True)


def visible_notice(request, notification_id):
    from .views import NotificationViewSet
    view = NotificationViewSet()
    view.request, view.kwargs = request, {"pk": str(notification_id)}
    return view.get_queryset().filter(is_read=False).first()


def bind_device(session, assignment, subscription):
    digest = hashlib.sha256(subscription["endpoint"].encode()).hexdigest()
    encoded = json.dumps(subscription, sort_keys=True)
    with transaction.atomic():
        # One account lock bounds concurrent registration from its different sessions.
        type(session.user_account).objects.select_for_update().get(pk=session.user_account_id)
        device = PushDevice.objects.select_for_update().filter(endpoint_digest=digest).first()
        if device is None and PushDevice.objects.filter(session__user_account=session.user_account, revoked_at__isnull=True,
                session__revoked_at__isnull=True, session__expires_at__gt=timezone.now()).count() >= 10:
            raise serializers.ValidationError("Se alcanzó el límite de diez dispositivos. Desactiva uno antes de añadir otro.")
        if device is None:
            return PushDevice.objects.create(session=session, assignment=assignment, endpoint_digest=digest,
                subscription_encrypted=encrypt_secret(encoded))
        if device.revoked_at or device.session_id != session.pk or device.assignment_id != assignment.pk or decrypt_secret(device.subscription_encrypted) != encoded:
            import uuid
            device.binding = uuid.uuid4()
        device.session, device.assignment, device.revoked_at = session, assignment, None
        device.subscription_encrypted = encrypt_secret(encoded)
        device.save()
        return device


def queue_notice(notice):
    if not configured():
        return
    now = timezone.now()
    devices = PushDevice.objects.filter(assignment_id=notice.recipient_assignment_id, revoked_at__isnull=True,
        session__revoked_at__isnull=True, session__expires_at__gt=now).select_related("session__user_account", "assignment__employee")[:10]
    for device in devices:
        if session_valid(device.session, device.assignment, now) and enabled_for(device.session.user_account, notice):
            PushDelivery.objects.get_or_create(notification=notice, device=device, binding=device.binding,
                defaults={"next_attempt_at": now, "expires_at": now + timedelta(minutes=5)})


def wake_worker():
    if configured() and not settings.CELERY_TASK_ALWAYS_EAGER:
        try:
            from .tasks import drain_web_push
            drain_web_push.delay()
        except Exception:
            # Durable rows remain recoverable by Beat; never log endpoint/keys.
            import logging
            logging.getLogger(__name__).warning("Web Push queue wake unavailable; recovery remains scheduled")


def send_hint(subscription, payload, ttl):
    from pywebpush import webpush
    import requests
    class ProviderSession(requests.Session):
        def post(self, *args, **kwargs):
            kwargs["allow_redirects"] = False
            return super().post(*args, **kwargs)
    if not endpoint_allowed(subscription["endpoint"]):
        raise ValueError("Invalid push provider")
    headers = {"Urgency": "normal"}
    if (urlsplit(subscription["endpoint"]).hostname or "").endswith(".notify.windows.com"):
        headers["X-WNS-Type"] = "wns/raw"
        headers["X-WNS-TTL"] = str(max(1, min(300, ttl)))
        headers["X-WNS-Cache-Policy"] = "cache"
    with ProviderSession() as transport:
        transport.trust_env = False
        return webpush(subscription, json.dumps(payload), vapid_private_key=settings.WEB_PUSH_PRIVATE_KEY,
            vapid_claims={"sub": settings.WEB_PUSH_SUBJECT}, requests_session=transport,
            timeout=(3, 6), ttl=max(1, min(300, ttl)), headers=headers)


def deliver(row):
    now = timezone.now()
    device, notice = row.device, row.notification
    state = "discarded"
    if row.expires_at > now and row.binding == device.binding and not device.revoked_at and session_valid(device.session, device.assignment, now):
        user = device.session.user_account
        request = SimpleNamespace(user=user, assignment=device.assignment, auth=device.session)
        if enabled_for(user, notice) and visible_notice(request, notice.pk):
            try:
                subscription = json.loads(decrypt_secret(device.subscription_encrypted))
                payload = {"v": 1, "device_id": str(device.pk), "binding": str(device.binding),
                    "notification_id": str(notice.pk), "assignment_id": str(device.assignment_id)}
                response = send_hint(subscription, payload, int((row.expires_at - now).total_seconds()))
                if response.status_code not in (200, 201, 202):
                    raise ValueError("Push provider rejected delivery")
                state = "sent"
            except Exception as error:
                status = getattr(getattr(error, "response", None), "status_code", None)
                if status in (404, 410):
                    PushDevice.objects.filter(pk=device.pk, binding=row.binding).update(revoked_at=now)
                elif (status is None or status == 429 or status >= 500) and row.attempts < 3:
                    state = "pending"
    PushDelivery.objects.filter(pk=row.pk).update(state=state, lease_until=None,
        next_attempt_at=now + timedelta(seconds=15 * max(1, row.attempts)))


def drain(limit=4):
    if not configured():
        return 0
    now = timezone.now()
    PushDelivery.objects.filter(state="pending", expires_at__lte=now).update(state="discarded", lease_until=None)
    due = PushDelivery.objects.filter(state="pending", next_attempt_at__lte=now, expires_at__gt=now, attempts__lt=3).filter(
        Q(lease_until__isnull=True) | Q(lease_until__lte=now)).order_by("created_at")
    count = 0
    from django.db.models import F
    for pk in list(due.values_list("pk", flat=True)[:limit]):
        if not due.filter(pk=pk).update(lease_until=now + timedelta(seconds=90), attempts=F("attempts") + 1):
            continue
        row = PushDelivery.objects.select_related("device__session__user_account", "device__assignment__employee", "notification").get(pk=pk)
        deliver(row)
        count += 1
    # Bounded retention; no notice contents or indefinite retry queue.
    stale = list(PushDelivery.objects.filter(created_at__lt=now - timedelta(days=1)).values_list("pk", flat=True)[:1000])
    PushDelivery.objects.filter(pk__in=stale).delete()
    cutoff = now - timedelta(days=7)
    retired = list(PushDevice.objects.filter(Q(revoked_at__lt=cutoff) | Q(session__revoked_at__lt=cutoff)
        | Q(session__expires_at__lt=cutoff)).values_list("pk", flat=True)[:100])
    PushDevice.objects.filter(pk__in=retired).delete()
    return count
