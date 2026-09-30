from django.contrib import admin

from .models import Suggestion, SuggestionEvent


@admin.register(Suggestion)
class SuggestionAdmin(admin.ModelAdmin):
    list_display = ("category", "status", "unit", "author_assignment", "created_at")
    list_filter = ("category", "status", "unit")
    search_fields = ("message", "author_assignment__employee__full_name")
    readonly_fields = ("created_at", "updated_at")


@admin.register(SuggestionEvent)
class SuggestionEventAdmin(admin.ModelAdmin):
    list_display = ("event_type", "suggestion", "actor_assignment", "occurred_at")
    readonly_fields = [field.name for field in SuggestionEvent._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
