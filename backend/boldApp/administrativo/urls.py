from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import AdministrativeActionViewSet, AdminEmployeeViewSet, AdminSessionViewSet, AuditEventListView, DashboardView, JobRoleAdminViewSet, OffboardingCaseViewSet, OrganizationalUnitAdminViewSet, OrganizationOverviewView, PositionAdminViewSet


router = DefaultRouter()
router.register(r"employees", AdminEmployeeViewSet, basename="administration-employee")
router.register(r"sessions", AdminSessionViewSet, basename="administration-session")
router.register(r"actions", AdministrativeActionViewSet, basename="administration-action")
router.register(r"offboarding-cases", OffboardingCaseViewSet, basename="administration-offboarding")
router.register(r"units", OrganizationalUnitAdminViewSet, basename="administration-unit")
router.register(r"roles", JobRoleAdminViewSet, basename="administration-role")
router.register(r"positions", PositionAdminViewSet, basename="administration-position")

urlpatterns = [
    path("dashboard/", DashboardView.as_view(), name="administration-dashboard"),
    path("audit-events/", AuditEventListView.as_view(), name="administration-audit-events"),
    path("organization/", OrganizationOverviewView.as_view(), name="administration-organization"),
] + router.urls
