from difflib import SequenceMatcher
import re
import unicodedata

from django.conf import settings
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import Max
from rest_framework import serializers

from boldApp.autenticacion.models import AuthSession
from boldApp.autenticacion.services import normalize_email
from boldApp.core.models import Employee, JobRole, OrganizationalUnit, Position, PositionAssignment, UserAccount

from .models import AdministrativeAction, OffboardingCase, OrganizationCatalogOption, ResponsibilityTransfer, SystemAuditEvent


class AdminAccountSummarySerializer(serializers.ModelSerializer):
    mfa_enabled = serializers.SerializerMethodField()
    active_sessions = serializers.SerializerMethodField()
    has_usable_password = serializers.SerializerMethodField()

    class Meta:
        model = UserAccount
        fields = [
            "id", "email", "avatar_url", "is_active", "is_superuser", "email_verified_at",
            "password_changed_at", "must_change_password", "deactivated_at", "last_login",
            "mfa_enabled", "active_sessions", "has_usable_password",
        ]

    def get_mfa_enabled(self, account):
        return account.mfa_methods.filter(is_active=True).exists()

    def get_active_sessions(self, account):
        return account.auth_sessions.filter(revoked_at__isnull=True).count()

    def get_has_usable_password(self, account):
        return account.has_usable_password()


class AdminAssignmentSummarySerializer(serializers.ModelSerializer):
    unit_id = serializers.UUIDField(source="position.unit_id", read_only=True)
    unit_name = serializers.CharField(source="position.unit.name", read_only=True)
    role_id = serializers.UUIDField(source="position.job_role_id", read_only=True)
    role_title = serializers.CharField(source="position.job_role.title", read_only=True)

    class Meta:
        model = PositionAssignment
        fields = ["id", "position", "unit_id", "unit_name", "role_id", "role_title", "assigned_at", "released_at", "is_active"]


class AdminEmployeeSerializer(serializers.ModelSerializer):
    account = serializers.SerializerMethodField()
    assignments = serializers.SerializerMethodField()

    class Meta:
        model = Employee
        fields = ["id", "full_name", "is_active", "created_at", "updated_at", "account", "assignments"]

    def get_account(self, employee):
        account = getattr(employee, "user_account", None)
        return AdminAccountSummarySerializer(account).data if account else None

    def get_assignments(self, employee):
        rows = employee.position_assignments.select_related("position__unit", "position__job_role").order_by("-assigned_at")
        return AdminAssignmentSummarySerializer(rows, many=True).data


class AdminEmployeeCreateSerializer(serializers.Serializer):
    full_name = serializers.CharField(max_length=140)
    email = serializers.EmailField()
    position = serializers.PrimaryKeyRelatedField(queryset=Position.objects.all(), required=False, allow_null=True)
    temporary_password = serializers.CharField(
        write_only=True,
        required=False,
        allow_blank=False,
        trim_whitespace=False,
        max_length=1024,
        style={"input_type": "password"},
    )

    def validate_email(self, value):
        try:
            email = normalize_email(value)
        except ValueError as error:
            raise serializers.ValidationError(str(error)) from error
        if UserAccount.objects.filter(email__iexact=email).exists():
            raise serializers.ValidationError("Ya existe una cuenta con este correo.")
        return email

    def validate_position(self, position):
        if position and not position.is_open:
            raise serializers.ValidationError("La plaza seleccionada está cerrada.")
        if position and PositionAssignment.objects.filter(position=position, is_active=True, released_at__isnull=True).exists():
            raise serializers.ValidationError("La plaza seleccionada ya está ocupada.")
        return position

    def validate(self, attrs):
        temporary_password = attrs.get("temporary_password")
        if not temporary_password:
            return attrs
        if not getattr(settings, "ADMIN_TEMPORARY_PASSWORD_ENABLED", False):
            raise serializers.ValidationError({
                "temporary_password": "La asignación temporal de contraseñas está deshabilitada."
            })
        candidate = UserAccount(email=attrs.get("email", ""))
        try:
            validate_password(temporary_password, user=candidate)
        except DjangoValidationError as error:
            raise serializers.ValidationError({"temporary_password": list(error.messages)}) from error
        return attrs


