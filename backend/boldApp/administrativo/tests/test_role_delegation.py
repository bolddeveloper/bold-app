from datetime import timedelta

from django.test import TestCase, RequestFactory, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from boldApp.autenticacion.services import create_session
from boldApp.core.models import Employee, JobRole, Position, PositionAssignment, OrganizationalUnit, UserAccount, Permission, JobRolePermission
from boldApp.core.security_control import security_snapshot
from boldApp.permisos.models import PermissionPolicyEvent


@override_settings(SECURE_SSL_REDIRECT=False, EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
class RoleModuleDelegationTests(TestCase):
    def setUp(self):
        self.direction = OrganizationalUnit.objects.create(name="Dirección", unit_type="department", sensitivity_level="critical", is_control_plane=True)
        self.operations = OrganizationalUnit.objects.create(name="Operaciones", unit_type="department", sensitivity_level="low")
        self.owner_role = JobRole.objects.create(title="Propietario")
        self.delegate_role = JobRole.objects.create(title="Asistente operativo")
        self.normal_role = JobRole.objects.create(title="Colaborador")
        self.owner, self.owner_assignment = self.identity("owner", self.owner_role, self.direction, owner=True)
        self.delegate, self.assignment = self.identity("assistant", self.delegate_role, self.direction)
        self.target, self.target_assignment = self.identity("worker", self.normal_role, self.operations)
        self.owner_client, self.owner_session = self.client_for(self.owner, self.owner_assignment)
        self.delegate_client, self.session = self.client_for(self.delegate, self.assignment)
        self.permission, _ = Permission.objects.get_or_create(code="tasks.task.read", defaults={"module_code": "tasks", "resource": "task", "action": "read", "is_delegable": True, "is_bulk_assignable": True})

    def identity(self, name, role, unit, owner=False):
        employee = Employee.objects.create(full_name=name)
        account = UserAccount.objects.create_user(email=f"{name}@bold.gt", employee=employee, is_superuser=owner)
        assignment = PositionAssignment.objects.create(employee=employee, position=Position.objects.create(unit=unit, job_role=role))
        return account, assignment

    def client_for(self, account, assignment, mfa=True):
        _, session = create_session(account, RequestFactory().get("/", REMOTE_ADDR="127.0.0.1"), auth_strength="password_totp" if mfa else "password", mfa_verified=mfa)
        client = APIClient()
        client.force_authenticate(account, session)
        client.credentials(HTTP_X_ASSIGNMENT_ID=str(assignment.pk))
        return client, session

    def enable(self, administration=True, permissions=True):
        response = self.owner_client.post(f"/api/v2/administration/roles/{self.delegate_role.pk}/module-access/", {
            "administration_enabled": administration, "permissions_enabled": permissions, "reason": "Delegación de prueba aprobada",
        }, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        return response

    def policy(self, role):
        return {"job_role": str(role.pk), "permission": str(self.permission.pk), "rules": [{"effect": "allow", "scope_type": "own_unit"}], "reason": "Concesión ordinaria de prueba"}

    def test_owner_enables_independent_modules_with_mfa_and_audit(self):
        self.assertEqual(self.delegate_client.get("/api/v2/administration/dashboard/").status_code, 403)
        self.assertEqual(self.delegate_client.get("/api/v2/permissions/catalog/").status_code, 403)
        before = security_snapshot(self.session.pk, self.assignment.pk)
        self.enable(permissions=False)
        self.assertEqual(self.delegate_client.get("/api/v2/administration/dashboard/").status_code, 200)
        self.assertEqual(self.delegate_client.get("/api/v2/permissions/catalog/").status_code, 403)
        self.assertNotEqual(before["context"], security_snapshot(self.session.pk, self.assignment.pk)["context"])
        self.assertTrue(PermissionPolicyEvent.objects.filter(event_type="permissions.role_modules.changed", target_id=str(self.delegate_role.pk)).exists())
        weak, _ = self.client_for(self.owner, self.owner_assignment, mfa=False)
        self.assertEqual(weak.post(f"/api/v2/administration/roles/{self.delegate_role.pk}/module-access/", {"administration_enabled": False, "permissions_enabled": False, "reason": "Sin MFA no debe modificarse"}, format="json").status_code, 403)
        self.enable(administration=False, permissions=True)
        self.assertEqual(self.delegate_client.get("/api/v2/administration/dashboard/").status_code, 403)
        self.assertEqual(self.delegate_client.get("/api/v2/permissions/catalog/").status_code, 200)

    def test_delegate_creates_employees_roles_and_manages_other_role_policies(self):
        self.enable()
        response = self.delegate_client.post("/api/v2/administration/employees/", {"full_name": "Nueva persona", "email": "new@bold.gt"}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        created = UserAccount.objects.get(email="new@bold.gt")
        self.assertFalse(created.is_superuser)
        role = self.delegate_client.post("/api/v2/administration/roles/", {"title": "Cargo auxiliar", "reason": "Nuevo cargo para las operaciones", "administration_enabled": True}, format="json")
        self.assertEqual(role.status_code, 201, role.data)
        self.assertFalse(JobRole.objects.get(pk=role.data["id"]).administration_enabled)
        policy = self.delegate_client.post("/api/v2/permissions/role-policies/", self.policy(self.normal_role), format="json")
        self.assertEqual(policy.status_code, 200, policy.data)
        self.assertTrue(JobRolePermission.objects.filter(job_role=self.normal_role, permission=self.permission).exists())

    def test_delegates_cannot_change_owner_self_privileged_roles_or_delegate_module_access(self):
        self.enable()
        for role in (self.owner_role, self.delegate_role):
            self.assertEqual(self.delegate_client.post("/api/v2/permissions/role-policies/", self.policy(role), format="json").status_code, 403)
            self.assertEqual(self.delegate_client.patch(f"/api/v2/administration/roles/{role.pk}/", {"title": "Cargo alterado", "reason": "Cambio indebido de un cargo"}, format="json").status_code, 403)
            self.assertEqual(self.delegate_client.post(f"/api/v2/administration/roles/{role.pk}/module-access/", {"administration_enabled": True, "permissions_enabled": True, "reason": "Escalamiento no permitido"}, format="json").status_code, 403)
        for employee in (self.owner.employee, self.delegate.employee):
            url = f"/api/v2/administration/employees/{employee.pk}/"
            self.assertEqual(self.delegate_client.patch(url, {"full_name": "Nombre alterado", "reason": "Alteración indebida de cuenta"}, format="json").status_code, 403)
            for action in ("reset-mfa", "revoke-sessions", "deactivate-account", "send-password-reset", "resend-invitation", "set-temporary-password"):
                self.assertEqual(self.delegate_client.post(url + action + "/", {"reason": "Operación indebida de cuenta"}, format="json").status_code, 403)
        protected_position = Position.objects.create(unit=self.direction, job_role=self.delegate_role)
        self.assertEqual(self.delegate_client.post(f"/api/v2/administration/employees/{self.target.employee_id}/assign-position/", {"position": str(protected_position.pk), "reason": "Ascenso administrativo indirecto"}, format="json").status_code, 403)
        self.assertEqual(self.delegate_client.patch(f"/api/v2/administration/positions/{self.target_assignment.position_id}/", {"job_role": str(self.delegate_role.pk), "reason": "Escalamiento mediante una plaza"}, format="json").status_code, 403)
        self.assertEqual(self.delegate_client.post("/api/v2/administration/positions/", {"unit": str(self.direction.pk), "job_role": str(self.owner_role.pk), "reason": "Otra plaza de propietario"}, format="json").status_code, 403)

    def test_mfa_direction_and_revocation_are_checked_by_server(self):
        self.enable()
        weak, _ = self.client_for(self.delegate, self.assignment, mfa=False)
        self.assertEqual(weak.post("/api/v2/administration/employees/", {"full_name": "Sin MFA", "email": "weak@bold.gt"}, format="json").status_code, 403)
        self.assertEqual(weak.post("/api/v2/permissions/role-policies/", self.policy(self.normal_role), format="json").status_code, 403)
        elsewhere, assignment = self.identity("elsewhere", self.delegate_role, self.operations)
        outside, _ = self.client_for(elsewhere, assignment)
        self.assertEqual(outside.get("/api/v2/administration/dashboard/").status_code, 403)
        self.assertEqual(outside.get("/api/v2/permissions/catalog/").status_code, 403)
        before = security_snapshot(self.session.pk, self.assignment.pk)
        self.enable(administration=False, permissions=False)
        self.assertEqual(self.delegate_client.get("/api/v2/administration/dashboard/").status_code, 403)
        self.assertEqual(self.delegate_client.get("/api/v2/permissions/catalog/").status_code, 403)
        self.assertNotEqual(before["context"], security_snapshot(self.session.pk, self.assignment.pk)["context"])

    def test_owner_role_cannot_have_module_flags_changed(self):
        response = self.owner_client.post(f"/api/v2/administration/roles/{self.owner_role.pk}/module-access/", {"administration_enabled": False, "permissions_enabled": False, "reason": "No debe retirar acceso al dueño"}, format="json")
        self.assertEqual(response.status_code, 403, response.data)

    def test_individual_grants_and_bulk_rules_do_not_bypass_protected_targets(self):
        self.enable()
        payload = {
            "permission": str(self.permission.pk), "effect": "allow", "scope_type": "own_unit",
            "valid_until": (timezone.now() + timedelta(minutes=30)).isoformat(),
            "reason": "Cobertura individual de prueba",
        }
        for assignment in (self.owner_assignment, self.assignment):
            response = self.delegate_client.post("/api/v2/permissions/access-rules/", {
                **payload, "grantee_assignment": str(assignment.pk),
            }, format="json")
            self.assertEqual(response.status_code, 403, response.data)
        granted = self.delegate_client.post("/api/v2/permissions/access-rules/", {
            **payload, "grantee_assignment": str(self.target_assignment.pk),
        }, format="json")
        self.assertEqual(granted.status_code, 201, granted.data)
        revoked = self.delegate_client.post(f"/api/v2/permissions/access-rules/{granted.data['grant']['id']}/revoke/", {
            "reason": "Retirar cobertura de prueba",
        }, format="json")
        self.assertEqual(revoked.status_code, 200, revoked.data)
        for role in (self.owner_role, self.delegate_role):
            response = self.delegate_client.post("/api/v2/permissions/role-policies/bulk/", {
                "job_role": str(role.pk), "permissions": [str(self.permission.pk)],
                "rules": [{"effect": "allow", "scope_type": "global"}], "reason": "Escalamiento masivo bloqueado",
            }, format="json")
            self.assertEqual(response.status_code, 403, response.data)
