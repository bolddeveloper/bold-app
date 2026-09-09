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


# Define los serializers del nucleo organizacional.
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
    password = serializers.CharField(write_only=True, required=False)
    last_login_at = serializers.DateTimeField(source="last_login", read_only=True)

    class Meta:
        model = UserAccount
        fields = [
            "id",
            "employee",
            "email",
            "password",
            "avatar_url",
            "is_active",
            "last_login_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def create(self, validated_data):
        password = validated_data.pop("password", None)
        account = UserAccount(**validated_data)
        account.set_password(password)
        account.save()
        return account

    def update(self, instance, validated_data):
        password = validated_data.pop("password", None)
        instance = super().update(instance, validated_data)
        if password is not None:
            instance.set_password(password)
            instance.save(update_fields=["password"])
        return instance


class PositionAssignmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = PositionAssignment
        fields = "__all__"


class AssignmentDirectorySerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source="employee.full_name", read_only=True)
    unit = serializers.UUIDField(source="position.unit_id", read_only=True)
    unit_name = serializers.CharField(source="position.unit.name", read_only=True)
    job_role = serializers.UUIDField(source="position.job_role_id", read_only=True)
    job_role_title = serializers.CharField(source="position.job_role.title", read_only=True)

    class Meta:
        model = PositionAssignment
        fields = ["id", "employee", "employee_name", "unit", "unit_name", "job_role", "job_role_title"]


# Define los serializers de permisos base.
class PermissionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Permission
        fields = "__all__"


class JobRolePermissionSerializer(serializers.ModelSerializer):
    class Meta:
        model = JobRolePermission
        fields = "__all__"


# Define los serializers de accesos especiales, delegacion y auditoria.
# Antes de crear un AccessGrant, valida que quien lo otorga
# (granted_by_assignment) tenga una GrantAuthority activa y vigente que
# cubra la unidad objetivo con suficiente nivel de sensibilidad — es la
# regla implicita detras de por que existe la tabla GrantAuthorities.
class AccessGrantSerializer(serializers.ModelSerializer):
    class Meta:
        model = AccessGrant
        fields = "__all__"

    def validate(self, attrs):
        from .authorization import GRANT_CAPABILITY_GRANT, has_grant_authority

        granted_by_assignment = attrs.get("granted_by_assignment") or getattr(
            self.instance, "granted_by_assignment", None
        )
        target_unit = attrs.get("target_unit") or getattr(self.instance, "target_unit", None)

        if granted_by_assignment and target_unit:
            if not has_grant_authority(granted_by_assignment, target_unit, GRANT_CAPABILITY_GRANT):
                raise serializers.ValidationError(
                    "La plaza otorgante no tiene autoridad de delegacion (GrantAuthority) "
                    "vigente sobre la unidad objetivo."
                )
        return attrs


class GrantAuthoritySerializer(serializers.ModelSerializer):
    class Meta:
        model = GrantAuthority
        fields = "__all__"


class GrantAuthorityPermissionSerializer(serializers.ModelSerializer):
    class Meta:
        model = GrantAuthorityPermission
        fields = "__all__"


class PermissionAuditLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = PermissionAuditLog
        fields = "__all__"
        read_only_fields = ["id", "created_at"]


# Define el contrato de entrada de POST /api/core/authorize/: el endpoint
# que el resto de modulos (incluida la futura version de tareas) usan para
# preguntarle al nucleo si un empleado puede hacer algo, sin reimplementar
# la logica de resolucion de permisos en cada modulo.
class AuthorizationCheckSerializer(serializers.Serializer):
    assignment = serializers.PrimaryKeyRelatedField(queryset=PositionAssignment.objects.all())
    permission_code = serializers.CharField()
    target_unit = serializers.PrimaryKeyRelatedField(queryset=OrganizationalUnit.objects.all())
    resource_id = serializers.UUIDField(required=False, allow_null=True)

    def validate(self, attrs):
        request = self.context["request"]
        assignment = attrs["assignment"]
        if assignment.employee_id != request.user.employee_id:
            raise serializers.ValidationError({"assignment": "La asignacion no pertenece a la cuenta autenticada."})
        attrs["employee"] = request.user.employee
        return attrs
