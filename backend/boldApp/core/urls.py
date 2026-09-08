from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    AccessGrantViewSet,
    AuthorizationCheckView,
    EmployeeViewSet,
    GrantAuthorityPermissionViewSet,
    GrantAuthorityViewSet,
    JobRolePermissionViewSet,
    JobRoleViewSet,
    OrganizationalUnitViewSet,
    PermissionAuditLogViewSet,
    PermissionViewSet,
    PositionAssignmentViewSet,
    PositionViewSet,
)


# Define el router de DRF con los 11 endpoints del modulo nucleo.
router = DefaultRouter()
router.register(r"organizational-units", OrganizationalUnitViewSet, basename="organizational-unit")
router.register(r"job-roles", JobRoleViewSet, basename="job-role")
router.register(r"positions", PositionViewSet, basename="position")
router.register(r"employees", EmployeeViewSet, basename="employee")
router.register(r"position-assignments", PositionAssignmentViewSet, basename="position-assignment")
router.register(r"permissions", PermissionViewSet, basename="permission")
router.register(r"job-role-permissions", JobRolePermissionViewSet, basename="job-role-permission")
router.register(r"access-grants", AccessGrantViewSet, basename="access-grant")
router.register(r"grant-authorities", GrantAuthorityViewSet, basename="grant-authority")
router.register(
    r"grant-authority-permissions",
    GrantAuthorityPermissionViewSet,
    basename="grant-authority-permission",
)
router.register(r"permission-audit-logs", PermissionAuditLogViewSet, basename="permission-audit-log")


# El endpoint de autorizacion va antes que el router: es el punto de
# integracion que consultan otros modulos, no un CRUD mas.
urlpatterns = [
    path("authorize/", AuthorizationCheckView.as_view(), name="core-authorize"),
] + router.urls
