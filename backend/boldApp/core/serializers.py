from rest_framework import serializers
from django.contrib.auth.password_validation import validate_password
from django.utils import timezone

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
            "email_verified_at",
            "password_changed_at",
            "must_change_password",
            "deactivated_at",
            "last_login_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "email_verified_at", "password_changed_at", "deactivated_at", "created_at", "updated_at"]

    def validate_email(self, value):
        email = value.strip().lower()
        if not email.endswith("@bold.gt"):
            raise serializers.ValidationError("Se requiere un correo corporativo @bold.gt.")
        if self.instance and email != self.instance.email:
            raise serializers.ValidationError("El correo debe cambiarse mediante el flujo de verificación de Autenticación.")
        return email

    def validate_password(self, value):
        request = self.context.get("request")
        session = getattr(request, "auth", None) if request else None
        if not request or not request.user.is_staff or not getattr(session, "mfa_verified_at", None):
            raise serializers.ValidationError("Cambiar credenciales administrativamente requiere una sesión con MFA verificado.")
        validate_password(value, self.instance)
        return value

    def create(self, validated_data):
        password = validated_data.pop("password", None)
        account = UserAccount(**validated_data)
        if password is None:
            account.set_unusable_password()
        else:
            account.set_password(password)
            account.password_changed_at = timezone.now()
            account.must_change_password = True
        account.save()
        return account

    def update(self, instance, validated_data):
        password = validated_data.pop("password", None)
        instance = super().update(instance, validated_data)
        if password is not None:
            from boldApp.autenticacion.services import record_event, revoke_all_sessions

            instance.set_password(password)
            instance.password_changed_at = timezone.now()
            instance.must_change_password = True
            instance.credentials_version += 1
            instance.save(update_fields=["password", "password_changed_at", "must_change_password", "credentials_version", "updated_at"])
            request = self.context["request"]
            revoke_all_sessions(instance, "admin_password_reset", request.user)
            record_event("password.admin_reset", request, user=instance, actor=request.user, session=request.auth)
        return instance


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

    class Meta:
        model = PositionAssignment
        fields = ["id", "employee", "employee_name", "employee_email", "unit", "unit_name", "job_role", "job_role_title"]

    def get_employee_email(self, assignment):
        account = getattr(assignment.employee, "user_account", None)
        return account.email if account and account.is_active else ""


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
