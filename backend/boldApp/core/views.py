from rest_framework import status, viewsets
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
)
from .serializers import (
    AccessGrantSerializer,
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
)


# Define los viewsets del nucleo organizacional.
class OrganizationalUnitViewSet(viewsets.ModelViewSet):
    queryset = OrganizationalUnit.objects.all()
    serializer_class = OrganizationalUnitSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        parent_id = self.request.query_params.get("parent_unit")
        if parent_id:
            queryset = queryset.filter(parent_unit_id=parent_id)
        return queryset


class JobRoleViewSet(viewsets.ModelViewSet):
    queryset = JobRole.objects.all()
    serializer_class = JobRoleSerializer


class PositionViewSet(viewsets.ModelViewSet):
    queryset = Position.objects.all()
    serializer_class = PositionSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        unit_id = self.request.query_params.get("unit")
        if unit_id:
            queryset = queryset.filter(unit_id=unit_id)
        return queryset


class EmployeeViewSet(viewsets.ModelViewSet):
    queryset = Employee.objects.all()
    serializer_class = EmployeeSerializer


class PositionAssignmentViewSet(viewsets.ModelViewSet):
    queryset = PositionAssignment.objects.all()
    serializer_class = PositionAssignmentSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        employee_id = self.request.query_params.get("employee")
        if employee_id:
            queryset = queryset.filter(employee_id=employee_id)
        return queryset


# Define los viewsets de permisos base.
class PermissionViewSet(viewsets.ModelViewSet):
    queryset = Permission.objects.all()
    serializer_class = PermissionSerializer


class JobRolePermissionViewSet(viewsets.ModelViewSet):
    queryset = JobRolePermission.objects.all()
    serializer_class = JobRolePermissionSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        job_role_id = self.request.query_params.get("job_role")
        if job_role_id:
            queryset = queryset.filter(job_role_id=job_role_id)
        return queryset


# Define los viewsets de accesos especiales, delegacion y auditoria.
class AccessGrantViewSet(viewsets.ModelViewSet):
    queryset = AccessGrant.objects.all()
    serializer_class = AccessGrantSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        assignment_id = self.request.query_params.get("grantee_assignment")
        if assignment_id:
            queryset = queryset.filter(grantee_assignment_id=assignment_id)
        return queryset


class GrantAuthorityViewSet(viewsets.ModelViewSet):
    queryset = GrantAuthority.objects.all()
    serializer_class = GrantAuthoritySerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        assignment_id = self.request.query_params.get("assignment")
        if assignment_id:
            queryset = queryset.filter(assignment_id=assignment_id)
        return queryset


class GrantAuthorityPermissionViewSet(viewsets.ModelViewSet):
    queryset = GrantAuthorityPermission.objects.all()
    serializer_class = GrantAuthorityPermissionSerializer


# Define el viewset de solo lectura del log de auditoria de permisos,
# filtrable por empleado via ?employee=<id>.
class PermissionAuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = PermissionAuditLog.objects.all()
    serializer_class = PermissionAuditLogSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
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
        serializer = AuthorizationCheckSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            result = check_and_log(**serializer.validated_data)
        except Permission.DoesNotExist:
            return Response(
                {"detail": f"Permiso desconocido: {serializer.validated_data['permission_code']}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(
            {
                "allowed": result.allowed,
                "reason": result.reason,
                "audit_log_id": result.audit_log_id,
            },
            status=status.HTTP_200_OK,
        )
