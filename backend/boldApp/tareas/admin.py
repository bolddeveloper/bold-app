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
    User,
    WebhookDelivery,
    WebhookEndpoint,
    Workspace,
    WorkspaceMember,
)


# Define la vista de administracion del modelo de usuarios.
# Recordatorio: el acceso a este panel esta reservado unicamente al
# superusuario creado con `createsuperuser`; los usuarios normales de
# boldApp nunca reciben is_staff=True.
@admin.register(User)
class UserAdmin(admin.ModelAdmin):
    list_display = ("email", "name", "is_active", "is_staff", "created_at")
    search_fields = ("email", "name")


# Define la vista de administracion de workspaces.
@admin.register(Workspace)
class WorkspaceAdmin(admin.ModelAdmin):
    list_display = ("name", "owner", "created_at", "deleted_at")
    search_fields = ("name",)


@admin.register(WorkspaceMember)
class WorkspaceMemberAdmin(admin.ModelAdmin):
    list_display = ("workspace", "user", "role", "status", "joined_at")


# Define la vista de administracion de proyectos.
@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = ("name", "workspace", "owner", "is_archived", "created_at")
    search_fields = ("name",)


@admin.register(ProjectMember)
class ProjectMemberAdmin(admin.ModelAdmin):
    list_display = ("project", "user", "role", "added_at")


@admin.register(Section)
class SectionAdmin(admin.ModelAdmin):
    list_display = ("name", "project", "position")


@admin.register(TaskStatus)
class TaskStatusAdmin(admin.ModelAdmin):
    list_display = ("name", "project", "category", "position", "is_final")


# Define la vista de administracion de tareas y sus relaciones.
@admin.register(Task)
class TaskAdmin(admin.ModelAdmin):
    list_display = ("title", "workspace", "assignee", "status", "priority", "due_date")
    search_fields = ("title",)


@admin.register(TaskProject)
class TaskProjectAdmin(admin.ModelAdmin):
    list_display = ("task", "project", "section", "position")


@admin.register(TaskDependency)
class TaskDependencyAdmin(admin.ModelAdmin):
    list_display = ("task", "depends_on_task", "type")


# Define la vista de administracion de colaboracion (comentarios, adjuntos, seguidores, historial).
@admin.register(Comment)
class CommentAdmin(admin.ModelAdmin):
    list_display = ("task", "user", "created_at")


@admin.register(Attachment)
class AttachmentAdmin(admin.ModelAdmin):
    list_display = ("file_name", "task", "uploaded_by", "size_bytes", "created_at")


@admin.register(TaskFollower)
class TaskFollowerAdmin(admin.ModelAdmin):
    list_display = ("task", "user", "notification_level", "followed_at")


@admin.register(ActivityLog)
class ActivityLogAdmin(admin.ModelAdmin):
    list_display = ("task", "actor", "action", "created_at")


# Define la vista de administracion de etiquetas y notificaciones.
@admin.register(Tag)
class TagAdmin(admin.ModelAdmin):
    list_display = ("name", "workspace", "color")


@admin.register(TaskTag)
class TaskTagAdmin(admin.ModelAdmin):
    list_display = ("task", "tag", "added_by", "added_at")


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ("title", "user", "type", "is_read", "created_at")


# Define la vista de administracion de webhooks: suscriptores y su log de entregas.
@admin.register(WebhookEndpoint)
class WebhookEndpointAdmin(admin.ModelAdmin):
    list_display = ("target_url", "workspace", "is_active", "created_at")


@admin.register(WebhookDelivery)
class WebhookDeliveryAdmin(admin.ModelAdmin):
    list_display = ("event_type", "endpoint", "succeeded", "response_status_code", "attempt_number", "created_at")
    list_filter = ("succeeded", "event_type")
