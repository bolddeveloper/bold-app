from django.contrib import admin

from .models import AdministrativeAction, OffboardingCase, ResponsibilityTransfer, SystemAuditEvent


class ImmutableAuditAdmin(admin.ModelAdmin):
    def has_add_permission(self, request): return False
    def has_change_permission(self, request, obj=None): return False
    def has_delete_permission(self, request, obj=None): return False


@admin.register(AdministrativeAction)
class AdministrativeActionAdmin(ImmutableAuditAdmin):
    list_display = ("action_type", "actor_account", "target_employee", "status", "requested_at", "completed_at")
    list_filter = ("status", "action_type")
    search_fields = ("actor_account__email", "target_employee__full_name", "correlation_id")


@admin.register(SystemAuditEvent)
class SystemAuditEventAdmin(ImmutableAuditAdmin):
    list_display = ("module_code", "event_type", "actor_account", "outcome", "occurred_at")
    list_filter = ("module_code", "outcome")
    search_fields = ("event_type", "actor_account__email", "correlation_id")


@admin.register(OffboardingCase)
class OffboardingCaseAdmin(ImmutableAuditAdmin):
    list_display = ("employee", "status", "initiated_by_account", "effective_at", "completed_at")
    list_filter = ("status",)


@admin.register(ResponsibilityTransfer)
class ResponsibilityTransferAdmin(ImmutableAuditAdmin):
    list_display = ("source_module", "resource_type", "resource_id", "source_assignment", "target_assignment", "status")
    list_filter = ("source_module", "resource_type", "status")
