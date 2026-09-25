from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import Q
from rest_framework import status
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from boldApp.core.authorization import apply_session_assurance, resolve_access
from boldApp.core.models import (
    AccessGrant,
    GrantAuthority,
    JobRole,
    JobRolePermission,
    Permission,
)

from .models import PermissionPolicyEvent, PermissionPolicyState
from .serializers import (
    AccessGrantDetailSerializer,
    AccessRuleCreateSerializer,
    EffectiveAccessQuerySerializer,
    GrantAuthorityCreateSerializer,
    GrantAuthorityDetailSerializer,
    JobRolePermissionDetailSerializer,
    PermissionCatalogSerializer,
    PermissionPolicyEventSerializer,
    RevokeSerializer,
    RolePolicyApplySerializer,
)
from .services import (
    control_plane_access,
    create_access_rule,
    create_grant_authority,
    get_request_assignment,
    record_denied_event,
    require_recent_strong_mfa,
    replace_role_policy,
    revoke_access_rule,
    revoke_grant_authority,
)


def _denied_audit(request, event_type, error, *, target_type="security", target_id=""):
    if isinstance(error, PermissionDenied) or (
        isinstance(error, APIException) and getattr(error, "status_code", None) == 403
    ):
        record_denied_event(
            request,
            event_type,
            getattr(error, "detail", str(error)),
            target_type=target_type,
            target_id=target_id,
        )


class ControlPlaneAccessView(APIView):
    def get(self, request):
        assignment = get_request_assignment(request)
        return Response(control_plane_access(request, assignment))


class PolicyRevisionView(APIView):
    def get(self, request):
        return Response({"revision": PermissionPolicyState.current_revision()})


class PermissionCatalogView(APIView):
    def get(self, request):
        rows = Permission.objects.filter(is_active=True).order_by("module_code", "resource", "action")
        return Response(PermissionCatalogSerializer(rows, many=True).data)


class RolePolicyView(APIView):
    def get(self, request):
        assignment = get_request_assignment(request)
        if request.user.is_superuser:
            roles = JobRole.objects.exclude(
                positions__assignments__employee__user_account__is_superuser=True
            ).distinct()
            rules = JobRolePermission.objects.select_related(
                "job_role", "permission", "target_unit", "created_by_account"
            ).filter(permission__is_active=True)
        else:
            roles = JobRole.objects.filter(pk=assignment.position.job_role_id)
            rules = JobRolePermission.objects.select_related(
                "job_role", "permission", "target_unit", "created_by_account"
            ).filter(job_role=assignment.position.job_role, permission__is_active=True)
        return Response({
            "revision": PermissionPolicyState.current_revision(),
            "roles": [
                {"id": str(role.id), "title": role.title, "level": role.level, "description": role.description}
                for role in roles
            ],
            "rules": JobRolePermissionDetailSerializer(rules, many=True).data,
        })

    def post(self, request):
        serializer = RolePolicyApplySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            rows, revision = replace_role_policy(
                request,
                role=data["job_role"],
                permission=data["permission"],
                rules=data["rules"],
                reason=data["reason"],
                expected_revision=data.get("expected_revision"),
            )
        except APIException as error:
            _denied_audit(request, "permissions.role_policy.denied", error, target_type="job_role", target_id=data["job_role"].id)
            raise
        return Response(
            {"revision": revision, "rules": JobRolePermissionDetailSerializer(rows, many=True).data},
            status=status.HTTP_200_OK,
        )


class AccessRuleListCreateView(APIView):
    def get(self, request):
        assignment = get_request_assignment(request)
        queryset = AccessGrant.objects.select_related(
            "permission",
            "target_unit",
            "grantee_assignment__employee__user_account",
            "grantee_assignment__position__unit",
            "created_by_account",
            "revoked_by_account",
            "source_authority__assignment__employee__user_account",
            "source_authority__assignment__position__unit",
            "source_authority__target_unit",
            "source_authority__parent_authority",
        ).prefetch_related("source_authority__scoped_permissions")
        if not request.user.is_superuser:
            queryset = queryset.filter(
                Q(grantee_assignment=assignment)
                | Q(granted_by_assignment=assignment)
            )
        return Response({
            "revision": PermissionPolicyState.current_revision(),
            "results": AccessGrantDetailSerializer(queryset, many=True).data,
        })

    def post(self, request):
        serializer = AccessRuleCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        # ``valid_from`` es opcional en el contrato. Si el cliente no lo
        # envía, el servicio fija el inicio con la hora confiable del servidor.
        data.setdefault("valid_from", None)
        try:
            grant, revision = create_access_rule(request, **data)
        except APIException as error:
            _denied_audit(
                request,
                "permissions.access_rule.denied",
                error,
                target_type="position_assignment",
                target_id=data["grantee_assignment"].id,
            )
            raise
        return Response(
            {"revision": revision, "grant": AccessGrantDetailSerializer(grant).data},
            status=status.HTTP_201_CREATED,
        )


