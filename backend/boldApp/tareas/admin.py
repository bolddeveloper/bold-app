from django.contrib import admin

from .models import (
    ActivityLog,
    Attachment,
    Comment,
    Notification,
    Project,
    ProjectMember,
    Section,
    Tag,
    Task,
    TaskDependency,
    TaskFollower,
    TaskProject,
    TaskStatus,
    TaskTag,
    WebhookDelivery,
    WebhookEndpoint,
)


@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = ("name", "unit", "owner_assignment", "status", "is_archived", "created_at")
    search_fields = ("name",)


@admin.register(ProjectMember)
class ProjectMemberAdmin(admin.ModelAdmin):
    list_display = ("project", "assignment", "member_role", "status", "joined_at")


@admin.register(Section)
class SectionAdmin(admin.ModelAdmin):
    list_display = ("name", "project", "position")


@admin.register(TaskStatus)
class TaskStatusAdmin(admin.ModelAdmin):
    list_display = ("name", "unit", "category", "position", "is_final")


@admin.register(Task)
class TaskAdmin(admin.ModelAdmin):
    list_display = ("title", "unit", "assignee_assignment", "status", "priority", "due_date")
    search_fields = ("title",)


@admin.register(TaskProject)
class TaskProjectAdmin(admin.ModelAdmin):
    list_display = ("task", "project", "section", "position", "added_by_assignment")


@admin.register(TaskDependency)
class TaskDependencyAdmin(admin.ModelAdmin):
    list_display = ("task", "depends_on_task", "dependency_type", "created_by_assignment")


@admin.register(Comment)
class CommentAdmin(admin.ModelAdmin):
    list_display = ("task", "author_assignment", "created_at")


@admin.register(Attachment)
class AttachmentAdmin(admin.ModelAdmin):
    list_display = ("file_name", "task", "uploaded_by_assignment", "size_bytes", "created_at")


@admin.register(TaskFollower)
class TaskFollowerAdmin(admin.ModelAdmin):
    list_display = ("task", "assignment", "notification_level", "followed_at")


@admin.register(ActivityLog)
class ActivityLogAdmin(admin.ModelAdmin):
    list_display = ("task", "actor_assignment", "action", "created_at")


@admin.register(Tag)
class TagAdmin(admin.ModelAdmin):
    list_display = ("name", "unit", "color_hex")


@admin.register(TaskTag)
class TaskTagAdmin(admin.ModelAdmin):
    list_display = ("task", "tag", "added_by_assignment", "added_at")


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ("title", "recipient_assignment", "type", "is_read", "created_at")


@admin.register(WebhookEndpoint)
class WebhookEndpointAdmin(admin.ModelAdmin):
    list_display = ("target_url", "unit", "is_active", "created_at")


@admin.register(WebhookDelivery)
class WebhookDeliveryAdmin(admin.ModelAdmin):
    list_display = ("event_type", "endpoint", "succeeded", "response_status_code", "attempt_number", "created_at")
    list_filter = ("succeeded", "event_type")
