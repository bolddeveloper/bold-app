from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from .authorization import check_and_log
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
from .serializers import (
    AccessGrantSerializer,
    AssignmentDirectorySerializer,
    AuthorizationCheckSerializer,
    EmployeeSerializer,
    GrantAuthorityPermissionSerializer,
    GrantAuthoritySerializer,
    JobRolePermissionSerializer,
    JobRoleSerializer,
    OrganizationalUnitSerializer,
    PermissionAuditLogSerializer,
    PermissionSerializer,
    PositionAssignmentSerializer,
    PositionSerializer,
    UserAccountSerializer,
)


# Define los viewsets del nucleo organizacional.
class OrganizationalUnitViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = OrganizationalUnit.objects.all()
    serializer_class = OrganizationalUnitSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        parent_id = self.request.query_params.get("parent_unit")
        if parent_id:
            queryset = queryset.filter(parent_unit_id=parent_id)
        return queryset


class JobRoleViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = JobRole.objects.all()
    serializer_class = JobRoleSerializer


class PositionViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Position.objects.all()
    serializer_class = PositionSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        unit_id = self.request.query_params.get("unit")
        if unit_id:
            queryset = queryset.filter(unit_id=unit_id)
        return queryset


class EmployeeViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Employee.objects.all()
    serializer_class = EmployeeSerializer

    def get_queryset(self):
        if self.request.user.is_superuser:
            return super().get_queryset()
        return super().get_queryset().filter(id=self.request.user.employee_id)


class UserAccountViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = UserAccount.objects.select_related("employee").all()
    serializer_class = UserAccountSerializer

    def get_queryset(self):
        if self.request.user.is_superuser:
            return super().get_queryset()
        return super().get_queryset().filter(id=self.request.user.id)


class PositionAssignmentViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = PositionAssignment.objects.all()
    serializer_class = PositionAssignmentSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        if not self.request.user.is_superuser:
            queryset = queryset.filter(employee_id=self.request.user.employee_id)
        employee_id = self.request.query_params.get("employee")
        if employee_id:
            queryset = queryset.filter(employee_id=employee_id)
        return queryset

    @action(detail=False, methods=["get"])
    def directory(self, request):
        queryset = PositionAssignment.objects.filter(
            is_active=True,
            released_at__isnull=True,
            employee__is_active=True,
            employee__user_account__is_active=True,
        ).select_related("employee__user_account", "position__unit", "position__job_role")
        page = self.paginate_queryset(queryset)
        serializer = AssignmentDirectorySerializer(page, many=True)
        return self.get_paginated_response(serializer.data)


# Define los viewsets de permisos base.
class PermissionViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Permission.objects.filter(is_active=True)
    serializer_class = PermissionSerializer


class JobRolePermissionViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = JobRolePermission.objects.filter(permission__is_active=True)
    serializer_class = JobRolePermissionSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        if not self.request.user.is_superuser:
            queryset = queryset.filter(
                job_role__positions__assignments__employee_id=self.request.user.employee_id,
                job_role__positions__assignments__is_active=True,
                job_role__positions__assignments__released_at__isnull=True,
            ).distinct()
        job_role_id = self.request.query_params.get("job_role")
        if job_role_id:
            queryset = queryset.filter(job_role_id=job_role_id)
        return queryset


# Define los viewsets de accesos especiales, delegacion y auditoria.
class AccessGrantViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = AccessGrant.objects.all()
    serializer_class = AccessGrantSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        if not self.request.user.is_superuser:
            queryset = queryset.filter(grantee_assignment__employee_id=self.request.user.employee_id)
        assignment_id = self.request.query_params.get("grantee_assignment")
        if assignment_id:
            queryset = queryset.filter(grantee_assignment_id=assignment_id)
        return queryset


class GrantAuthorityViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = GrantAuthority.objects.all()
    serializer_class = GrantAuthoritySerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        if not self.request.user.is_superuser:
            queryset = queryset.filter(assignment__employee_id=self.request.user.employee_id)
        assignment_id = self.request.query_params.get("assignment")
        if assignment_id:
            queryset = queryset.filter(assignment_id=assignment_id)
        return queryset


class GrantAuthorityPermissionViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = GrantAuthorityPermission.objects.all()
    serializer_class = GrantAuthorityPermissionSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        if not self.request.user.is_superuser:
            queryset = queryset.filter(grant_authority__assignment__employee_id=self.request.user.employee_id)
        return queryset


# Define el viewset de solo lectura del log de auditoria de permisos,
# filtrable por empleado via ?employee=<id>.
class PermissionAuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = PermissionAuditLog.objects.all()
    serializer_class = PermissionAuditLogSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        if not self.request.user.is_superuser:
            queryset = queryset.filter(employee_id=self.request.user.employee_id)
        employee_id = self.request.query_params.get("employee")
        if employee_id:
            queryset = queryset.filter(employee_id=employee_id)
        return queryset


# Define el punto de integracion que el resto de modulos del ecosistema
# (incluida la futura version reescrita de tareas) usaran para preguntarle
# al nucleo si un empleado puede realizar una accion, sin duplicar la logica
# de resolucion de permisos de boldApp/core/authorization.py. Cada llamada
# queda registrada en PermissionAuditLog.
class AuthorizationCheckView(APIView):

    def post(self, request):
        serializer = AuthorizationCheckSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)

        try:
            result = check_and_log(**serializer.validated_data, request=request)
        except Permission.DoesNotExist:
            return Response(
                {"detail": f"Permiso desconocido: {serializer.validated_data['permission_code']}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(
            {
                "allowed": result.allowed,
                "reason": result.reason,
                "reason_code": result.reason_code,
                "matched_rule_type": result.matched_rule_type,
                "matched_rule_id": result.matched_rule_id,
                "policy_version": result.policy_version,
                "policy_revision": result.policy_version,
                "audit_log_id": result.audit_log_id,
            },
            status=status.HTTP_200_OK,
        )