class AccessRuleRevokeView(APIView):
    def post(self, request, grant_id):
        serializer = RevokeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        grant = AccessGrant.objects.filter(pk=grant_id).first()
        if not grant:
            return Response({"detail": "Acceso no encontrado."}, status=status.HTTP_404_NOT_FOUND)
        try:
            grant, revision = revoke_access_rule(request, grant=grant, **serializer.validated_data)
        except APIException as error:
            _denied_audit(request, "permissions.access_rule.revoke_denied", error, target_type="access_grant", target_id=grant_id)
            raise
        return Response({"revision": revision, "grant": AccessGrantDetailSerializer(grant).data})


class GrantAuthorityListCreateView(APIView):
    def get(self, request):
        assignment = get_request_assignment(request)
        queryset = GrantAuthority.objects.select_related(
            "assignment__employee__user_account",
            "assignment__position__unit",
            "target_unit",
            "created_by_account",
            "revoked_by_account",
            "parent_authority",
        ).prefetch_related("scoped_permissions__permission")
        if not request.user.is_superuser:
            queryset = queryset.filter(
                Q(assignment=assignment) | Q(granted_by_assignment=assignment)
            )
        return Response({
            "revision": PermissionPolicyState.current_revision(),
            "results": GrantAuthorityDetailSerializer(queryset, many=True).data,
        })

    def post(self, request):
        serializer = GrantAuthorityCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            authority, revision = create_grant_authority(
                request,
                grantee_assignment=data.pop("assignment"),
                **data,
            )
        except APIException as error:
            _denied_audit(request, "permissions.authority.denied", error, target_type="position_assignment")
            raise
        return Response(
            {"revision": revision, "authority": GrantAuthorityDetailSerializer(authority).data},
            status=status.HTTP_201_CREATED,
        )


class GrantAuthorityRevokeView(APIView):
    def post(self, request, authority_id):
        serializer = RevokeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        authority = GrantAuthority.objects.filter(pk=authority_id).first()
        if not authority:
            return Response({"detail": "Autoridad no encontrada."}, status=status.HTTP_404_NOT_FOUND)
        try:
            authority, revision = revoke_grant_authority(
                request, authority=authority, **serializer.validated_data
            )
        except APIException as error:
            _denied_audit(request, "permissions.authority.revoke_denied", error, target_type="grant_authority", target_id=authority_id)
            raise
        return Response({"revision": revision, "authority": GrantAuthorityDetailSerializer(authority).data})


class EffectiveAccessView(APIView):
    def get(self, request):
        assignment = get_request_assignment(request)
        query = EffectiveAccessQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        unit = query.validated_data["unit"]
        results = []
        for permission in Permission.objects.filter(is_active=True).order_by("module_code", "code"):
            decision = resolve_access(assignment, permission, unit)
            decision = apply_session_assurance(decision, permission, request)
            results.append({
                "permission": str(permission.id),
                "code": permission.code,
                "module_code": permission.module_code,
                "risk_level": permission.risk_level,
                "allowed": decision.allowed,
                "reason": decision.reason,
                "reason_code": decision.reason_code,
                "matched_rule_type": decision.matched_rule_type,
                "matched_rule_id": decision.matched_rule_id,
            })
        return Response({
            "assignment": str(assignment.id),
            "unit": str(unit.id),
            "revision": PermissionPolicyState.current_revision(),
            "results": results,
        })


class PolicyAuditView(APIView):
    def get(self, request):
        try:
            get_request_assignment(request)
            if not request.user.is_superuser:
                raise PermissionDenied("La auditoría completa está reservada al dueño.")
            require_recent_strong_mfa(request)
        except APIException as error:
            _denied_audit(request, "permissions.audit.read_denied", error, target_type="permission_audit")
            raise
        queryset = PermissionPolicyEvent.objects.select_related(
            "actor_account", "permission", "target_unit"
        )
        event_type = request.query_params.get("event_type")
        actor = request.query_params.get("actor")
        if event_type:
            queryset = queryset.filter(event_type=event_type)
        if actor:
            try:
                queryset = queryset.filter(actor_account_id=actor)
            except (DjangoValidationError, ValueError, TypeError):
                raise ValidationError({"actor": "El actor debe ser un UUID válido."})
        try:
            limit = int(request.query_params.get("limit", 100))
        except (ValueError, TypeError) as error:
            raise ValidationError({"limit": "El límite debe ser un número entero."}) from error
        limit = min(max(limit, 1), 500)
        return Response(PermissionPolicyEventSerializer(queryset[:limit], many=True).data)
