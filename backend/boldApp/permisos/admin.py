from django.contrib import admin

from .models import PermissionPolicyEvent, PermissionPolicyState


class ReadOnlyAdminMixin:
    def get_readonly_fields(self, request, obj=None):
        return [field.name for field in self.model._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(PermissionPolicyState)
class PermissionPolicyStateAdmin(ReadOnlyAdminMixin, admin.ModelAdmin):
    list_display = ("key", "revision", "updated_at")


@admin.register(PermissionPolicyEvent)
class PermissionPolicyEventAdmin(ReadOnlyAdminMixin, admin.ModelAdmin):
    list_display = ("event_type", "actor_account", "target_type", "outcome", "revision", "occurred_at")
    list_filter = ("event_type", "outcome")
    search_fields = ("actor_account__email", "target_id", "reason")