class AdminEmployeeUpdateSerializer(serializers.ModelSerializer):
    email = serializers.EmailField(required=False)
    reason = serializers.CharField(write_only=True, min_length=8, max_length=1000)

    class Meta:
        model = Employee
        fields = ["full_name", "email", "reason"]

    def validate_full_name(self, value):
        value = " ".join(value.split())
        if len(value) < 2:
            raise serializers.ValidationError("Ingresa un nombre válido.")
        return value

    def validate_email(self, value):
        account = self.context.get("account") or getattr(self.instance, "user_account", None)
        if account is None:
            raise serializers.ValidationError("El empleado no tiene una cuenta asociada.")
        try:
            email = normalize_email(value)
        except ValueError as error:
            raise serializers.ValidationError(str(error)) from error
        if UserAccount.objects.filter(email__iexact=email).exclude(pk=account.pk).exists():
            raise serializers.ValidationError("Ya existe una cuenta con este correo.")
        return email

    def validate(self, attrs):
        if not str(self.initial_data.get("reason", "")).strip():
            raise serializers.ValidationError({"reason": "El motivo es obligatorio."})
        if "full_name" not in attrs and "email" not in attrs:
            raise serializers.ValidationError("Indica el nombre o correo que deseas actualizar.")
        attrs["reason"] = attrs["reason"].strip()
        return attrs

    def update(self, instance, validated_data):
        validated_data.pop("reason")
        validated_data.pop("email", None)
        return super().update(instance, validated_data)


class AdminTemporaryPasswordSerializer(serializers.Serializer):
    password = serializers.CharField(write_only=True, trim_whitespace=False, max_length=1024)
    password_confirmation = serializers.CharField(write_only=True, trim_whitespace=False, max_length=1024)
    reason = serializers.CharField(min_length=8, max_length=1000)

    def validate(self, attrs):
        if attrs["password"] != attrs["password_confirmation"]:
            raise serializers.ValidationError({"password_confirmation": "Las contraseñas no coinciden."})
        try:
            validate_password(attrs["password"], user=self.context["account"])
        except DjangoValidationError as error:
            raise serializers.ValidationError({"password": list(error.messages)}) from error
        attrs["reason"] = attrs["reason"].strip()
        return attrs


class OrganizationalUnitAdminSerializer(serializers.ModelSerializer):
    reason = serializers.CharField(write_only=True, min_length=8, max_length=1000)

    class Meta:
        model = OrganizationalUnit
        fields = ["id", "name", "unit_type", "parent_unit", "sensitivity_level", "color_hex", "is_control_plane", "created_at", "updated_at", "reason"]
        read_only_fields = ["id", "is_control_plane", "created_at", "updated_at"]

    def create(self, validated_data):
        validated_data.pop("reason")
        return super().create(validated_data)

    def validate(self, attrs):
        if not str(self.initial_data.get("reason", "")).strip():
            raise serializers.ValidationError({"reason": "El motivo es obligatorio."})
        return attrs

    def update(self, instance, validated_data):
        validated_data.pop("reason")
        return super().update(instance, validated_data)

    def validate_parent_unit(self, parent):
        current = self.instance
        if current and current.is_control_plane and parent != current.parent_unit:
            raise serializers.ValidationError("La unidad de Dirección debe permanecer en la raíz de la organización.")
        ancestor = parent
        visited = set()
        while ancestor:
            if ancestor.id in visited or (current and ancestor.id == current.id):
                raise serializers.ValidationError("Una unidad no puede depender de sí misma ni de una descendiente.")
            visited.add(ancestor.id)
            ancestor = ancestor.parent_unit
        return parent

    def validate_unit_type(self, value):
        if not OrganizationCatalogOption.objects.filter(kind=OrganizationCatalogOption.UNIT_TYPE, value=value).exists():
            raise serializers.ValidationError("Selecciona un tipo registrado.")
        return value

    def validate_sensitivity_level(self, value):
        if not OrganizationCatalogOption.objects.filter(kind=OrganizationCatalogOption.SENSITIVITY, value=value).exists():
            raise serializers.ValidationError("Selecciona una sensibilidad registrada.")
        return value


