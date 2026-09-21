from rest_framework import serializers

from boldApp.core.models import (
    AccessGrant,
    GrantAuthority,
    JobRole,
    JobRolePermission,
    OrganizationalUnit,
    Permission,
    PositionAssignment,
)

from .models import PermissionPolicyEvent
from boldApp.core.authorization import access_grant_is_potentially_effective


class PermissionCatalogSerializer(serializers.ModelSerializer):
    class Meta:
        model = Permission
        fields = [
            "id", "code", "module_code", "resource", "action", "description", "risk_level",
            "is_delegable", "requires_step_up_mfa", "is_active", "system_managed", "created_at", "updated_at",
        ]


class ScopeRuleSerializer(serializers.Serializer):
    effect = serializers.ChoiceField(choices=JobRolePermission.EFFECT_CHOICES)
    scope_type = serializers.ChoiceField(choices=JobRolePermission.SCOPE_CHOICES)
    target_unit = serializers.PrimaryKeyRelatedField(
        queryset=OrganizationalUnit.objects.all(), required=False, allow_null=True
    )

    def validate(self, attrs):
        scope = attrs["scope_type"]
        target = attrs.get("target_unit")
        if scope in {JobRolePermission.SCOPE_GLOBAL, JobRolePermission.SCOPE_OWN_UNIT} and target:
            raise serializers.ValidationError({"target_unit": "Este alcance no admite una unidad explícita."})
        if scope in {JobRolePermission.SCOPE_SPECIFIC_UNIT, JobRolePermission.SCOPE_SUB_TREE} and not target:
            raise serializers.ValidationError({"target_unit": "Este alcance requiere una unidad objetivo."})
        return attrs


class RolePolicyApplySerializer(serializers.Serializer):
    job_role = serializers.PrimaryKeyRelatedField(queryset=JobRole.objects.all())
    permission = serializers.PrimaryKeyRelatedField(queryset=Permission.objects.all())
    rules = ScopeRuleSerializer(many=True, allow_empty=True)
    reason = serializers.CharField(min_length=8, max_length=2000)
    expected_revision = serializers.IntegerField(min_value=0, required=False)

    def validate_rules(self, rules):
        seen = set()
        for rule in rules:
            key = (rule["scope_type"], getattr(rule.get("target_unit"), "id", None))
            if key in seen:
                raise serializers.ValidationError("No repitas el mismo alcance para un permiso.")
            seen.add(key)
        return rules


class JobRolePermissionDetailSerializer(serializers.ModelSerializer):
    job_role_title = serializers.CharField(source="job_role.title", read_only=True)
    permission_code = serializers.CharField(source="permission.code", read_only=True)
    target_unit_name = serializers.CharField(source="target_unit.name", read_only=True)
    created_by_email = serializers.EmailField(source="created_by_account.email", read_only=True)

    class Meta:
        model = JobRolePermission
        fields = [
            "id", "job_role", "job_role_title", "permission", "permission_code", "effect",
            "scope_type", "target_unit", "target_unit_name", "reason", "created_by_email",
            "created_at", "updated_at",
        ]


class AccessRuleCreateSerializer(serializers.Serializer):
    grantee_assignment = serializers.PrimaryKeyRelatedField(
        queryset=PositionAssignment.objects.filter(
            is_active=True, released_at__isnull=True, employee__is_active=True, employee__user_account__is_active=True
        )
    )
    permission = serializers.PrimaryKeyRelatedField(queryset=Permission.objects.all())
    effect = serializers.ChoiceField(choices=AccessGrant.EFFECT_CHOICES, default=AccessGrant.EFFECT_ALLOW)
    scope_type = serializers.ChoiceField(choices=AccessGrant.SCOPE_CHOICES, default=AccessGrant.SCOPE_SPECIFIC_UNIT)
    target_unit = serializers.PrimaryKeyRelatedField(
        queryset=OrganizationalUnit.objects.all(), required=False, allow_null=True
    )
    resource_type = serializers.CharField(max_length=80, required=False, allow_blank=True, default="")
    resource_id = serializers.CharField(max_length=120, required=False, allow_null=True, allow_blank=False)
    valid_from = serializers.DateTimeField(required=False)
    valid_until = serializers.DateTimeField(required=False, allow_null=True)
    reason = serializers.CharField(min_length=8, max_length=2000)
    expected_revision = serializers.IntegerField(min_value=0, required=False)


class RevokeSerializer(serializers.Serializer):
    reason = serializers.CharField(min_length=8, max_length=2000)
    expected_revision = serializers.IntegerField(min_value=0, required=False)


