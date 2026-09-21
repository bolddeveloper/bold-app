"""Pruebas adversariales del plano de control de permisos.

Estas pruebas documentan las fronteras de seguridad que no deben relajarse:
``is_staff`` no es autoridad empresarial, los emisores se derivan de la
sesion autenticada, las denegaciones prevalecen y una autoridad delegada solo
puede operar sobre su allowlist, alcance y vigencia.
"""

from datetime import timedelta
from types import SimpleNamespace
from uuid import uuid4

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from boldApp.core.authorization import resolve_access
from boldApp.core.models import (
    AccessGrant,
    Employee,
    GrantAuthority,
    GrantAuthorityPermission,
    JobRole,
    JobRolePermission,
    OrganizationalUnit,
    Permission,
    Position,
    PositionAssignment,
    UserAccount,
)


@override_settings(SECURE_SSL_REDIRECT=False, PERMISSIONS_STEP_UP_MFA_SECONDS=600)
class PermissionControlPlaneSecurityTests(TestCase):
    password = "Una frase segura 2026!"

    def setUp(self):
        self.root_unit = OrganizationalUnit.objects.create(
            name="Direccion",
            unit_type="division",
            sensitivity_level=Permission.RISK_HIGH,
        )
        self.marketing = OrganizationalUnit.objects.create(
            name="Marketing",
            unit_type="department",
            parent_unit=self.root_unit,
            sensitivity_level=Permission.RISK_MEDIUM,
        )
        self.content = OrganizationalUnit.objects.create(
            name="Contenido",
            unit_type="team",
            parent_unit=self.marketing,
            sensitivity_level=Permission.RISK_LOW,
        )
        self.operations = OrganizationalUnit.objects.create(
            name="Operaciones",
            unit_type="department",
            parent_unit=self.root_unit,
            sensitivity_level=Permission.RISK_MEDIUM,
        )

        self.owner_role = JobRole.objects.create(title="Propietario", level="owner")
        self.manager_role = JobRole.objects.create(title="Gerente", level="manager")
        self.worker_role = JobRole.objects.create(title="Colaborador", level="member")

        self.owner, self.owner_assignment = self._principal(
            "owner@bold.gt",
            "Persona Propietaria",
            self.owner_role,
            self.root_unit,
            is_superuser=True,
            is_staff=True,
        )
        # Deliberadamente staff: nunca debe equivaler a autoridad de negocio.
        self.staff, self.staff_assignment = self._principal(
            "staff@bold.gt",
            "Soporte Django",
            self.manager_role,
            self.marketing,
            is_staff=True,
        )
        self.target, self.target_assignment = self._principal(
            "target@bold.gt",
            "Persona Destinataria",
            self.worker_role,
            self.content,
        )
        self.outsider, self.outsider_assignment = self._principal(
            "outsider@bold.gt",
            "Persona de Operaciones",
            self.worker_role,
            self.operations,
        )

        self.read_permission, _ = Permission.objects.update_or_create(
            code="tasks.task.read",
            defaults={
                "module_code": "tasks",
                "resource": "task",
                "action": "read",
                "risk_level": Permission.RISK_LOW,
                "is_delegable": True,
                "is_active": True,
            },
        )
        self.update_permission, _ = Permission.objects.update_or_create(
            code="tasks.task.update",
            defaults={
                "module_code": "tasks",
                "resource": "task",
                "action": "update",
                "risk_level": Permission.RISK_MEDIUM,
                "is_delegable": True,
                "is_active": True,
            },
        )

    def _principal(self, email, name, role, unit, *, is_staff=False, is_superuser=False):
        employee = Employee.objects.create(full_name=name)
        account = UserAccount.objects.create_user(
            email=email,
            employee=employee,
            password=self.password,
            is_staff=is_staff,
            is_superuser=is_superuser,
        )
        position = Position.objects.create(
            unit=unit,
            job_role=role,
            display_order=Position.objects.count() + 1,
        )
        assignment = PositionAssignment.objects.create(employee=employee, position=position)
        return account, assignment

    def _client(self, account, assignment, *, mfa="recent"):
        if mfa == "recent":
            verified_at = timezone.now() - timedelta(seconds=30)
            auth_strength = "password_totp"
        elif mfa == "stale":
            verified_at = timezone.now() - timedelta(hours=1)
            auth_strength = "password_totp"
        else:
            verified_at = None
            auth_strength = "password"
        auth_session = SimpleNamespace(
            id=uuid4(),
            mfa_verified_at=verified_at,
            auth_strength=auth_strength,
        )
        client = APIClient()
        client.force_authenticate(user=account, token=auth_session)
        client.credentials(HTTP_X_ASSIGNMENT_ID=str(assignment.id))
        return client

    def _access_payload(self, permission=None, target_unit=None, grantee=None):
        now = timezone.now()
        return {
            "grantee_assignment": str((grantee or self.target_assignment).id),
            "permission": str((permission or self.read_permission).id),
            "effect": AccessGrant.EFFECT_ALLOW,
            "scope_type": AccessGrant.SCOPE_SPECIFIC_UNIT,
            "target_unit": str((target_unit or self.content).id),
            "valid_from": now.isoformat(),
            "valid_until": (now + timedelta(minutes=30)).isoformat(),
            "reason": "Cobertura temporal documentada",
        }

    def _delegated_authority(
        self,
        *,
        permissions=None,
        target_unit=None,
        valid_until=None,
        assignment=None,
        parent=None,
        can_grant=True,
        can_revoke=True,
        can_delegate=False,
        depth=0,
        scope_type=GrantAuthority.SCOPE_SUB_TREE,
        max_sensitivity=Permission.RISK_MEDIUM,
    ):
        now = timezone.now()
        authority = GrantAuthority.objects.create(
            assignment=assignment or self.staff_assignment,
            scope_type=scope_type,
            target_unit=target_unit or self.marketing,
            max_sensitivity_level=max_sensitivity,
            can_grant_access=can_grant,
            can_revoke_access=can_revoke,
            can_delegate_authority=can_delegate,
            granted_by_assignment=self.owner_assignment,
            valid_from=now - timedelta(minutes=1),
            valid_until=valid_until or now + timedelta(days=1),
            max_grant_duration_seconds=3600,
            delegation_depth_remaining=depth,
            parent_authority=parent,
            reason="Delegacion acotada para pruebas",
            created_by_account=self.owner,
        )
        for permission in permissions or []:
            GrantAuthorityPermission.objects.create(
                grant_authority=authority,
                permission=permission,
            )
        return authority

    def _direct_rule(
        self,
        permission,
        *,
        effect,
        scope_type,
        target_unit=None,
        valid_from=None,
        valid_until=None,
    ):
        now = timezone.now()
        return AccessGrant.objects.create(
            grantee_assignment=self.staff_assignment,
            permission=permission,
            effect=effect,
            scope_type=scope_type,
            target_unit=target_unit,
            granted_by_assignment=self.owner_assignment,
            valid_from=valid_from or now - timedelta(minutes=5),
            valid_until=valid_until or now + timedelta(minutes=30),
            reason="Regla adversarial controlada",
            created_by_account=self.owner,
        )

    def test_is_staff_does_not_grant_control_plane_or_legacy_write_access(self):
        client = self._client(self.staff, self.staff_assignment)

        access = client.get("/api/v2/permissions/access/")
        self.assertEqual(access.status_code, 200, getattr(access, "data", None))
        self.assertFalse(access.data["is_owner"])
        self.assertFalse(access.data["can_manage_role_policies"])
        self.assertFalse(access.data["can_grant_access"])
        self.assertFalse(access.data["can_delegate_authority"])
        self.assertFalse(access.data["can_read_audit"])

        policy_write = client.post(
            "/api/v2/permissions/role-policies/",
            {
                "job_role": str(self.manager_role.id),
                "permission": str(self.read_permission.id),
                "rules": [{"effect": "allow", "scope_type": "global"}],
                "reason": "Intento de escalamiento mediante is_staff",
            },
            format="json",
        )
        self.assertEqual(policy_write.status_code, 403, getattr(policy_write, "data", None))
        self.assertFalse(JobRolePermission.objects.exists())

        legacy_write = client.post(
            "/api/v2/core/access-grants/",
            self._access_payload(),
            format="json",
        )
        self.assertEqual(legacy_write.status_code, 405, getattr(legacy_write, "data", None))

    def test_server_derives_issuer_and_ignores_spoofed_audit_fields(self):
        client = self._client(self.owner, self.owner_assignment)
        payload = self._access_payload()
        payload.update(
            {
                "granted_by_assignment": str(self.staff_assignment.id),
                "created_by_account": str(self.staff.id),
                "status": AccessGrant.STATUS_REVOKED,
                "revoked_by_assignment": str(self.staff_assignment.id),
            }
        )

        response = client.post("/api/v2/permissions/access-rules/", payload, format="json")

        self.assertEqual(response.status_code, 201, getattr(response, "data", None))
        grant = AccessGrant.objects.get(pk=response.data["grant"]["id"])
        self.assertEqual(grant.granted_by_assignment, self.owner_assignment)
        self.assertEqual(grant.created_by_account, self.owner)
        self.assertEqual(grant.status, AccessGrant.STATUS_ACTIVE)
        self.assertIsNone(grant.revoked_by_assignment)

    def test_optional_valid_from_is_derived_by_server(self):
        """El contrato marca valid_from opcional; omitirlo no debe causar un 500."""
        client = self._client(self.owner, self.owner_assignment)
        payload = self._access_payload()
        payload.pop("valid_from")

        response = client.post("/api/v2/permissions/access-rules/", payload, format="json")

        self.assertEqual(response.status_code, 201, getattr(response, "data", None))
        grant = AccessGrant.objects.get(pk=response.data["grant"]["id"])
        self.assertLess(abs((grant.valid_from - timezone.now()).total_seconds()), 5)

    def test_staff_without_delegated_authority_cannot_grant_or_self_escalate(self):
        client = self._client(self.staff, self.staff_assignment)

        to_other = client.post(
            "/api/v2/permissions/access-rules/",
            self._access_payload(),
            format="json",
        )
        self.assertEqual(to_other.status_code, 403, getattr(to_other, "data", None))

        self._delegated_authority(permissions=[self.read_permission])
        to_self = client.post(
            "/api/v2/permissions/access-rules/",
            self._access_payload(grantee=self.staff_assignment, target_unit=self.marketing),
            format="json",
        )
        self.assertEqual(to_self.status_code, 403, getattr(to_self, "data", None))
        self.assertFalse(AccessGrant.objects.exists())

    def test_employee_cannot_cross_grant_or_revoke_between_own_assignments(self):
        alternate_position = Position.objects.create(
            unit=self.content,
            job_role=self.manager_role,
            display_order=99,
        )
        alternate = PositionAssignment.objects.create(
            employee=self.staff.employee,
            position=alternate_position,
        )
        self._delegated_authority(
            permissions=[self.read_permission],
            can_delegate=True,
            depth=2,
        )
        client = self._client(self.staff, self.staff_assignment)

        create_grant = client.post(
            "/api/v2/permissions/access-rules/",
            self._access_payload(grantee=alternate, target_unit=self.content),
            format="json",
        )
        self.assertEqual(create_grant.status_code, 403, getattr(create_grant, "data", None))

        create_authority = client.post(
            "/api/v2/permissions/authorities/",
            {
                "assignment": str(alternate.id),
                "permissions": [str(self.read_permission.id)],
                "scope_type": GrantAuthority.SCOPE_SPECIFIC_UNIT,
                "target_unit": str(self.content.id),
                "max_sensitivity_level": Permission.RISK_LOW,
                "valid_until": (timezone.now() + timedelta(hours=1)).isoformat(),
                "max_grant_duration_seconds": 1800,
                "delegation_depth_remaining": 0,
                "can_grant_access": True,
                "can_revoke_access": False,
                "can_delegate_authority": False,
                "reason": "Intento entre dos plazas de la misma persona",
            },
            format="json",
        )
        self.assertEqual(create_authority.status_code, 403, getattr(create_authority, "data", None))

        owner_grant = AccessGrant.objects.create(
            grantee_assignment=alternate,
            permission=self.read_permission,
            effect=AccessGrant.EFFECT_ALLOW,
            scope_type=AccessGrant.SCOPE_SPECIFIC_UNIT,
            target_unit=self.content,
            granted_by_assignment=self.owner_assignment,
            valid_from=timezone.now() - timedelta(minutes=1),
            valid_until=timezone.now() + timedelta(minutes=30),
            reason="Acceso de prueba emitido por propietario",
            created_by_account=self.owner,
        )
        revoke_grant = client.post(
            f"/api/v2/permissions/access-rules/{owner_grant.id}/revoke/",
            {"reason": "Intento de retirar regla sobre otra plaza propia"},
            format="json",
        )
        self.assertEqual(revoke_grant.status_code, 403, getattr(revoke_grant, "data", None))

        own_authority = self._delegated_authority(
            permissions=[self.read_permission],
            assignment=alternate,
        )
        revoke_authority = client.post(
            f"/api/v2/permissions/authorities/{own_authority.id}/revoke/",
            {"reason": "Intento de retirar autoridad sobre otra plaza propia"},
            format="json",
        )
        self.assertEqual(revoke_authority.status_code, 403, getattr(revoke_authority, "data", None))

        listed_grants = client.get("/api/v2/permissions/access-rules/")
        listed_authorities = client.get("/api/v2/permissions/authorities/")
        self.assertNotIn(str(owner_grant.id), {row["id"] for row in listed_grants.data["results"]})
        self.assertNotIn(
            str(own_authority.id),
            {row["id"] for row in listed_authorities.data["results"]},
        )

    def test_delegated_authority_cannot_expand_or_revoke_beyond_its_full_scope(self):
        self._delegated_authority(
            permissions=[self.read_permission],
            target_unit=self.content,
            scope_type=GrantAuthority.SCOPE_SPECIFIC_UNIT,
        )
        client = self._client(self.staff, self.staff_assignment)
        expanded = self._access_payload(target_unit=self.content)
        expanded["scope_type"] = AccessGrant.SCOPE_SUB_TREE

        create_response = client.post(
            "/api/v2/permissions/access-rules/",
            expanded,
            format="json",
        )
        self.assertEqual(create_response.status_code, 403, getattr(create_response, "data", None))

        global_grant = AccessGrant.objects.create(
            grantee_assignment=self.target_assignment,
            permission=self.read_permission,
            effect=AccessGrant.EFFECT_ALLOW,
            scope_type=AccessGrant.SCOPE_GLOBAL,
            granted_by_assignment=self.owner_assignment,
            valid_from=timezone.now() - timedelta(minutes=1),
            valid_until=timezone.now() + timedelta(minutes=30),
            reason="Regla global reservada al propietario",
            created_by_account=self.owner,
        )
        revoke_response = client.post(
            f"/api/v2/permissions/access-rules/{global_grant.id}/revoke/",
            {"reason": "Intento de revocación fuera del alcance delegado"},
            format="json",
        )
        self.assertEqual(revoke_response.status_code, 403, getattr(revoke_response, "data", None))
        global_grant.refresh_from_db()
        self.assertEqual(global_grant.status, AccessGrant.STATUS_ACTIVE)

    def test_source_authority_is_revalidated_for_actual_unit_sensitivity(self):
        self._delegated_authority(
            permissions=[self.read_permission],
            target_unit=self.marketing,
            scope_type=GrantAuthority.SCOPE_SUB_TREE,
            max_sensitivity=Permission.RISK_MEDIUM,
        )
        payload = self._access_payload(target_unit=self.marketing)
        payload["scope_type"] = AccessGrant.SCOPE_SUB_TREE
        created = self._client(self.staff, self.staff_assignment).post(
            "/api/v2/permissions/access-rules/",
            payload,
            format="json",
        )
        self.assertEqual(created.status_code, 201, getattr(created, "data", None))
        critical_child = OrganizationalUnit.objects.create(
            name="Contenido reservado",
            unit_type="team",
            parent_unit=self.content,
            sensitivity_level=Permission.RISK_CRITICAL,
        )

        decision = resolve_access(
            self.target_assignment,
            self.read_permission,
            critical_child,
        )

        self.assertFalse(decision.allowed)
        self.assertEqual(decision.reason_code, "default_deny")

    def test_inactive_authority_holder_invalidates_descendant_chain_and_issued_grant(self):
        parent = self._delegated_authority(
            permissions=[self.read_permission],
            assignment=self.staff_assignment,
            can_delegate=True,
            depth=2,
        )
        child = self._delegated_authority(
            permissions=[self.read_permission],
            assignment=self.outsider_assignment,
            parent=parent,
            can_delegate=True,
            depth=1,
        )
        now = timezone.now()
        AccessGrant.objects.create(
            grantee_assignment=self.target_assignment,
            permission=self.read_permission,
            effect=AccessGrant.EFFECT_ALLOW,
            scope_type=AccessGrant.SCOPE_SPECIFIC_UNIT,
            target_unit=self.content,
            granted_by_assignment=self.outsider_assignment,
            source_authority=child,
            valid_from=now - timedelta(minutes=1),
            valid_until=now + timedelta(minutes=30),
            reason="Acceso emitido por una cadena delegada",
            created_by_account=self.outsider,
        )
        self.assertTrue(resolve_access(self.target_assignment, self.read_permission, self.content).allowed)

        self.staff_assignment.is_active = False
        self.staff_assignment.released_at = now
        self.staff_assignment.save(update_fields=["is_active", "released_at"])

        decision = resolve_access(self.target_assignment, self.read_permission, self.content)
        self.assertFalse(decision.allowed)
        self.assertEqual(decision.reason_code, "default_deny")

    def test_recent_strong_mfa_is_required_for_policy_mutations(self):
        payload = {
            "job_role": str(self.manager_role.id),
            "permission": str(self.read_permission.id),
            "rules": [{"effect": "allow", "scope_type": "global"}],
            "reason": "Politica base aprobada por propietario",
        }

        weak = self._client(self.owner, self.owner_assignment, mfa="weak").post(
            "/api/v2/permissions/role-policies/", payload, format="json"
        )
        self.assertEqual(weak.status_code, 403, getattr(weak, "data", None))
        self.assertFalse(JobRolePermission.objects.exists())

        stale = self._client(self.owner, self.owner_assignment, mfa="stale").post(
            "/api/v2/permissions/role-policies/", payload, format="json"
        )
        self.assertEqual(stale.status_code, 403, getattr(stale, "data", None))
        self.assertFalse(JobRolePermission.objects.exists())

        accepted = self._client(self.owner, self.owner_assignment, mfa="recent").post(
            "/api/v2/permissions/role-policies/", payload, format="json"
        )
        self.assertEqual(accepted.status_code, 200, getattr(accepted, "data", None))
        rule = JobRolePermission.objects.get()
        self.assertEqual(rule.created_by_account, self.owner)

    def test_delegated_authority_enforces_permission_allowlist_and_unit_scope(self):
        self._delegated_authority(permissions=[self.read_permission])
        client = self._client(self.staff, self.staff_assignment)

        allowed = client.post(
            "/api/v2/permissions/access-rules/",
            self._access_payload(permission=self.read_permission, target_unit=self.content),
            format="json",
        )
        self.assertEqual(allowed.status_code, 201, getattr(allowed, "data", None))
        grant = AccessGrant.objects.get(pk=allowed.data["grant"]["id"])
        self.assertIsNotNone(grant.source_authority_id)

        outside_allowlist = client.post(
            "/api/v2/permissions/access-rules/",
            self._access_payload(permission=self.update_permission, target_unit=self.content),
            format="json",
        )
        self.assertEqual(outside_allowlist.status_code, 403, getattr(outside_allowlist, "data", None))

        outside_unit = client.post(
            "/api/v2/permissions/access-rules/",
            self._access_payload(permission=self.read_permission, target_unit=self.operations),
            format="json",
        )
        self.assertEqual(outside_unit.status_code, 403, getattr(outside_unit, "data", None))

    def test_empty_authority_allowlist_never_means_all_permissions(self):
        self._delegated_authority(permissions=[])
        client = self._client(self.staff, self.staff_assignment)

        response = client.post(
            "/api/v2/permissions/access-rules/",
            self._access_payload(permission=self.read_permission),
            format="json",
        )

        self.assertEqual(response.status_code, 403, getattr(response, "data", None))
        self.assertFalse(AccessGrant.objects.exists())

    def test_reserved_control_plane_codes_are_inactive_and_not_configurable(self):
        reserved = Permission.objects.get(code="permissions.policy.manage")
        self.assertFalse(reserved.is_active)
        self.assertFalse(reserved.is_delegable)
        owner_client = self._client(self.owner, self.owner_assignment)

        catalog = owner_client.get("/api/v2/permissions/catalog/")
        response = owner_client.post(
            "/api/v2/permissions/role-policies/",
            {
                "job_role": str(self.manager_role.id),
                "permission": str(reserved.id),
                "rules": [{"effect": "allow", "scope_type": "global"}],
                "reason": "No debe configurarse una capacidad reservada",
            },
            format="json",
        )

        self.assertEqual(catalog.status_code, 200)
        self.assertNotIn(reserved.code, {row["code"] for row in catalog.data})
        self.assertEqual(response.status_code, 400, getattr(response, "data", None))
        self.assertFalse(JobRolePermission.objects.filter(permission=reserved).exists())

        authority = self._delegated_authority(permissions=[reserved])
        staff_access = self._client(self.staff, self.staff_assignment).get(
            "/api/v2/permissions/access/"
        )
        listed = owner_client.get("/api/v2/permissions/authorities/")
        serialized = next(row for row in listed.data["results"] if row["id"] == str(authority.id))
        self.assertFalse(staff_access.data["can_grant_access"])
        self.assertFalse(staff_access.data["can_revoke_access"])
        self.assertFalse(serialized["effective"])

    def test_delegated_actor_cannot_change_owner_access(self):
        self._delegated_authority(
            permissions=[self.read_permission],
            target_unit=self.root_unit,
        )
        client = self._client(self.staff, self.staff_assignment)

        response = client.post(
            "/api/v2/permissions/access-rules/",
            self._access_payload(
                grantee=self.owner_assignment,
                target_unit=self.root_unit,
            ),
            format="json",
        )

        self.assertEqual(response.status_code, 403, getattr(response, "data", None))
        self.assertFalse(AccessGrant.objects.exists())

    def test_delegation_chain_cannot_return_access_or_authority_to_an_ancestor(self):
        parent = self._delegated_authority(
            permissions=[self.read_permission],
            assignment=self.staff_assignment,
            can_delegate=True,
            depth=2,
        )
        child = self._delegated_authority(
            permissions=[self.read_permission],
            assignment=self.outsider_assignment,
            parent=parent,
            can_delegate=True,
            depth=1,
        )
        client = self._client(self.outsider, self.outsider_assignment)

        access_response = client.post(
            "/api/v2/permissions/access-rules/",
            self._access_payload(grantee=self.staff_assignment, target_unit=self.content),
            format="json",
        )
        authority_response = client.post(
            "/api/v2/permissions/authorities/",
            {
                "assignment": str(self.staff_assignment.id),
                "permissions": [str(self.read_permission.id)],
                "scope_type": GrantAuthority.SCOPE_SPECIFIC_UNIT,
                "target_unit": str(self.content.id),
                "max_sensitivity_level": Permission.RISK_LOW,
                "valid_until": (timezone.now() + timedelta(minutes=30)).isoformat(),
                "max_grant_duration_seconds": 1800,
                "delegation_depth_remaining": 0,
                "can_grant_access": True,
                "can_revoke_access": False,
                "can_delegate_authority": False,
                "reason": "Intento de devolver autoridad al emisor original",
            },
            format="json",
        )

        self.assertEqual(access_response.status_code, 403, getattr(access_response, "data", None))
        self.assertEqual(authority_response.status_code, 403, getattr(authority_response, "data", None))
        self.assertFalse(AccessGrant.objects.exists())
        self.assertEqual(GrantAuthority.objects.count(), 2)
        self.assertEqual(child.parent_authority_id, parent.id)

    def test_rules_and_authorities_reject_assignment_without_an_active_account(self):
        employee = Employee.objects.create(full_name="Sin cuenta")
        position = Position.objects.create(
            unit=self.content,
            job_role=self.worker_role,
            display_order=100,
        )
        assignment = PositionAssignment.objects.create(employee=employee, position=position)
        client = self._client(self.owner, self.owner_assignment)

        grant_response = client.post(
            "/api/v2/permissions/access-rules/",
            self._access_payload(grantee=assignment, target_unit=self.content),
            format="json",
        )
        self.assertEqual(grant_response.status_code, 400, getattr(grant_response, "data", None))

        authority_response = client.post(
            "/api/v2/permissions/authorities/",
            {
                "assignment": str(assignment.id),
                "permissions": [str(self.read_permission.id)],
                "scope_type": GrantAuthority.SCOPE_SPECIFIC_UNIT,
                "target_unit": str(self.content.id),
                "max_sensitivity_level": Permission.RISK_LOW,
                "valid_until": (timezone.now() + timedelta(hours=1)).isoformat(),
                "max_grant_duration_seconds": 1800,
                "delegation_depth_remaining": 0,
                "can_grant_access": True,
                "can_revoke_access": False,
                "can_delegate_authority": False,
                "reason": "No debe delegarse a una plaza sin cuenta",
            },
            format="json",
        )
        self.assertEqual(authority_response.status_code, 400, getattr(authority_response, "data", None))

    def test_deny_rule_requires_revoke_capability(self):
        self._delegated_authority(
            permissions=[self.read_permission],
            can_grant=True,
            can_revoke=False,
        )
        client = self._client(self.staff, self.staff_assignment)
        payload = self._access_payload()
        payload["effect"] = AccessGrant.EFFECT_DENY

        response = client.post("/api/v2/permissions/access-rules/", payload, format="json")

        self.assertEqual(response.status_code, 403, getattr(response, "data", None))
        self.assertFalse(AccessGrant.objects.exists())

    def test_removing_a_deny_requires_grant_capability(self):
        self._delegated_authority(
            permissions=[self.read_permission],
            can_grant=False,
            can_revoke=True,
        )
        client = self._client(self.staff, self.staff_assignment)
        payload = self._access_payload()
        payload["effect"] = AccessGrant.EFFECT_DENY
        created = client.post("/api/v2/permissions/access-rules/", payload, format="json")
        self.assertEqual(created.status_code, 201, getattr(created, "data", None))

        response = client.post(
            f"/api/v2/permissions/access-rules/{created.data['grant']['id']}/revoke/",
            {"reason": "Intento de retirar una denegación sin poder conceder"},
            format="json",
        )

        self.assertEqual(response.status_code, 403, getattr(response, "data", None))
        grant = AccessGrant.objects.get(id=created.data["grant"]["id"])
        self.assertEqual(grant.status, AccessGrant.STATUS_ACTIVE)

    def test_revoked_objects_do_not_bypass_authorization_on_idempotent_requests(self):
        now = timezone.now()
        grant = AccessGrant.objects.create(
            grantee_assignment=self.target_assignment,
            permission=self.read_permission,
            effect=AccessGrant.EFFECT_ALLOW,
            scope_type=AccessGrant.SCOPE_SPECIFIC_UNIT,
            target_unit=self.content,
            granted_by_assignment=self.owner_assignment,
            valid_from=now - timedelta(minutes=5),
            valid_until=now + timedelta(minutes=30),
            reason="Regla revocada para comprobar autorización",
            status=AccessGrant.STATUS_REVOKED,
            revoked_at=now,
            revoked_by_assignment=self.owner_assignment,
            revoked_by_account=self.owner,
            revocation_reason="Revocación previa controlada",
            created_by_account=self.owner,
        )
        authority = self._delegated_authority(
            permissions=[self.read_permission],
            assignment=self.staff_assignment,
        )
        authority.is_active = False
        authority.revoked_at = now
        authority.revoked_by_account = self.owner
        authority.revocation_reason = "Revocación previa controlada"
        authority.save(
            update_fields=["is_active", "revoked_at", "revoked_by_account", "revocation_reason"]
        )
        client = self._client(self.outsider, self.outsider_assignment)

        grant_response = client.post(
            f"/api/v2/permissions/access-rules/{grant.id}/revoke/",
            {"reason": "Intento sin autoridad sobre una regla revocada"},
            format="json",
        )
        authority_response = client.post(
            f"/api/v2/permissions/authorities/{authority.id}/revoke/",
            {"reason": "Intento sin autoridad sobre una delegación revocada"},
            format="json",
        )

        self.assertEqual(grant_response.status_code, 403, getattr(grant_response, "data", None))
        self.assertEqual(authority_response.status_code, 403, getattr(authority_response, "data", None))

        owner_client = self._client(self.owner, self.owner_assignment)
        owner_grant_response = owner_client.post(
            f"/api/v2/permissions/access-rules/{grant.id}/revoke/",
            {"reason": "Reintento idempotente autorizado por el dueño"},
            format="json",
        )
        owner_authority_response = owner_client.post(
            f"/api/v2/permissions/authorities/{authority.id}/revoke/",
            {"reason": "Reintento idempotente autorizado por el dueño"},
            format="json",
        )
        self.assertEqual(owner_grant_response.status_code, 200, getattr(owner_grant_response, "data", None))
        self.assertEqual(owner_authority_response.status_code, 200, getattr(owner_authority_response, "data", None))

    def test_revoked_ancestor_blocks_subdelegation_and_reported_capability(self):
        ancestor = self._delegated_authority(
            permissions=[self.read_permission],
            assignment=self.owner_assignment,
            target_unit=self.marketing,
            can_delegate=True,
            depth=2,
        )
        child = self._delegated_authority(
            permissions=[self.read_permission],
            parent=ancestor,
            target_unit=self.marketing,
            can_grant=False,
            can_revoke=False,
            can_delegate=True,
            depth=1,
        )
        ancestor.is_active = False
        ancestor.revoked_at = timezone.now()
        ancestor.revoked_by_account = self.owner
        ancestor.revocation_reason = "Cadena revocada durante prueba"
        ancestor.save(
            update_fields=["is_active", "revoked_at", "revoked_by_account", "revocation_reason"]
        )
        client = self._client(self.staff, self.staff_assignment)

        access = client.get("/api/v2/permissions/access/")
        self.assertEqual(access.status_code, 200)
        self.assertFalse(access.data["can_delegate_authority"])

        response = client.post(
            "/api/v2/permissions/authorities/",
            {
                "assignment": str(self.target_assignment.id),
                "permissions": [str(self.read_permission.id)],
                "scope_type": GrantAuthority.SCOPE_SPECIFIC_UNIT,
                "target_unit": str(self.content.id),
                "max_sensitivity_level": Permission.RISK_LOW,
                "valid_until": (timezone.now() + timedelta(hours=1)).isoformat(),
                "max_grant_duration_seconds": 1800,
                "delegation_depth_remaining": 0,
                "can_grant_access": True,
                "can_revoke_access": False,
                "can_delegate_authority": False,
                "reason": "Intento desde una cadena ya revocada",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 403, getattr(response, "data", None))
        self.assertFalse(GrantAuthority.objects.exclude(id__in=[ancestor.id, child.id]).exists())

    def test_resource_type_is_server_derived_and_mismatch_is_rejected(self):
        client = self._client(self.owner, self.owner_assignment)
        payload = self._access_payload()
        payload["resource_id"] = str(uuid4())

        accepted = client.post("/api/v2/permissions/access-rules/", payload, format="json")
        self.assertEqual(accepted.status_code, 201, getattr(accepted, "data", None))
        grant = AccessGrant.objects.get(pk=accepted.data["grant"]["id"])
        self.assertEqual(grant.resource_type, self.read_permission.resource)

        mismatch = self._access_payload(grantee=self.outsider_assignment)
        mismatch.update({"resource_id": str(uuid4()), "resource_type": "project"})
        rejected = client.post("/api/v2/permissions/access-rules/", mismatch, format="json")
        self.assertEqual(rejected.status_code, 400, getattr(rejected, "data", None))

    def test_critical_permission_requires_recent_strong_mfa_at_use_time(self):
        critical = Permission.objects.create(
            code="tasks.webhook.test-critical",
            module_code="tasks",
            resource="webhook",
            action="test-critical",
            risk_level=Permission.RISK_CRITICAL,
            is_delegable=True,
            requires_step_up_mfa=True,
        )
        JobRolePermission.objects.create(
            job_role=self.manager_role,
            permission=critical,
            effect=JobRolePermission.EFFECT_ALLOW,
            scope_type=JobRolePermission.SCOPE_OWN_UNIT,
        )
        body = {
            "assignment": str(self.staff_assignment.id),
            "permission_code": critical.code,
            "target_unit": str(self.marketing.id),
        }

        weak = self._client(self.staff, self.staff_assignment, mfa="weak").post(
            "/api/v2/core/authorize/", body, format="json"
        )
        self.assertEqual(weak.status_code, 200, getattr(weak, "data", None))
        self.assertFalse(weak.data["allowed"])
        self.assertEqual(weak.data["reason_code"], "mfa_step_up_required")

        strong = self._client(self.staff, self.staff_assignment, mfa="recent").post(
            "/api/v2/core/authorize/", body, format="json"
        )
        self.assertEqual(strong.status_code, 200, getattr(strong, "data", None))
        self.assertTrue(strong.data["allowed"])

        weak_effective = self._client(self.staff, self.staff_assignment, mfa="weak").get(
            "/api/v2/permissions/effective/",
            {"unit": str(self.marketing.id)},
        )
        strong_effective = self._client(self.staff, self.staff_assignment, mfa="recent").get(
            "/api/v2/permissions/effective/",
            {"unit": str(self.marketing.id)},
        )
        weak_row = next(row for row in weak_effective.data["results"] if row["code"] == critical.code)
        strong_row = next(row for row in strong_effective.data["results"] if row["code"] == critical.code)
        self.assertFalse(weak_row["allowed"])
        self.assertEqual(weak_row["reason_code"], "mfa_step_up_required")
        self.assertTrue(strong_row["allowed"])

    def test_complete_policy_audit_requires_owner_and_recent_strong_mfa(self):
        weak = self._client(self.owner, self.owner_assignment, mfa="weak").get(
            "/api/v2/permissions/audit/"
        )
        delegated = self._client(self.staff, self.staff_assignment, mfa="recent").get(
            "/api/v2/permissions/audit/"
        )
        strong = self._client(self.owner, self.owner_assignment, mfa="recent").get(
            "/api/v2/permissions/audit/"
        )

        self.assertEqual(weak.status_code, 403, getattr(weak, "data", None))
        self.assertEqual(delegated.status_code, 403, getattr(delegated, "data", None))
        self.assertEqual(strong.status_code, 200, getattr(strong, "data", None))
        denied_events = strong.data
        self.assertGreaterEqual(
            sum(row["event_type"] == "permissions.audit.read_denied" for row in denied_events),
            2,
        )

    def test_direct_deny_precedes_role_allow_and_role_deny_precedes_direct_allow(self):
        JobRolePermission.objects.create(
            job_role=self.manager_role,
            permission=self.read_permission,
            effect=JobRolePermission.EFFECT_ALLOW,
            scope_type=JobRolePermission.SCOPE_GLOBAL,
        )
        direct_deny = self._direct_rule(
            self.read_permission,
            effect=AccessGrant.EFFECT_DENY,
            scope_type=AccessGrant.SCOPE_SPECIFIC_UNIT,
            target_unit=self.content,
        )

        denied = resolve_access(self.staff_assignment, self.read_permission, self.content)
        self.assertFalse(denied.allowed)
        self.assertEqual(denied.reason_code, "direct_deny")
        self.assertEqual(denied.matched_rule_id, str(direct_deny.id))

        JobRolePermission.objects.create(
            job_role=self.manager_role,
            permission=self.update_permission,
            effect=JobRolePermission.EFFECT_DENY,
            scope_type=JobRolePermission.SCOPE_GLOBAL,
        )
        self._direct_rule(
            self.update_permission,
            effect=AccessGrant.EFFECT_ALLOW,
            scope_type=AccessGrant.SCOPE_SPECIFIC_UNIT,
            target_unit=self.content,
        )
        role_denied = resolve_access(self.staff_assignment, self.update_permission, self.content)
        self.assertFalse(role_denied.allowed)
        self.assertEqual(role_denied.reason_code, "role_deny")

    def test_subtree_scope_and_half_open_validity_interval_are_enforced(self):
        now = timezone.now()
        JobRolePermission.objects.create(
            job_role=self.manager_role,
            permission=self.read_permission,
            effect=JobRolePermission.EFFECT_ALLOW,
            scope_type=JobRolePermission.SCOPE_SUB_TREE,
            target_unit=self.marketing,
        )
        self.assertTrue(resolve_access(self.staff_assignment, self.read_permission, self.content).allowed)
        self.assertFalse(resolve_access(self.staff_assignment, self.read_permission, self.operations).allowed)

        grant = self._direct_rule(
            self.update_permission,
            effect=AccessGrant.EFFECT_ALLOW,
            scope_type=AccessGrant.SCOPE_SPECIFIC_UNIT,
            target_unit=self.content,
            valid_from=now - timedelta(minutes=5),
            valid_until=now,
        )
        immediately_before = resolve_access(
            self.staff_assignment,
            self.update_permission,
            self.content,
            at=now - timedelta(microseconds=1),
        )
        at_expiration = resolve_access(
            self.staff_assignment,
            self.update_permission,
            self.content,
            at=now,
        )
        self.assertTrue(immediately_before.allowed)
        self.assertEqual(immediately_before.matched_rule_id, str(grant.id))
        self.assertFalse(at_expiration.allowed)
        self.assertEqual(at_expiration.reason_code, "default_deny")

    def test_expired_or_revoked_parent_authority_invalidates_issued_grant(self):
        now = timezone.now()
        authority = self._delegated_authority(
            permissions=[self.read_permission],
            valid_until=now + timedelta(minutes=10),
        )
        grant = AccessGrant.objects.create(
            grantee_assignment=self.target_assignment,
            permission=self.read_permission,
            effect=AccessGrant.EFFECT_ALLOW,
            scope_type=AccessGrant.SCOPE_SPECIFIC_UNIT,
            target_unit=self.content,
            granted_by_assignment=self.staff_assignment,
            source_authority=authority,
            valid_from=now - timedelta(minutes=1),
            valid_until=now + timedelta(minutes=5),
            reason="Acceso emitido desde autoridad delegada",
            created_by_account=self.staff,
        )
        self.assertTrue(resolve_access(self.target_assignment, self.read_permission, self.content).allowed)

        authority.is_active = False
        authority.revoked_at = timezone.now()
        authority.revoked_by_account = self.owner
        authority.revocation_reason = "Revocacion de emergencia"
        authority.save(
            update_fields=["is_active", "revoked_at", "revoked_by_account", "revocation_reason"]
        )

        invalidated = resolve_access(self.target_assignment, self.read_permission, self.content)
        self.assertFalse(invalidated.allowed)
        self.assertEqual(invalidated.reason_code, "default_deny")
        grant.refresh_from_db()
        self.assertEqual(grant.status, AccessGrant.STATUS_ACTIVE)

        listed = self._client(self.owner, self.owner_assignment).get(
            "/api/v2/permissions/access-rules/"
        )
        serialized = next(row for row in listed.data["results"] if row["id"] == str(grant.id))
        self.assertFalse(serialized["effective"])
