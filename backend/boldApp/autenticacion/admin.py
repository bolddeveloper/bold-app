from django.contrib import admin

from .models import AuthChallenge, AuthEvent, AuthMFAMethod, AuthRecoveryCode, AuthSession


@admin.register(AuthSession)
class AuthSessionAdmin(admin.ModelAdmin):
    list_display = ("user_account", "client_type", "auth_strength", "last_used_at", "expires_at", "revoked_at")
    list_filter = ("client_type", "auth_strength", "revoked_at")
    exclude = ("token_hash",)
    readonly_fields = tuple(field.name for field in AuthSession._meta.fields if field.name != "token_hash")

    def has_add_permission(self, request): return False
    def has_change_permission(self, request, obj=None): return False
    def has_delete_permission(self, request, obj=None): return False


@admin.register(AuthEvent)
class AuthEventAdmin(admin.ModelAdmin):
    list_display = ("event_type", "user_account", "success", "ip_address", "occurred_at")
    list_filter = ("event_type", "success")
    search_fields = ("user_account__email", "correlation_id")
    readonly_fields = tuple(field.name for field in AuthEvent._meta.fields)

    def has_add_permission(self, request): return False
    def has_change_permission(self, request, obj=None): return False
    def has_delete_permission(self, request, obj=None): return False


class ImmutableSecurityRecordAdmin(admin.ModelAdmin):
    def has_add_permission(self, request): return False
    def has_change_permission(self, request, obj=None): return False
    def has_delete_permission(self, request, obj=None): return False


@admin.register(AuthChallenge)
class AuthChallengeAdmin(ImmutableSecurityRecordAdmin):
    list_display = ("user_account", "purpose", "created_at", "expires_at", "consumed_at", "invalidated_at")
    exclude = ("token_hash",)
    readonly_fields = tuple(field.name for field in AuthChallenge._meta.fields if field.name != "token_hash")


@admin.register(AuthMFAMethod)
class AuthMFAMethodAdmin(ImmutableSecurityRecordAdmin):
    list_display = ("user_account", "method_type", "label", "is_active", "verified_at", "last_used_at")
    exclude = ("secret_encrypted", "credential_id", "public_key")
    readonly_fields = tuple(field.name for field in AuthMFAMethod._meta.fields if field.name not in {"secret_encrypted", "credential_id", "public_key"})


@admin.register(AuthRecoveryCode)
class AuthRecoveryCodeAdmin(ImmutableSecurityRecordAdmin):
    list_display = ("user_account", "batch_id", "created_at", "used_at")
    exclude = ("code_hash",)
    readonly_fields = tuple(field.name for field in AuthRecoveryCode._meta.fields if field.name != "code_hash")