class AccessGrantDetailSerializer(serializers.ModelSerializer):
    permission_code = serializers.CharField(source="permission.code", read_only=True)
    grantee_name = serializers.CharField(source="grantee_assignment.employee.full_name", read_only=True)
    grantee_email = serializers.EmailField(source="grantee_assignment.employee.user_account.email", read_only=True)
    grantee_unit_name = serializers.CharField(source="grantee_assignment.position.unit.name", read_only=True)
    target_unit_name = serializers.CharField(source="target_unit.name", read_only=True)
    granted_by_email = serializers.EmailField(source="created_by_account.email", read_only=True)
    revoked_by_email = serializers.EmailField(source="revoked_by_account.email", read_only=True)
    effective = serializers.SerializerMethodField()

    class Meta:
        model = AccessGrant
        fields = [
            "id", "grantee_assignment", "grantee_name", "grantee_email", "grantee_unit_name",
            "permission", "permission_code", "effect", "scope_type", "target_unit", "target_unit_name",
            "resource_type", "resource_id", "valid_from", "valid_until", "reason", "source", "status",
            "effective", "granted_by_assignment", "granted_by_email", "created_at", "revoked_at",
            "revoked_by_assignment", "revoked_by_email", "revocation_reason", "source_authority",
        ]

    def get_effective(self, grant):
        return access_grant_is_potentially_effective(grant)


class GrantAuthorityCreateSerializer(serializers.Serializer):
    assignment = serializers.PrimaryKeyRelatedField(
        queryset=PositionAssignment.objects.filter(
            is_active=True, released_at__isnull=True, employee__is_active=True, employee__user_account__is_active=True
        )
    )
    permissions = serializers.PrimaryKeyRelatedField(queryset=Permission.objects.all(), many=True)
    scope_type = serializers.ChoiceField(choices=GrantAuthority.SCOPE_CHOICES, default=GrantAuthority.SCOPE_SUB_TREE)
    target_unit = serializers.PrimaryKeyRelatedField(
        queryset=OrganizationalUnit.objects.all(), required=False, allow_null=True
    )
    max_sensitivity_level = serializers.ChoiceField(choices=Permission.RISK_CHOICES)
    valid_until = serializers.DateTimeField()
    max_grant_duration_seconds = serializers.IntegerField(min_value=300, max_value=7776000, default=604800)
    delegation_depth_remaining = serializers.IntegerField(min_value=0, max_value=5, default=0)
    can_grant_access = serializers.BooleanField(default=True)
    can_revoke_access = serializers.BooleanField(default=True)
    can_delegate_authority = serializers.BooleanField(default=False)
    reason = serializers.CharField(min_length=8, max_length=2000)
    expected_revision = serializers.IntegerField(min_value=0, required=False)

    def validate_permissions(self, permissions):
        permission_ids = [permission.id for permission in permissions]
        if len(permission_ids) != len(set(permission_ids)):
            raise serializers.ValidationError("No repitas permisos dentro de una misma autoridad.")
        return permissions


class GrantAuthorityDetailSerializer(serializers.ModelSerializer):
    assignment_name = serializers.CharField(source="assignment.employee.full_name", read_only=True)
    assignment_email = serializers.EmailField(source="assignment.employee.user_account.email", read_only=True)
    assignment_unit_name = serializers.CharField(source="assignment.position.unit.name", read_only=True)
    target_unit_name = serializers.CharField(source="target_unit.name", read_only=True)
    permission_codes = serializers.SerializerMethodField()
    granted_by_email = serializers.EmailField(source="created_by_account.email", read_only=True)
    revoked_by_email = serializers.EmailField(source="revoked_by_account.email", read_only=True)
    effective = serializers.SerializerMethodField()

    class Meta:
        model = GrantAuthority
        fields = [
            "id", "assignment", "assignment_name", "assignment_email", "assignment_unit_name",
            "scope_type", "target_unit", "target_unit_name", "max_sensitivity_level",
            "can_grant_access", "can_revoke_access", "can_delegate_authority", "permission_codes",
            "granted_by_assignment", "granted_by_email", "parent_authority", "valid_from", "valid_until",
            "max_grant_duration_seconds", "delegation_depth_remaining", "reason", "is_active", "created_at",
            "revoked_at", "revoked_by_email", "revocation_reason", "effective",
        ]

    def get_permission_codes(self, authority):
        return [link.permission.code for link in authority.scoped_permissions.all()]

    def get_effective(self, authority):
        from boldApp.core.authorization import authority_is_effective

        return authority_is_effective(authority) and any(
            link.permission.is_active and link.permission.is_delegable
            for link in authority.scoped_permissions.all()
        )


class PermissionPolicyEventSerializer(serializers.ModelSerializer):
    actor_email = serializers.EmailField(source="actor_account.email", read_only=True)
    permission_code = serializers.CharField(source="permission.code", read_only=True)
    target_unit_name = serializers.CharField(source="target_unit.name", read_only=True)

    class Meta:
        model = PermissionPolicyEvent
        fields = [
            "id", "revision", "actor_account", "actor_email", "actor_assignment", "session_id",
            "event_type", "outcome", "target_type", "target_id", "permission", "permission_code",
            "target_unit", "target_unit_name", "reason", "before", "after", "metadata",
            "mfa_verified", "ip_address", "correlation_id", "occurred_at",
        ]


class EffectiveAccessQuerySerializer(serializers.Serializer):
    unit = serializers.PrimaryKeyRelatedField(queryset=OrganizationalUnit.objects.all())
