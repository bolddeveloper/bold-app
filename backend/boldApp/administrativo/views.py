from datetime import timedelta

from django.conf import settings
from django.db.models.deletion import ProtectedError
from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from boldApp.autenticacion.models import AuthChallenge, AuthEvent, AuthSession
from boldApp.autenticacion.services import create_challenge, revoke_all_sessions, revoke_session, send_account_invitation, send_password_reset
from boldApp.core.models import Employee, JobRole, OrganizationalUnit, PermissionAuditLog, Position, PositionAssignment, UserAccount

from .models import AdministrativeAction, OffboardingCase, OrganizationCatalogOption, SystemAuditEvent
from .permissions import HasRecentOwnerMFA, IsCompanyOwner
from .registry import administrative_modules
from .serializers import (
    AdminEmployeeCreateSerializer,
    AdminEmployeeSerializer,
    AdminEmployeeUpdateSerializer,
    AdminSessionSerializer,
    AdministrativeActionSerializer,
    AdministrativeReasonSerializer,
    AssignmentCreateSerializer,
    OffboardingCaseSerializer,
    OffboardingExecuteSerializer,
    JobRoleAdminSerializer,
    LevelDeleteSerializer,
    OrganizationalUnitAdminSerializer,
    OrganizationCatalogOptionSerializer,
    PositionAdminSerializer,
    SystemAuditEventSerializer,
)
from .services import complete_administrative_action, create_administrative_action, fail_administrative_action, record_system_event


SENSITIVE_EMPLOYEE_ACTIONS = {"revoke_sessions", "reset_mfa", "send_password_reset", "deactivate_account", "reactivate_account", "offboard"}


def _active_assignments(employee):
    return employee.position_assignments.filter(is_active=True, released_at__isnull=True).select_related("position__unit", "position__job_role")


def _responsibility_snapshot(employee):
    modules = [provider.offboarding_preview(employee) for provider in administrative_modules.providers()]
    return {
        "employee_id": str(employee.id),
        "captured_at": timezone.now().isoformat(),
        "active_assignments": [
            {"id": str(row.id), "unit_id": str(row.position.unit_id), "unit_name": row.position.unit.name, "role": row.position.job_role.title}
            for row in _active_assignments(employee)
        ],
        "active_sessions": AuthSession.objects.filter(user_account__employee=employee, revoked_at__isnull=True).count(),
        "modules": modules,
    }


class DashboardView(APIView):
    permission_classes = [IsCompanyOwner]

    def get(self, request):
        now = timezone.now()
        modules = []
        activity = []
        for provider in administrative_modules.providers():
            modules.append(provider.dashboard(request))
            activity.extend(provider.activity(request, limit=10))
        activity.sort(key=lambda item: item["occurred_at"], reverse=True)
        accounts = UserAccount.objects.all()
        return Response({
            "generated_at": now,
            "organization": {
                "employees_total": Employee.objects.count(),
                "employees_active": Employee.objects.filter(is_active=True).count(),
                "accounts_active": accounts.filter(is_active=True).count(),
                "accounts_inactive": accounts.filter(is_active=False).count(),
                "accounts_pending_invitation": sum(1 for account in accounts.only("password") if not account.has_usable_password()),
                "organizational_units": OrganizationalUnit.objects.count(),
                "active_assignments": PositionAssignment.objects.filter(is_active=True, released_at__isnull=True).count(),
            },
            "security": {
                "active_sessions": AuthSession.objects.filter(revoked_at__isnull=True, expires_at__gt=now).count(),
                "mfa_enabled_accounts": accounts.filter(mfa_methods__is_active=True).distinct().count(),
                "failed_logins_24h": AuthEvent.objects.filter(event_type__in=["login.password_failed", "login.mfa_failed"], occurred_at__gte=now - timedelta(hours=24)).count(),
                "password_resets_24h": AuthEvent.objects.filter(event_type="password.reset_completed", occurred_at__gte=now - timedelta(hours=24)).count(),
            },
            "modules": modules,
            "recent_activity": activity[:20],
        })


class AdminEmployeeViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsCompanyOwner]
    serializer_class = AdminEmployeeSerializer
    queryset = Employee.objects.select_related("user_account").prefetch_related(
        "user_account__mfa_methods", "user_account__auth_sessions", "position_assignments__position__unit", "position_assignments__position__job_role"
    )

    def get_permissions(self):
        permission = HasRecentOwnerMFA if self.action in SENSITIVE_EMPLOYEE_ACTIONS else IsCompanyOwner
        return [permission()]

    def get_queryset(self):
        queryset = super().get_queryset()
        query = self.request.query_params.get("search", "").strip()
        if query:
            queryset = queryset.filter(Q(full_name__icontains=query) | Q(user_account__email__icontains=query))
        active = self.request.query_params.get("active")
        if active in {"true", "false"}:
            queryset = queryset.filter(is_active=active == "true")
        unit = self.request.query_params.get("unit")
        if unit:
            queryset = queryset.filter(position_assignments__position__unit_id=unit, position_assignments__is_active=True).distinct()
        return queryset

    def create(self, request, *args, **kwargs):
        serializer = AdminEmployeeCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        with transaction.atomic():
            employee = Employee.objects.create(full_name=data["full_name"].strip())
            account = UserAccount.objects.create_user(email=data["email"], employee=employee, password=None, is_active=True)
            if data.get("position"):
                PositionAssignment.objects.create(employee=employee, position=data["position"])
            raw, _ = create_challenge(account, AuthChallenge.PURPOSE_INVITATION, request, ttl=getattr(settings, "AUTH_INVITATION_TTL_SECONDS", 259200))
            transaction.on_commit(lambda: send_account_invitation(account, raw))
            admin_action = create_administrative_action(request, "employee_created", "Creación e invitación de empleado", employee, account)
            complete_administrative_action(admin_action, request, changes={"employee": {"after": {"full_name": employee.full_name, "email": account.email}}})
        return Response(AdminEmployeeSerializer(employee).data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, *args, **kwargs):
        employee = self.get_object()
        serializer = AdminEmployeeUpdateSerializer(employee, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        before = {"full_name": employee.full_name}
        serializer.save()
        admin_action = create_administrative_action(request, "employee_updated", str(request.data.get("reason") or "Actualización de datos del empleado"), employee, getattr(employee, "user_account", None))
        complete_administrative_action(admin_action, request, changes={"before": before, "after": {"full_name": employee.full_name}})
        return Response(AdminEmployeeSerializer(employee).data)

    @action(detail=True, methods=["post"], url_path="resend-invitation")
    def resend_invitation(self, request, pk=None):
        employee = self.get_object()
        account = getattr(employee, "user_account", None)
        if not account:
            return Response({"detail": "El empleado no tiene cuenta."}, status=status.HTTP_400_BAD_REQUEST)
        raw, _ = create_challenge(account, AuthChallenge.PURPOSE_INVITATION, request, ttl=getattr(settings, "AUTH_INVITATION_TTL_SECONDS", 259200))
        send_account_invitation(account, raw)
        admin_action = create_administrative_action(request, "invitation_resent", "Reenvío de invitación", employee, account)
        complete_administrative_action(admin_action, request)
        return Response({"detail": "Invitación enviada."})

    @action(detail=True, methods=["post"], url_path="assign-position")
    def assign_position(self, request, pk=None):
        employee = self.get_object()
        serializer = AssignmentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        assignment = PositionAssignment.objects.create(employee=employee, position=serializer.validated_data["position"])
        admin_action = create_administrative_action(request, "position_assigned", serializer.validated_data["reason"], employee, getattr(employee, "user_account", None), {"assignment_id": str(assignment.id)})
        complete_administrative_action(admin_action, request, metadata={"assignment_id": str(assignment.id)})
        return Response(AdminEmployeeSerializer(employee).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"], url_path="sessions")
    def sessions(self, request, pk=None):
        employee = self.get_object()
        rows = AuthSession.objects.filter(user_account__employee=employee).select_related("user_account__employee")[:100]
        return Response(AdminSessionSerializer(rows, many=True).data)

    @action(detail=True, methods=["post"], url_path="revoke-sessions")
    def revoke_sessions(self, request, pk=None):
        employee = self.get_object()
        account = getattr(employee, "user_account", None)
        serializer = AdministrativeReasonSerializer(data=request.data); serializer.is_valid(raise_exception=True)
        if not account:
            return Response({"detail": "El empleado no tiene cuenta."}, status=status.HTTP_400_BAD_REQUEST)
        admin_action = create_administrative_action(request, "sessions_revoked", serializer.validated_data["reason"], employee, account)
        count = revoke_all_sessions(account, "administrative_revocation", request.user)
        complete_administrative_action(admin_action, request, metadata={"revoked_sessions": count})
        return Response({"detail": "Sesiones revocadas.", "revoked_sessions": count})

    @action(detail=True, methods=["post"], url_path="reset-mfa")
    def reset_mfa(self, request, pk=None):
        employee = self.get_object()
        account = getattr(employee, "user_account", None)
        serializer = AdministrativeReasonSerializer(data=request.data); serializer.is_valid(raise_exception=True)
        if not account:
            return Response({"detail": "El empleado no tiene cuenta."}, status=status.HTTP_400_BAD_REQUEST)
        if request.user.id == account.id:
            return Response({"detail": "El dueño debe gestionar su propio MFA desde el menú de seguridad."}, status=status.HTTP_400_BAD_REQUEST)
        admin_action = create_administrative_action(request, "mfa_reset", serializer.validated_data["reason"], employee, account)
        now = timezone.now()
        disabled = account.mfa_methods.filter(is_active=True).update(is_active=False, is_primary=False, disabled_at=now, disabled_by_account=request.user)
        account.recovery_codes.filter(used_at__isnull=True).delete()
        account.credentials_version += 1
        account.save(update_fields=["credentials_version", "updated_at"])
        revoked = revoke_all_sessions(account, "administrative_mfa_reset", request.user)
        complete_administrative_action(admin_action, request, metadata={"disabled_methods": disabled, "revoked_sessions": revoked})
        return Response({"detail": "MFA restablecido; la cuenta deberá configurarlo nuevamente.", "disabled_methods": disabled})

    @action(detail=True, methods=["post"], url_path="send-password-reset")
    def send_password_reset(self, request, pk=None):
        employee = self.get_object()
        account = getattr(employee, "user_account", None)
        serializer = AdministrativeReasonSerializer(data=request.data); serializer.is_valid(raise_exception=True)
        if not account:
            return Response({"detail": "El empleado no tiene cuenta."}, status=status.HTTP_400_BAD_REQUEST)
        raw, _ = create_challenge(account, AuthChallenge.PURPOSE_PASSWORD_RESET, request)
        send_password_reset(account, raw)
        admin_action = create_administrative_action(request, "password_reset_sent", serializer.validated_data["reason"], employee, account)
        complete_administrative_action(admin_action, request)
        return Response({"detail": "Recuperación de contraseña enviada al correo corporativo."})

    @action(detail=True, methods=["post"], url_path="deactivate-account")
    def deactivate_account(self, request, pk=None):
        employee = self.get_object()
        account = getattr(employee, "user_account", None)
        serializer = AdministrativeReasonSerializer(data=request.data); serializer.is_valid(raise_exception=True)
        if not account:
            return Response({"detail": "El empleado no tiene cuenta."}, status=status.HTTP_400_BAD_REQUEST)
        if account.id == request.user.id:
            return Response({"detail": "El dueño no puede desactivar su propia cuenta."}, status=status.HTTP_400_BAD_REQUEST)
        admin_action = create_administrative_action(request, "account_deactivated", serializer.validated_data["reason"], employee, account)
        account.is_active = False
        account.deactivated_at = timezone.now()
        account.credentials_version += 1
        account.save(update_fields=["is_active", "deactivated_at", "credentials_version", "updated_at"])
        revoked = revoke_all_sessions(account, "account_deactivated", request.user)
        complete_administrative_action(admin_action, request, changes={"is_active": {"before": True, "after": False}}, metadata={"revoked_sessions": revoked})
        return Response(AdminEmployeeSerializer(employee).data)

    @action(detail=True, methods=["post"], url_path="reactivate-account")
    def reactivate_account(self, request, pk=None):
        employee = self.get_object()
        account = getattr(employee, "user_account", None)
        serializer = AdministrativeReasonSerializer(data=request.data); serializer.is_valid(raise_exception=True)
        if not account:
            return Response({"detail": "El empleado no tiene cuenta."}, status=status.HTTP_400_BAD_REQUEST)
        account.is_active = True
        account.deactivated_at = None
        account.save(update_fields=["is_active", "deactivated_at", "updated_at"])
        admin_action = create_administrative_action(request, "account_reactivated", serializer.validated_data["reason"], employee, account)
        complete_administrative_action(admin_action, request, changes={"is_active": {"before": False, "after": True}})
        return Response(AdminEmployeeSerializer(employee).data)

    @action(detail=True, methods=["get"], url_path="offboarding-preview")
    def offboarding_preview(self, request, pk=None):
        return Response(_responsibility_snapshot(self.get_object()))

    @action(detail=True, methods=["post"], url_path="offboard")
    def offboard(self, request, pk=None):
        employee = self.get_object()
        account = getattr(employee, "user_account", None)
        serializer = OffboardingExecuteSerializer(data=request.data); serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if account and account.id == request.user.id:
            return Response({"detail": "El dueño no puede ejecutar su propia baja."}, status=status.HTTP_400_BAD_REQUEST)
        targets = [row["target_assignment"] for row in data["transfers"]]
        if data.get("default_target_assignment"):
            targets.append(data["default_target_assignment"])
        if any(target.employee_id == employee.id for target in targets):
            return Response({"detail": "Una responsabilidad no puede transferirse al mismo empleado dado de baja."}, status=status.HTTP_400_BAD_REQUEST)
        snapshot = _responsibility_snapshot(employee)
        required = [resource for module in snapshot["modules"] for resource in module["resources"] if resource.get("required")]
        if required and not (data.get("default_target_assignment") or data["transfers"]):
            return Response({"detail": "Hay responsabilidades obligatorias que requieren un reemplazo."}, status=status.HTTP_400_BAD_REQUEST)

        admin_action = create_administrative_action(request, "employee_offboarded", data["reason"], employee, account, {"snapshot": snapshot})
        try:
            with transaction.atomic():
                case = OffboardingCase.objects.create(employee=employee, initiated_by_account=request.user, administrative_action=admin_action, status=OffboardingCase.STATUS_READY, reason=data["reason"], effective_at=timezone.now(), responsibility_snapshot=snapshot)
                mapping = {(row["module"], row["resource_type"], row["resource_id"]): row["target_assignment"] for row in data["transfers"]}
                for provider in administrative_modules.providers():
                    provider.transfer_offboarding(case, employee, mapping, data.get("default_target_assignment"), data["allow_unassigned"])
                now = timezone.now()
                for assignment in _active_assignments(employee).select_for_update():
                    assignment.is_active = False
                    assignment.released_at = now
                    assignment.save(update_fields=["is_active", "released_at"])
                employee.is_active = False
                employee.save(update_fields=["is_active", "updated_at"])
                if account:
                    account.is_active = False; account.deactivated_at = now; account.credentials_version += 1
                    account.save(update_fields=["is_active", "deactivated_at", "credentials_version", "updated_at"])
                    revoke_all_sessions(account, "employee_offboarded", request.user)
                case.status = OffboardingCase.STATUS_COMPLETED; case.completed_at = now
                case.save(update_fields=["status", "completed_at"])
                complete_administrative_action(admin_action, request, changes={"employee_active": {"before": True, "after": False}}, metadata={"offboarding_case": str(case.id), "transfers": case.transfers.count()})
            return Response(OffboardingCaseSerializer(case).data, status=status.HTTP_201_CREATED)
        except ValueError as error:
            fail_administrative_action(admin_action, request, "transfer_validation_failed", {"detail": str(error)})
            return Response({"detail": str(error)}, status=status.HTTP_400_BAD_REQUEST)


class AdminSessionViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsCompanyOwner]
    serializer_class = AdminSessionSerializer
    queryset = AuthSession.objects.select_related("user_account__employee").all()

    def get_queryset(self):
        queryset = super().get_queryset()
        employee = self.request.query_params.get("employee")
        return queryset.filter(user_account__employee_id=employee) if employee else queryset

    def destroy(self, request, *args, **kwargs):
        if not HasRecentOwnerMFA().has_permission(request, self):
            return Response({"detail": HasRecentOwnerMFA.message}, status=status.HTTP_403_FORBIDDEN)
        session = self.get_object()
        serializer = AdministrativeReasonSerializer(data=request.data); serializer.is_valid(raise_exception=True)
        admin_action = create_administrative_action(request, "session_revoked", serializer.validated_data["reason"], session.user_account.employee, session.user_account, {"session_id": str(session.id)})
        revoke_session(session, "administrative_revocation", request.user)
        complete_administrative_action(admin_action, request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class AuditEventListView(APIView):
    permission_classes = [IsCompanyOwner]

    def get(self, request):
        module = request.query_params.get("module", "").strip()
        event_type = request.query_params.get("event_type", "").strip()
        outcome = request.query_params.get("outcome", "").strip()
        search = request.query_params.get("search", "").strip().lower()
        date_from = parse_date(request.query_params.get("date_from", ""))
        date_to = parse_date(request.query_params.get("date_to", ""))
        events = []

        if not module or module == "administration":
            queryset = SystemAuditEvent.objects.select_related("actor_account", "organizational_unit")
            if event_type: queryset = queryset.filter(event_type__icontains=event_type)
            if outcome: queryset = queryset.filter(outcome=outcome)
            events.extend(SystemAuditEventSerializer(queryset[:500], many=True).data)

        if not module or module == "authentication":
            queryset = AuthEvent.objects.select_related("actor_account", "user_account")
            if event_type: queryset = queryset.filter(event_type__icontains=event_type)
            if outcome == "success": queryset = queryset.filter(success=True)
            if outcome in {"failure", "denied"}: queryset = queryset.filter(success=False)
            events.extend({
                "id": str(row.id), "module_code": "authentication", "event_type": row.event_type,
                "actor_email": row.actor_account.email if row.actor_account else "",
                "target_type": "user_account", "target_id": str(row.user_account_id) if row.user_account_id else None,
                "outcome": "success" if row.success else "failure", "changes": {}, "metadata": row.metadata,
                "ip_address": row.ip_address, "correlation_id": str(row.correlation_id), "occurred_at": row.occurred_at,
            } for row in queryset[:500])

        if not module or module == "permissions":
            queryset = PermissionAuditLog.objects.select_related("employee", "permission", "target_unit")
            if event_type: queryset = queryset.filter(permission__code__icontains=event_type)
            events.extend({
                "id": str(row.id), "module_code": "permissions", "event_type": "permission.checked",
                "actor_email": getattr(getattr(row.employee, "user_account", None), "email", ""),
                "target_type": row.permission.code, "target_id": str(row.resource_id) if row.resource_id else None,
                "outcome": "success" if row.decision == "allow" else "denied", "changes": {},
                "metadata": {"reason": row.reason, "unit": row.target_unit.name}, "ip_address": None,
                "correlation_id": None, "occurred_at": row.created_at,
            } for row in queryset[:500])

        for provider in administrative_modules.providers():
            if (not module or module == provider.code) and hasattr(provider, "audit_events"):
                events.extend(provider.audit_events(request, limit=500))

        if search:
            events = [item for item in events if search in " ".join(str(item.get(key) or "") for key in ("event_type", "actor_email", "target_type", "metadata")).lower()]
        if date_from or date_to:
            def within_range(item):
                occurred_at = item.get("occurred_at")
                if isinstance(occurred_at, str):
                    occurred_at = parse_datetime(occurred_at)
                if not occurred_at:
                    return False
                local_day = timezone.localtime(occurred_at).date() if timezone.is_aware(occurred_at) else occurred_at.date()
                return (not date_from or local_day >= date_from) and (not date_to or local_day <= date_to)
            events = [item for item in events if within_range(item)]
        events.sort(key=lambda item: str(item["occurred_at"]), reverse=True)
        paginator = PageNumberPagination(); paginator.page_size = 50
        page = paginator.paginate_queryset(events, request, view=self)
        return paginator.get_paginated_response(page)


class OrganizationOverviewView(APIView):
    permission_classes = [IsCompanyOwner]

    def get(self, request):
        for value in OrganizationalUnit.objects.values_list("unit_type", flat=True).distinct():
            OrganizationCatalogOption.objects.get_or_create(kind=OrganizationCatalogOption.UNIT_TYPE, value=value)
        for value in OrganizationalUnit.objects.values_list("sensitivity_level", flat=True).distinct():
            OrganizationCatalogOption.objects.get_or_create(kind=OrganizationCatalogOption.SENSITIVITY, value=value)
        positions = []
        for row in Position.objects.select_related("unit", "job_role").prefetch_related("assignments__employee"):
            active_assignment = next((assignment for assignment in row.assignments.all() if assignment.is_active and assignment.released_at is None), None)
            positions.append({
                "id": row.id, "unit": row.unit_id, "unit_name": row.unit.name,
                "job_role": row.job_role_id, "role_title": row.job_role.title,
                "display_order": row.display_order, "is_open": row.is_open,
                "occupied": active_assignment is not None,
                "occupant_name": active_assignment.employee.full_name if active_assignment else None,
            })
        return Response({
            "units": [{"id": row.id, "name": row.name, "unit_type": row.unit_type, "parent_unit": row.parent_unit_id, "sensitivity_level": row.sensitivity_level, "positions": row.positions.count()} for row in OrganizationalUnit.objects.prefetch_related("positions")],
            "roles": [{"id": row.id, "title": row.title, "level": row.level, "description": row.description} for row in JobRole.objects.all()],
            "positions": positions,
            "unit_types": OrganizationCatalogOptionSerializer(OrganizationCatalogOption.objects.filter(kind=OrganizationCatalogOption.UNIT_TYPE), many=True).data,
            "sensitivity_levels": OrganizationCatalogOptionSerializer(OrganizationCatalogOption.objects.filter(kind=OrganizationCatalogOption.SENSITIVITY), many=True).data,
        })


class OrganizationCatalogViewSet(
    mixins.CreateModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    mixins.ListModelMixin,
    viewsets.GenericViewSet,
):
    permission_classes = [IsCompanyOwner]
    audit_target_type = "organization_record"

    def perform_create(self, serializer):
        instance = serializer.save()
        record_system_event(
            f"administration.{self.audit_target_type}_created",
            self.request,
            target_type=self.audit_target_type,
            target_id=instance.id,
            metadata={"reason": self.request.data.get("reason", "")},
        )

    def perform_update(self, serializer):
        changed_fields = [field for field in serializer.validated_data if field != "reason"]
        before = {field: str(getattr(serializer.instance, field, "")) for field in changed_fields}
        instance = serializer.save()
        after = {field: str(getattr(instance, field, "")) for field in changed_fields}
        record_system_event(
            f"administration.{self.audit_target_type}_updated",
            self.request,
            target_type=self.audit_target_type,
            target_id=instance.id,
            changes={"before": before, "after": after},
            metadata={"reason": self.request.data.get("reason", "")},
        )


class OrganizationalUnitAdminViewSet(mixins.DestroyModelMixin, OrganizationCatalogViewSet):
    serializer_class = OrganizationalUnitAdminSerializer
    queryset = OrganizationalUnit.objects.select_related("parent_unit")
    audit_target_type = "organizational_unit"

    def get_permissions(self):
        permission = HasRecentOwnerMFA if self.action in {"update", "partial_update", "destroy"} else IsCompanyOwner
        return [permission()]

    def destroy(self, request, *args, **kwargs):
        reason_serializer = AdministrativeReasonSerializer(data=request.data)
        reason_serializer.is_valid(raise_exception=True)
        unit = self.get_object()
        name, unit_id = unit.name, unit.id
        try:
            unit.delete()
        except ProtectedError:
            return Response({"detail": "No se puede eliminar la unidad porque tiene plazas, subunidades u otros datos asociados."}, status=status.HTTP_400_BAD_REQUEST)
        record_system_event("administration.organizational_unit_deleted", request, target_type="organizational_unit", target_id=unit_id, metadata={"name": name, "reason": reason_serializer.validated_data["reason"]})
        return Response(status=status.HTTP_204_NO_CONTENT)


class OrganizationCatalogOptionViewSet(viewsets.ModelViewSet):
    permission_classes = [IsCompanyOwner]
    serializer_class = OrganizationCatalogOptionSerializer
    queryset = OrganizationCatalogOption.objects.all()

    def perform_update(self, serializer):
        old, option = serializer.instance.value, serializer.save()
        field = "unit_type" if option.kind == OrganizationCatalogOption.UNIT_TYPE else "sensitivity_level"
        OrganizationalUnit.objects.filter(**{field: old}).update(**{field: option.value})

    def destroy(self, request, *args, **kwargs):
        option = self.get_object()
        field = "unit_type" if option.kind == OrganizationCatalogOption.UNIT_TYPE else "sensitivity_level"
        if OrganizationalUnit.objects.filter(**{field: option.value}).exists():
            return Response({"detail": "No se puede eliminar porque hay unidades que usan esta opción."}, status=status.HTTP_400_BAD_REQUEST)
        return super().destroy(request, *args, **kwargs)


class JobRoleAdminViewSet(mixins.DestroyModelMixin, OrganizationCatalogViewSet):
    serializer_class = JobRoleAdminSerializer
    queryset = JobRole.objects.all()
    audit_target_type = "job_role"

    def get_permissions(self):
        permission = HasRecentOwnerMFA if self.action in {"update", "partial_update", "destroy", "delete_level"} else IsCompanyOwner
        return [permission()]

    def destroy(self, request, *args, **kwargs):
        reason_serializer = AdministrativeReasonSerializer(data=request.data)
        reason_serializer.is_valid(raise_exception=True)
        role = self.get_object()
        title, role_id = role.title, role.id
        try:
            role.delete()
        except ProtectedError:
            return Response({"detail": "No se puede eliminar el cargo porque tiene plazas o permisos asociados."}, status=status.HTTP_400_BAD_REQUEST)
        record_system_event("administration.job_role_deleted", request, target_type="job_role", target_id=role_id, metadata={"title": title, "reason": reason_serializer.validated_data["reason"]})
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=["post"], url_path="delete-level")
    def delete_level(self, request):
        serializer = LevelDeleteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        level = serializer.validated_data["level"]
        updated = JobRole.objects.filter(level=level).update(level=None)
        record_system_event(
            "administration.job_role_level_deleted", request,
            target_type="job_role_level",
            metadata={"level": level, "roles_updated": updated},
        )
        return Response({"level": level, "roles_updated": updated})


class PositionAdminViewSet(OrganizationCatalogViewSet):
    serializer_class = PositionAdminSerializer
    queryset = Position.objects.select_related("unit", "job_role", "reports_to_position").prefetch_related("assignments")
    audit_target_type = "position"


class AdministrativeActionViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsCompanyOwner]
    serializer_class = AdministrativeActionSerializer
    queryset = AdministrativeAction.objects.select_related("actor_account", "target_employee", "target_account")


class OffboardingCaseViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsCompanyOwner]
    serializer_class = OffboardingCaseSerializer
    queryset = OffboardingCase.objects.select_related("employee", "initiated_by_account", "administrative_action").prefetch_related("transfers")
