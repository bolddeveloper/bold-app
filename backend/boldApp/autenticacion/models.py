import uuid

from django.conf import settings
from django.db import models


class AuthSession(models.Model):
    CLIENT_WEB = "web"
    CLIENT_PWA = "pwa"
    CLIENT_ANDROID = "android"
    CLIENT_CHOICES = [(CLIENT_WEB, "Web"), (CLIENT_PWA, "PWA"), (CLIENT_ANDROID, "Android")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user_account = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="auth_sessions")
    token_hash = models.CharField(max_length=64, unique=True)
    client_type = models.CharField(max_length=20, choices=CLIENT_CHOICES, default=CLIENT_WEB)
    device_name = models.CharField(max_length=120, blank=True)
    user_agent = models.TextField(blank=True)
    created_ip = models.GenericIPAddressField(null=True, blank=True)
    last_ip = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    last_used_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    idle_expires_at = models.DateTimeField(null=True, blank=True)
    mfa_verified_at = models.DateTimeField(null=True, blank=True)
    auth_strength = models.CharField(max_length=30, default="password")
    credentials_version = models.PositiveIntegerField()
    revoked_at = models.DateTimeField(null=True, blank=True)
    revoked_by_account = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="revoked_auth_sessions")
    revocation_reason = models.CharField(max_length=80, blank=True)
    replaced_by = models.ForeignKey("self", on_delete=models.SET_NULL, null=True, blank=True, related_name="replaced_sessions")

    class Meta:
        db_table = "auth_sessions"
        indexes = [models.Index(fields=["user_account", "revoked_at", "expires_at"], name="idx_auth_session_active")]


class AuthChallenge(models.Model):
    PURPOSE_INVITATION = "account_invitation"
    PURPOSE_PASSWORD_RESET = "password_reset"
    PURPOSE_EMAIL_VERIFICATION = "email_verification"
    PURPOSE_EMAIL_CHANGE = "email_change"
    PURPOSE_CHOICES = [
        (PURPOSE_INVITATION, "Invitación"),
        (PURPOSE_PASSWORD_RESET, "Restablecer contraseña"),
        (PURPOSE_EMAIL_VERIFICATION, "Verificar correo"),
        (PURPOSE_EMAIL_CHANGE, "Cambiar correo"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user_account = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="auth_challenges")
    purpose = models.CharField(max_length=30, choices=PURPOSE_CHOICES)
    token_hash = models.CharField(max_length=64, unique=True)
    target_email_normalized = models.EmailField(max_length=180, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    consumed_at = models.DateTimeField(null=True, blank=True)
    invalidated_at = models.DateTimeField(null=True, blank=True)
    requested_ip = models.GenericIPAddressField(null=True, blank=True)
    attempt_count = models.PositiveIntegerField(default=0)
    max_attempts = models.PositiveIntegerField(default=5)
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = "auth_challenges"
        indexes = [models.Index(fields=["user_account", "purpose", "expires_at"], name="idx_auth_challenge_lookup")]


class AuthMFAMethod(models.Model):
    TYPE_TOTP = "totp"
    TYPE_WEBAUTHN = "webauthn"
    TYPE_CHOICES = [(TYPE_TOTP, "TOTP"), (TYPE_WEBAUTHN, "WebAuthn")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user_account = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="mfa_methods")
    method_type = models.CharField(max_length=20, choices=TYPE_CHOICES)
    label = models.CharField(max_length=80)
    secret_encrypted = models.TextField(blank=True)
    credential_id = models.BinaryField(null=True, blank=True)
    public_key = models.BinaryField(null=True, blank=True)
    sign_count = models.PositiveBigIntegerField(null=True, blank=True)
    last_totp_counter = models.PositiveBigIntegerField(null=True, blank=True)
    transports = models.JSONField(default=list, blank=True)
    is_primary = models.BooleanField(default=False)
    is_active = models.BooleanField(default=False)
    verified_at = models.DateTimeField(null=True, blank=True)
    last_used_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    disabled_at = models.DateTimeField(null=True, blank=True)
    disabled_by_account = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="disabled_mfa_methods")

    class Meta:
        db_table = "auth_mfa_methods"
        constraints = [models.UniqueConstraint(fields=["user_account", "credential_id"], name="unique_user_webauthn_credential")]


class AuthRecoveryCode(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user_account = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="recovery_codes")
    code_hash = models.CharField(max_length=64)
    batch_id = models.UUIDField(default=uuid.uuid4)
    created_at = models.DateTimeField(auto_now_add=True)
    used_at = models.DateTimeField(null=True, blank=True)
    used_session = models.ForeignKey(AuthSession, on_delete=models.SET_NULL, null=True, blank=True, related_name="used_recovery_codes")

    class Meta:
        db_table = "auth_recovery_codes"
        constraints = [models.UniqueConstraint(fields=["user_account", "code_hash"], name="unique_user_recovery_code")]


class AuthEvent(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user_account = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="auth_events")
    actor_account = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="auth_events_as_actor")
    session = models.ForeignKey(AuthSession, on_delete=models.SET_NULL, null=True, blank=True, related_name="events")
    event_type = models.CharField(max_length=60)
    success = models.BooleanField(default=True)
    occurred_at = models.DateTimeField(auto_now_add=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True)
    email_fingerprint = models.CharField(max_length=64, blank=True)
    failure_reason_code = models.CharField(max_length=60, blank=True)
    target_type = models.CharField(max_length=60, blank=True)
    target_id = models.UUIDField(null=True, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    correlation_id = models.UUIDField(default=uuid.uuid4)

    class Meta:
        db_table = "auth_events"
        ordering = ["-occurred_at"]
        indexes = [models.Index(fields=["user_account", "occurred_at"], name="idx_auth_event_user_time"), models.Index(fields=["event_type", "occurred_at"], name="idx_auth_event_type_time")]