class OrganizationCatalogOptionSerializer(serializers.ModelSerializer):
    def validate(self, attrs):
        kind = attrs.get("kind", getattr(self.instance, "kind", None))
        if self.instance and kind != self.instance.kind:
            raise serializers.ValidationError({"kind": "No se puede cambiar el tipo de catálogo."})
        value = unicodedata.normalize("NFKC", attrs.get("value", getattr(self.instance, "value", ""))).strip()
        if not value:
            raise serializers.ValidationError({"value": "Ingresa un nombre."})
        if kind == OrganizationCatalogOption.ROLE_LEVEL:
            options = OrganizationCatalogOption.objects.filter(kind=kind)
            if self.instance:
                options = options.exclude(pk=self.instance.pk)
            names = list(options.values_list("value", flat=True))
            names.extend(JobRole.objects.exclude(level=getattr(self.instance, "value", None)).values_list("level", flat=True))
            normalized = " ".join(value.casefold().split())
            if any(" ".join(unicodedata.normalize("NFKC", name or "").casefold().split()) == normalized for name in names):
                raise serializers.ValidationError({"value": "Ya existe un nivel con ese nombre."})
        attrs["value"] = value
        return attrs

    class Meta:
        model = OrganizationCatalogOption
        fields = ["id", "kind", "value"]


class JobRoleAdminSerializer(serializers.ModelSerializer):
    reason = serializers.CharField(write_only=True, min_length=8, max_length=1000)

    class Meta:
        model = JobRole
        fields = ["id", "title", "level", "description", "created_at", "reason", "administration_enabled", "permissions_enabled"]
        read_only_fields = ["id", "created_at", "administration_enabled", "permissions_enabled"]

    def create(self, validated_data):
        validated_data.pop("reason")
        return super().create(validated_data)

    def validate(self, attrs):
        if not str(self.initial_data.get("reason", "")).strip():
            raise serializers.ValidationError({"reason": "El motivo es obligatorio."})
        return attrs

    def validate_title(self, value):
        title = value.strip()
        normalized = " ".join(re.sub(r"[^a-z0-9]+", " ", unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode().lower()).split())
        queryset = JobRole.objects.exclude(id=self.instance.id) if self.instance else JobRole.objects.all()
        for role in queryset.only("title"):
            existing = " ".join(re.sub(r"[^a-z0-9]+", " ", unicodedata.normalize("NFKD", role.title).encode("ascii", "ignore").decode().lower()).split())
            if normalized == existing or SequenceMatcher(None, normalized, existing).ratio() >= 0.85:
                raise serializers.ValidationError(f'El cargo es igual o muy parecido a "{role.title}".')
        return title

    def update(self, instance, validated_data):
        validated_data.pop("reason")
        return super().update(instance, validated_data)


class LevelDeleteSerializer(serializers.Serializer):
    level = serializers.CharField(max_length=30)
    confirmation = serializers.CharField(max_length=30)
    confirmed = serializers.BooleanField()

    def validate(self, attrs):
        if not attrs["confirmed"] or attrs["confirmation"] != attrs["level"]:
            raise serializers.ValidationError("Escribe exactamente el nivel y confirma la eliminación.")
        return attrs


class RoleModuleAccessSerializer(serializers.Serializer):
    administration_enabled = serializers.BooleanField()
    permissions_enabled = serializers.BooleanField()
    reason = serializers.CharField(min_length=8, max_length=1000, trim_whitespace=True)

class PositionAdminSerializer(serializers.ModelSerializer):
    reason = serializers.CharField(write_only=True, min_length=8, max_length=1000)
    unit_name = serializers.CharField(source="unit.name", read_only=True)
    role_title = serializers.CharField(source="job_role.title", read_only=True)
    occupied = serializers.SerializerMethodField()
    is_protected = serializers.SerializerMethodField()

    class Meta:
        model = Position
        fields = ["id", "unit", "unit_name", "job_role", "role_title", "reports_to_position", "display_order", "is_open", "created_at", "occupied", "is_protected", "reason"]
        read_only_fields = ["id", "display_order", "created_at", "occupied", "is_protected"]

    def create(self, validated_data):
        validated_data.pop("reason")
        validated_data["display_order"] = (Position.objects.filter(unit=validated_data["unit"]).aggregate(Max("display_order"))["display_order__max"] or 0) + 1
        return super().create(validated_data)

    def validate(self, attrs):
        if not str(self.initial_data.get("reason", "")).strip():
            raise serializers.ValidationError({"reason": "El motivo es obligatorio."})
        return attrs

    def update(self, instance, validated_data):
        validated_data.pop("reason")
        return super().update(instance, validated_data)

    def get_occupied(self, position):
        return position.assignments.filter(is_active=True, released_at__isnull=True).exists()

    def get_is_protected(self, position):
        return position.assignments.filter(
            is_active=True,
            released_at__isnull=True,
            employee__user_account__is_superuser=True,
        ).exists()

    def validate_reports_to_position(self, reports_to):
        if self.instance and reports_to and reports_to.id == self.instance.id:
            raise serializers.ValidationError("Una plaza no puede reportarse a sí misma.")
        return reports_to


