from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import (
    AccessGrant,
    Employee,
    GrantAuthority,
    GrantAuthorityPermission,
    JobRole,
    JobRolePermission,
    OrganizationalUnit,
    Permission,
    PermissionAuditLog,
    Position,
    PositionAssignment,
    UserAccount,
)


# Define la vista de administracion del nucleo organizacional.
@admin.register(OrganizationalUnit)
class OrganizationalUnitAdmin(admin.ModelAdmin):
    list_display = ("name", "unit_type", "parent_unit", "sensitivity_level")
    search_fields = ("name",)
    list_filter = ("unit_type", "sensitivity_level")


@admin.register(JobRole)
class JobRoleAdmin(admin.ModelAdmin):
    list_display = ("title", "level", "created_at")
    search_fields = ("title",)


@admin.register(Position)
class PositionAdmin(admin.ModelAdmin):
    list_display = ("job_role", "unit", "reports_to_position", "is_open", "display_order")
    list_filter = ("is_open",)


@admin.register(Employee)
class EmployeeAdmin(admin.ModelAdmin):
    list_display = ("full_name", "is_active", "created_at")
    search_fields = ("full_name",)


@admin.register(UserAccount)
class UserAccountAdmin(BaseUserAdmin):
    list_display = ("email", "employee", "is_active", "is_staff", "created_at")
    search_fields = ("email", "employee__full_name")
    ordering = ("email",)
    list_filter = ("is_active", "is_staff", "is_superuser")
    readonly_fields = ("last_login", "created_at", "updated_at")
    fieldsets = (
        (None, {"fields": ("email", "password")}),
        ("Persona", {"fields": ("employee", "avatar_url")}),
        (
            "Permisos",
            {"fields": ("is_active", "is_staff", "is_superuser", "groups", "user_permissions")},
        ),
        ("Fechas", {"fields": ("last_login", "created_at", "updated_at")}),
    )
    add_fieldsets = (
        (
            None,
            {
                "classes": ("wide",),
                "fields": ("email", "employee", "password1", "password2", "is_active", "is_staff"),
            },
        ),
    )


@admin.register(PositionAssignment)
class PositionAssignmentAdmin(admin.ModelAdmin):
    list_display = ("employee", "position", "is_active", "assigned_at", "released_at")
    list_filter = ("is_active",)


# Define la vista de administracion de permisos base.
@admin.register(Permission)
class PermissionAdmin(admin.ModelAdmin):
    list_display = ("code", "resource", "action")
    search_fields = ("code", "resource", "action")


@admin.register(JobRolePermission)
class JobRolePermissionAdmin(admin.ModelAdmin):
    list_display = ("job_role", "permission", "scope_type", "effect", "target_unit")
    list_filter = ("scope_type", "effect")


# Define la vista de administracion de accesos especiales, delegacion y auditoria.
@admin.register(AccessGrant)
class AccessGrantAdmin(admin.ModelAdmin):
    list_display = (
        "grantee_assignment",
        "permission",
        "target_unit",
        "status",
        "valid_from",
        "valid_until",
    )
    list_filter = ("status",)


@admin.register(GrantAuthority)
class GrantAuthorityAdmin(admin.ModelAdmin):
    list_display = (
        "assignment",
        "target_unit",
        "max_sensitivity_level",
        "can_grant_access",
        "can_revoke_access",
        "can_delegate_authority",
        "is_active",
    )
    list_filter = ("is_active", "max_sensitivity_level")


@admin.register(GrantAuthorityPermission)
class GrantAuthorityPermissionAdmin(admin.ModelAdmin):
    list_display = ("grant_authority", "permission")


@admin.register(PermissionAuditLog)
class PermissionAuditLogAdmin(admin.ModelAdmin):
    list_display = ("employee", "permission", "target_unit", "decision", "created_at")
    list_filter = ("decision",)
    search_fields = ("employee__full_name",)
