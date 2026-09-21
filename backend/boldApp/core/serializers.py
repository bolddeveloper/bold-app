from rest_framework import serializers

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


class OrganizationalUnitSerializer(serializers.ModelSerializer):
    class Meta:
        model = OrganizationalUnit
        fields = "__all__"


class JobRoleSerializer(serializers.ModelSerializer):
    class Meta:
        model = JobRole
        fields = "__all__"


class PositionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Position
        fields = "__all__"


class EmployeeSerializer(serializers.ModelSerializer):
    class Meta:
        model = Employee
        fields = "__all__"


class UserAccountSerializer(serializers.ModelSerializer):
    last_login_at = serializers.DateTimeField(source="last_login", read_only=True)

    class Meta:
        model = UserAccount
        fields = [
            "id",
            "employee",
            "email",
            "avatar_url",
            "is_active",
            "is_superuser",
            "email_verified_at",
            "password_changed_at",
            "must_change_password",
            "deactivated_at",
            "last_login_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class PositionAssignmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = PositionAssignment
        fields = "__all__"


class AssignmentDirectorySerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source="employee.full_name", read_only=True)
    employee_email = serializers.SerializerMethodField()
    unit = serializers.UUIDField(source="position.unit_id", read_only=True)
    unit_name = serializers.CharField(source="position.unit.name", read_only=True)
    job_role = serializers.UUIDField(source="position.job_role_id", read_only=True)
    job_role_title = serializers.CharField(source="position.job_role.title", read_only=True)
    account_is_superuser = serializers.SerializerMethodField()

    class Meta:
        model = PositionAssignment
        fields = [
            "id", "employee", "employee_name", "employee_email", "unit", "unit_name",
            "job_role", "job_role_title", "account_is_superuser",
        ]

    def get_employee_email(self, assignment):
        account = getattr(assignment.employee, "user_account", None)
        return account.email if account and account.is_active else ""

    def get_account_is_superuser(self, assignment):
        account = getattr(assignment.employee, "user_account", None)
        return bool(account and account.is_superuser)


class PermissionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Permission
        fields = "__all__"


class JobRolePermissionSerializer(serializers.ModelSerializer):
    class Meta:
        model = JobRolePermission
        fields = "__all__"


class AccessGrantSerializer(serializers.ModelSerializer):
    class Meta:
        model = AccessGrant
        fields = "__all__"
        read_only_fields = [
            "granted_by_assignment",
            "source_authority",
            "created_by_account",
            "status",
            "created_at",
            "revoked_at",
            "revoked_by_assignment",
            "revoked_by_account",
            "revocation_reason",
        ]


class GrantAuthoritySerializer(serializers.ModelSerializer):
    class Meta:
        model = GrantAuthority
        fields = "__all__"
        read_only_fields = [
            "granted_by_assignment",
            "parent_authority",
            "created_by_account",
            "is_active",
            "created_at",
            "revoked_at",
            "revoked_by_account",
            "revocation_reason",
        ]


class GrantAuthorityPermissionSerializer(serializers.ModelSerializer):
    class Meta:
        model = GrantAuthorityPermission
        fields = "__all__"
        read_only_fields = ["grant_authority", "permission"]


class PermissionAuditLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = PermissionAuditLog
        fields = "__all__"
        read_only_fields = [field.name for field in PermissionAuditLog._meta.fields]


class AuthorizationCheckSerializer(serializers.Serializer):
    assignment = serializers.PrimaryKeyRelatedField(
        queryset=PositionAssignment.objects.select_related("employee", "position__unit", "position__job_role")
    )
    permission_code = serializers.CharField(max_length=100)
    target_unit = serializers.PrimaryKeyRelatedField(queryset=OrganizationalUnit.objects.all())
    resource_id = serializers.CharField(required=False, allow_null=True, max_length=120)
    resource_type = serializers.CharField(required=False, allow_blank=True, max_length=80)

    def validate(self, attrs):
        request = self.context["request"]
        assignment = attrs["assignment"]
        if assignment.employee_id != request.user.employee_id:
            raise serializers.ValidationError({"assignment": "La asignación no pertenece a la cuenta autenticada."})
        if not assignment.is_active or assignment.released_at is not None or not assignment.employee.is_active:
            raise serializers.ValidationError({"assignment": "La asignación no está activa."})
        attrs["permission_code"] = attrs["permission_code"].strip().lower()
        return attrs