class AdministrativeReasonSerializer(serializers.Serializer):
    reason = serializers.CharField(min_length=8, max_length=1000)


class AssignmentCreateSerializer(serializers.Serializer):
    position = serializers.PrimaryKeyRelatedField(queryset=Position.objects.all())
    reason = serializers.CharField(min_length=8, max_length=1000)

    def validate_position(self, position):
        if not position.is_open:
            raise serializers.ValidationError("La plaza seleccionada está cerrada.")
        if PositionAssignment.objects.filter(position=position, is_active=True, released_at__isnull=True).exists():
            raise serializers.ValidationError("La plaza seleccionada ya está ocupada.")
        return position


class AssignmentReleaseSerializer(serializers.Serializer):
    assignment = serializers.PrimaryKeyRelatedField(
        queryset=PositionAssignment.objects.filter(is_active=True, released_at__isnull=True)
    )
    reason = serializers.CharField(min_length=8, max_length=1000)


class OffboardingExecuteSerializer(AdministrativeReasonSerializer):
    default_target_assignment = serializers.PrimaryKeyRelatedField(
        queryset=PositionAssignment.objects.filter(is_active=True, released_at__isnull=True),
        required=False,
        allow_null=True,
    )
    allow_unassigned = serializers.BooleanField(default=False)
    transfers = serializers.ListField(child=serializers.DictField(), required=False, default=list)

    def validate_transfers(self, rows):
        normalized = []
        for row in rows:
            missing = {key for key in ("module", "resource_type", "resource_id", "target_assignment") if not row.get(key)}
            if missing:
                raise serializers.ValidationError(f"Transferencia incompleta; faltan: {', '.join(sorted(missing))}.")
            try:
                target = PositionAssignment.objects.get(id=row["target_assignment"], is_active=True, released_at__isnull=True)
            except (PositionAssignment.DoesNotExist, ValueError, TypeError) as error:
                raise serializers.ValidationError("Una asignación destino no existe o no está activa.") from error
            normalized.append({
                "module": str(row["module"]),
                "resource_type": str(row["resource_type"]),
                "resource_id": str(row["resource_id"]),
                "target_assignment": target,
            })
        return normalized


class AdminSessionSerializer(serializers.ModelSerializer):
    account_email = serializers.EmailField(source="user_account.email", read_only=True)
    employee_name = serializers.CharField(source="user_account.employee.full_name", read_only=True)

    class Meta:
        model = AuthSession
        fields = [
            "id", "account_email", "employee_name", "client_type", "device_name", "user_agent",
            "created_ip", "last_ip", "created_at", "last_used_at", "expires_at", "mfa_verified_at",
            "auth_strength", "revoked_at", "revocation_reason",
        ]


class AdministrativeActionSerializer(serializers.ModelSerializer):
    actor_email = serializers.EmailField(source="actor_account.email", read_only=True)
    target_employee_name = serializers.CharField(source="target_employee.full_name", read_only=True)
    target_account_email = serializers.EmailField(source="target_account.email", read_only=True)

    class Meta:
        model = AdministrativeAction
        fields = "__all__"


class ResponsibilityTransferSerializer(serializers.ModelSerializer):
    class Meta:
        model = ResponsibilityTransfer
        fields = "__all__"


class OffboardingCaseSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source="employee.full_name", read_only=True)
    initiated_by_email = serializers.EmailField(source="initiated_by_account.email", read_only=True)
    transfers = ResponsibilityTransferSerializer(many=True, read_only=True)

    class Meta:
        model = OffboardingCase
        fields = "__all__"


class SystemAuditEventSerializer(serializers.ModelSerializer):
    actor_email = serializers.EmailField(source="actor_account.email", read_only=True)
    unit_name = serializers.CharField(source="organizational_unit.name", read_only=True)

    class Meta:
        model = SystemAuditEvent
        fields = [
            "id", "module_code", "event_type", "actor_email", "organizational_unit", "unit_name",
            "target_type", "target_id", "outcome", "changes", "metadata", "ip_address",
            "correlation_id", "occurred_at",
        ]
