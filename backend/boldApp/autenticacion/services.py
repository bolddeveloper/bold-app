import base64
import hashlib
import hmac
import json
import os
import secrets
import struct
import time
from datetime import datetime, time as clock_time, timedelta
from urllib.parse import quote
from zoneinfo import ZoneInfo

from cryptography.fernet import Fernet
from django.conf import settings
from django.core.cache import cache
from django.core.mail import send_mail
from django.db import transaction
from django.utils import timezone

from .models import AuthChallenge, AuthEvent, AuthMFAMethod, AuthRecoveryCode, AuthSession


def normalize_email(value):
    email = (value or "").strip().lower()
    if not email.endswith("@bold.gt"):
        raise ValueError("Se requiere un correo corporativo @bold.gt.")
    return email


def request_ip(request):
    return request.META.get("REMOTE_ADDR") or None


def token_hash(raw):
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def recovery_code_hash(raw):
    normalized = str(raw or "").replace(" ", "").upper()
    return hmac.new(settings.SECRET_KEY.encode(), f"auth-recovery:{normalized}".encode(), hashlib.sha256).hexdigest()


def email_fingerprint(email):
    return hmac.new(settings.SECRET_KEY.encode(), (email or "").strip().lower().encode(), hashlib.sha256).hexdigest()


def record_event(event_type, request=None, user=None, actor=None, session=None, success=True, reason="", metadata=None):
    return AuthEvent.objects.create(
        event_type=event_type,
        user_account=user,
        actor_account=actor,
        session=session,
        success=success,
        failure_reason_code=reason,
        ip_address=request_ip(request) if request else None,
        user_agent=(request.META.get("HTTP_USER_AGENT", "")[:1000] if request else ""),
        email_fingerprint=email_fingerprint(metadata.pop("email", "")) if metadata and metadata.get("email") else "",
        metadata=metadata or {},
    )


def next_daily_cutoff(now=None):
    zone = ZoneInfo(settings.AUTH_SESSION_TIME_ZONE)
    current = (now or timezone.now()).astimezone(zone)
    hour, minute = [int(part) for part in settings.AUTH_SESSION_CUTOFF_TIME.split(":", 1)]
    cutoff = datetime.combine(current.date(), clock_time(hour, minute), tzinfo=zone)
    if current >= cutoff:
        cutoff += timedelta(days=1)
    return cutoff.astimezone(ZoneInfo("UTC"))


def create_session(user, request, auth_strength="password", mfa_verified=False):
    raw = secrets.token_urlsafe(48)
    now = timezone.now()
    idle_seconds = settings.AUTH_SESSION_IDLE_SECONDS
    session = AuthSession.objects.create(
        user_account=user,
        token_hash=token_hash(raw),
        client_type=AuthSession.CLIENT_PWA,
        user_agent=request.META.get("HTTP_USER_AGENT", "")[:1000],
        created_ip=request_ip(request),
        last_ip=request_ip(request),
        expires_at=next_daily_cutoff(now),
        idle_expires_at=now + timedelta(seconds=idle_seconds) if idle_seconds else None,
        mfa_verified_at=now if mfa_verified else None,
        auth_strength=auth_strength,
        credentials_version=user.credentials_version,
    )
    record_event("login.succeeded", request, user=user, session=session, metadata={"auth_strength": auth_strength})
    return raw, session


def _notify_revoked_sessions(session_ids):
    from asgiref.sync import async_to_sync
    from channels.layers import get_channel_layer

    layer = get_channel_layer()
    if layer is None:
        return
    for session_id in session_ids:
        async_to_sync(layer.group_send)(
            f"session_{session_id}",
            {"type": "session.revoked"},
        )


def revoke_session(session, reason="logout", actor=None):
    if session and session.revoked_at is None:
        session.revoked_at = timezone.now()
        session.revocation_reason = reason
        session.revoked_by_account = actor
        session.save(update_fields=["revoked_at", "revocation_reason", "revoked_by_account"])
        transaction.on_commit(lambda: _notify_revoked_sessions([str(session.id)]))


def revoke_all_sessions(user, reason, actor=None):
    queryset = AuthSession.objects.filter(user_account=user, revoked_at__isnull=True)
    session_ids = [str(value) for value in queryset.values_list("id", flat=True)]
    updated = queryset.update(
        revoked_at=timezone.now(), revocation_reason=reason, revoked_by_account=actor
    )
    transaction.on_commit(lambda: _notify_revoked_sessions(session_ids))
    return updated


def _fernet():
    configured = settings.AUTH_ENCRYPTION_KEY.strip()
    if configured:
        return Fernet(base64.urlsafe_b64encode(hashlib.sha256(configured.encode()).digest()))
    if not settings.DEBUG:
        raise RuntimeError("AUTH_ENCRYPTION_KEY es obligatoria en producción.")
    derived = base64.urlsafe_b64encode(hashlib.sha256((settings.SECRET_KEY + ":auth-mfa").encode()).digest())
    return Fernet(derived)


