from django.urls import path

from .views import (
    AccessRuleListCreateView,
    AccessRuleRevokeView,
    ControlPlaneAccessView,
    EffectiveAccessView,
    GrantAuthorityListCreateView,
    GrantAuthorityRevokeView,
    PermissionCatalogView,
    PolicyAuditView,
    PolicyRevisionView,
    RolePolicyView,
)


urlpatterns = [
    path("access/", ControlPlaneAccessView.as_view(), name="permissions-access"),
    path("revision/", PolicyRevisionView.as_view(), name="permissions-revision"),
    path("catalog/", PermissionCatalogView.as_view(), name="permissions-catalog"),
    path("role-policies/", RolePolicyView.as_view(), name="permissions-role-policies"),
    path("access-rules/", AccessRuleListCreateView.as_view(), name="permissions-access-rules"),
    path("access-rules/<uuid:grant_id>/revoke/", AccessRuleRevokeView.as_view(), name="permissions-access-rule-revoke"),
    path("authorities/", GrantAuthorityListCreateView.as_view(), name="permissions-authorities"),
    path("authorities/<uuid:authority_id>/revoke/", GrantAuthorityRevokeView.as_view(), name="permissions-authority-revoke"),
    path("effective/", EffectiveAccessView.as_view(), name="permissions-effective"),
    path("audit/", PolicyAuditView.as_view(), name="permissions-audit"),
]