def encrypt_secret(secret):
    return _fernet().encrypt(secret.encode()).decode()


def decrypt_secret(value):
    return _fernet().decrypt(value.encode()).decode()


def generate_totp_secret():
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def totp_code(secret, at=None, step=30, digits=6):
    padded = secret + "=" * ((8 - len(secret) % 8) % 8)
    key = base64.b32decode(padded, casefold=True)
    counter = int((at or time.time()) // step)
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 15
    number = (struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF) % (10 ** digits)
    return str(number).zfill(digits)


def verify_totp(secret, code):
    clean = str(code or "").replace(" ", "")
    now = time.time()
    return clean.isdigit() and any(hmac.compare_digest(totp_code(secret, now + drift * 30), clean) for drift in (-1, 0, 1))


def matching_totp_counter(secret, code):
    clean = str(code or "").replace(" ", "")
    current = int(time.time() // 30)
    if not clean.isdigit():
        return None
    for counter in (current - 1, current, current + 1):
        if hmac.compare_digest(totp_code(secret, counter * 30), clean):
            return counter
    return None


def provisioning_uri(user, secret):
    return f"otpauth://totp/{quote('Bold:' + user.email)}?secret={secret}&issuer=Bold&algorithm=SHA1&digits=6&period=30"


def replace_recovery_codes(user, count=10):
    batch = __import__("uuid").uuid4()
    AuthRecoveryCode.objects.filter(user_account=user, used_at__isnull=True).delete()
    raw_codes = [secrets.token_hex(5).upper() for _ in range(count)]
    AuthRecoveryCode.objects.bulk_create([
        AuthRecoveryCode(user_account=user, code_hash=recovery_code_hash(code), batch_id=batch) for code in raw_codes
    ])
    return raw_codes


def consume_recovery_code(user, code):
    with transaction.atomic():
        row = AuthRecoveryCode.objects.select_for_update().filter(user_account=user, code_hash=recovery_code_hash(code), used_at__isnull=True).first()
        if not row:
            return False
        row.used_at = timezone.now()
        row.save(update_fields=["used_at"])
        return True


def create_challenge(user, purpose, request, target_email=None, ttl=None):
    now = timezone.now()
    AuthChallenge.objects.filter(user_account=user, purpose=purpose, consumed_at__isnull=True, invalidated_at__isnull=True).update(invalidated_at=now)
    raw = secrets.token_urlsafe(48)
    challenge = AuthChallenge.objects.create(
        user_account=user, purpose=purpose, token_hash=token_hash(raw),
        target_email_normalized=target_email, requested_ip=request_ip(request),
        expires_at=now + timedelta(seconds=ttl or settings.AUTH_CHALLENGE_TTL_SECONDS),
    )
    return raw, challenge


def send_password_reset(user, raw_token):
    frontend = getattr(settings, "FRONTEND_URL", "http://localhost:5174").rstrip("/")
    send_mail("Restablecer contraseña de Bold", f"Abre este enlace para continuar: {frontend}/?reset_token={raw_token}", settings.DEFAULT_FROM_EMAIL, [user.email])


def send_account_invitation(user, raw_token):
    frontend = getattr(settings, "FRONTEND_URL", "http://localhost:5174").rstrip("/")
    send_mail(
        "Invitación a Bold",
        f"Tu cuenta corporativa fue creada. Define tu contraseña en: {frontend}/?invitation_token={raw_token}",
        settings.DEFAULT_FROM_EMAIL,
        [user.email],
    )


def issue_ws_ticket(user, session, assignment_id, unit_id, channel="tasks"):
    raw = secrets.token_urlsafe(32)
    payload = {
        "user": str(user.id),
        "session": str(session.id),
        "assignment": str(assignment_id or ""),
        "unit": str(unit_id or ""),
        "channel": channel,
        "credentials_version": user.credentials_version,
    }
    key = f"auth:ws:{token_hash(raw)}"
    if os.environ.get("REDIS_URL"):
        from redis import Redis
        Redis.from_url(os.environ["REDIS_URL"]).setex(key, settings.AUTH_WEBSOCKET_TICKET_TTL_SECONDS, json.dumps(payload))
    else:
        cache.set(key, json.dumps(payload), timeout=settings.AUTH_WEBSOCKET_TICKET_TTL_SECONDS)
    return raw


def consume_ws_ticket(raw):
    key = f"auth:ws:{token_hash(raw or '')}"
    if os.environ.get("REDIS_URL"):
        from redis import Redis
        value = Redis.from_url(os.environ["REDIS_URL"]).getdel(key)
        if isinstance(value, bytes): value = value.decode()
    else:
        value = cache.get(key)
        if value is not None: cache.delete(key)
    return json.loads(value) if value else None
