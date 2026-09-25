import re

from django.core import mail
from django.core.management import call_command
from django.test import TestCase, override_settings
from rest_framework.test import APIClient, APIRequestFactory

from boldApp.autenticacion.models import AuthEvent, AuthMFAMethod, AuthSession
from boldApp.autenticacion.services import create_session, encrypt_secret, generate_totp_secret
from boldApp.core.models import Employee, JobRole, OrganizationalUnit, Position, PositionAssignment, UserAccount
from boldApp.tareas.models import ActivityLog, Project, Task, TaskStatus

from ..models import AdministrativeAction, OffboardingCase, ResponsibilityTransfer, SystemAuditEvent


@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend", SECURE_SSL_REDIRECT=False, DEBUG=True, AUTH_ENCRYPTION_KEY="")
class AdministrationApiTests(TestCase):
    def setUp(self):
        call_command("seed_demo_data", verbosity=0)
        self.owner = UserAccount.objects.get(email="ana@bold.gt")
        self.owner.is_superuser = True
        self.owner.is_staff = True
        self.owner.save(update_fields=["is_superuser", "is_staff", "updated_at"])
        request = APIRequestFactory().get("/", REMOTE_ADDR="127.0.0.1")
        _, self.owner_session = create_session(self.owner, request, auth_strength="password_totp", mfa_verified=True)
        self.client = APIClient()
        self.client.force_authenticate(self.owner, self.owner_session)

    def test_only_superuser_can_open_administration_and_sensitive_actions_require_recent_mfa(self):
        self.assertEqual(self.client.get("/api/v2/administration/dashboard/").status_code, 200)
        ordinary = UserAccount.objects.get(email="samuel@bold.gt")
        ordinary_client = APIClient(); ordinary_client.force_authenticate(ordinary)
        self.assertEqual(ordinary_client.get("/api/v2/administration/dashboard/").status_code, 403)

        weak_client = APIClient(); weak_client.force_authenticate(self.owner, AuthSession.objects.create(
            user_account=self.owner, token_hash="1" * 64, expires_at=self.owner_session.expires_at,
            auth_strength="password", credentials_version=self.owner.credentials_version,
        ))
        samuel = ordinary.employee
        response = weak_client.post(f"/api/v2/administration/employees/{samuel.id}/revoke-sessions/", {"reason": "Prueba sin MFA reciente"}, format="json")
        self.assertEqual(response.status_code, 403)
        role = JobRole.objects.first()
        response = weak_client.patch(f"/api/v2/administration/roles/{role.id}/", {"title": role.title, "reason": "Edición sin MFA reciente"}, format="json")
        self.assertEqual(response.status_code, 403)

    def test_create_employee_sends_single_use_invitation_and_records_audit(self):
        marketing = OrganizationalUnit.objects.get(name="Marketing")
        position = Position.objects.create(unit=marketing, job_role=self.owner.employee.position_assignments.first().position.job_role, display_order=99)
        with self.captureOnCommitCallbacks(execute=True):
            created = self.client.post("/api/v2/administration/employees/", {"full_name": "Invitada Bold", "email": "invitada@bold.gt", "position": str(position.id)}, format="json")
        self.assertEqual(created.status_code, 201, created.data)
        account = UserAccount.objects.get(email="invitada@bold.gt")
        self.assertFalse(account.has_usable_password())
        self.assertEqual(len(mail.outbox), 1)
        token = re.search(r"invitation_token=([^\s]+)", mail.outbox[0].body).group(1)
        accepted = APIClient().post("/api/v2/auth/invitation/confirm/", {"token": token, "password": "Horizonte Violeta 2026!"}, format="json")
        self.assertEqual(accepted.status_code, 200, accepted.data)
        account.refresh_from_db()
        self.assertTrue(account.check_password("Horizonte Violeta 2026!"))
        self.assertIsNotNone(account.email_verified_at)
        self.assertTrue(AdministrativeAction.objects.filter(action_type="employee_created", target_account=account).exists())
        self.assertTrue(SystemAuditEvent.objects.filter(event_type="administration.employee_created", target_id=account.employee_id).exists())
        reused = APIClient().post("/api/v2/auth/invitation/confirm/", {"token": token, "password": "Otro Horizonte Violeta 2027!"}, format="json")
        self.assertEqual(reused.status_code, 400)

    def test_owner_can_reset_mfa_and_revoke_target_sessions(self):
        target = UserAccount.objects.get(email="samuel@bold.gt")
        AuthMFAMethod.objects.create(user_account=target, method_type=AuthMFAMethod.TYPE_TOTP, label="Prueba", secret_encrypted=encrypt_secret(generate_totp_secret()), is_active=True)
        request = APIRequestFactory().get("/", REMOTE_ADDR="127.0.0.1")
        create_session(target, request, auth_strength="password_totp", mfa_verified=True)
        response = self.client.post(f"/api/v2/administration/employees/{target.employee_id}/reset-mfa/", {"reason": "Teléfono corporativo extraviado"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        target.refresh_from_db()
        self.assertFalse(target.mfa_methods.filter(is_active=True).exists())
        self.assertFalse(AuthSession.objects.filter(user_account=target, revoked_at__isnull=True).exists())
        self.assertTrue(AdministrativeAction.objects.filter(action_type="mfa_reset", target_account=target).exists())

    def test_offboarding_transfers_tasks_and_project_ownership_then_deactivates_employee(self):
        samuel = UserAccount.objects.get(email="samuel@bold.gt")
        source = PositionAssignment.objects.get(employee=samuel.employee, is_active=True)
        target = PositionAssignment.objects.get(employee=self.owner.employee, position__unit=source.position.unit, is_active=True)
        status_row = TaskStatus.objects.get(unit=source.position.unit, category="todo")
        task = Task.objects.create(unit=source.position.unit, created_by_assignment=source, assignee_assignment=source, status=status_row, title="Responsabilidad Samuel", priority="medium")
        project = Project.objects.create(unit=source.position.unit, owner_assignment=source, created_by_assignment=source, name="Proyecto de salida", status="active")
        preview = self.client.get(f"/api/v2/administration/employees/{samuel.employee_id}/offboarding-preview/")
        self.assertEqual(preview.status_code, 200)
        self.assertGreaterEqual(sum(len(module["resources"]) for module in preview.data["modules"]), 2)
        response = self.client.post(f"/api/v2/administration/employees/{samuel.employee_id}/offboard/", {
            "reason": "Finalización de relación laboral confirmada",
            "default_target_assignment": str(target.id),
            "allow_unassigned": False,
        }, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        task.refresh_from_db(); project.refresh_from_db(); samuel.refresh_from_db(); source.refresh_from_db()
        self.assertEqual(task.assignee_assignment, target)
        self.assertEqual(project.owner_assignment, target)
        self.assertFalse(samuel.is_active)
        self.assertFalse(samuel.employee.is_active)
        self.assertFalse(source.is_active)
        self.assertTrue(OffboardingCase.objects.filter(employee=samuel.employee, status=OffboardingCase.STATUS_COMPLETED).exists())
        self.assertTrue(ResponsibilityTransfer.objects.filter(resource_id__in=[task.id, project.id], status=ResponsibilityTransfer.STATUS_COMPLETED).exists())

    def test_audit_endpoint_aggregates_administration_authentication_and_permissions(self):
        AuthEvent.objects.create(event_type="login.succeeded", user_account=self.owner, success=True)
        assignment = self.owner.employee.position_assignments.first()
        task = Task.objects.create(
            unit=assignment.position.unit,
            created_by_assignment=assignment,
            assignee_assignment=assignment,
            status=TaskStatus.objects.filter(unit=assignment.position.unit).first(),
            title="Evento auditable",
            priority="medium",
        )
        ActivityLog.objects.create(task=task, actor_assignment=assignment, action="updated", field_name="title", old_value="Antes", new_value="Después")
        record = self.client.get("/api/v2/administration/audit-events/")
        self.assertEqual(record.status_code, 200)
        modules = {row["module_code"] for row in record.data["results"]}
        self.assertIn("authentication", modules)
        self.assertIn("tasks", modules)

    def test_owner_can_send_password_recovery_without_setting_or_reading_password(self):
        target = UserAccount.objects.get(email="samuel@bold.gt")
        original_hash = target.password
        response = self.client.post(
            f"/api/v2/administration/employees/{target.employee_id}/send-password-reset/",
            {"reason": "Recuperación solicitada por el empleado"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        target.refresh_from_db()
        self.assertEqual(target.password, original_hash)
        self.assertEqual(len(mail.outbox), 1)
        self.assertNotIn("password", response.data)

    def test_owner_can_manage_organization_catalog_with_audited_reason(self):
        unit = self.client.post("/api/v2/administration/units/", {
            "name": "Finanzas", "unit_type": "department", "sensitivity_level": "high",
            "reason": "Creación del departamento financiero",
        }, format="json")
        self.assertEqual(unit.status_code, 201, unit.data)
        role = self.client.post("/api/v2/administration/roles/", {
            "title": "Analista financiero", "level": "senior",
            "reason": "Creación del catálogo de Finanzas",
        }, format="json")
        self.assertEqual(role.status_code, 201, role.data)
        duplicate = self.client.post("/api/v2/administration/roles/", {
            "title": "analista  finánciero", "level": "senior",
            "reason": "Intento de duplicación del catálogo",
        }, format="json")
        self.assertEqual(duplicate.status_code, 400)
        position = self.client.post("/api/v2/administration/positions/", {
            "unit": unit.data["id"], "job_role": role.data["id"], "display_order": 99,
            "reason": "Apertura de la primera plaza financiera",
        }, format="json")
        self.assertEqual(position.status_code, 201, position.data)
        self.assertTrue(SystemAuditEvent.objects.filter(event_type="administration.organizational_unit_created", target_id=unit.data["id"]).exists())
        self.assertTrue(SystemAuditEvent.objects.filter(event_type="administration.job_role_created", target_id=role.data["id"]).exists())
        self.assertTrue(SystemAuditEvent.objects.filter(event_type="administration.position_created", target_id=position.data["id"]).exists())

        overview = self.client.get("/api/v2/administration/organization/")
        created_position = next(row for row in overview.data["positions"] if str(row["id"]) == str(position.data["id"]))
        self.assertEqual(created_position["display_order"], 1)
        self.assertIsNone(created_position["occupant_name"])

        rejected = self.client.post("/api/v2/administration/roles/delete-level/", {
            "level": "senior", "confirmation": "Senior", "confirmed": True,
        }, format="json")
        self.assertEqual(rejected.status_code, 400)
        deleted = self.client.post("/api/v2/administration/roles/delete-level/", {
            "level": "senior", "confirmation": "senior", "confirmed": True,
        }, format="json")
        self.assertEqual(deleted.status_code, 200, deleted.data)
        self.assertEqual(deleted.data["roles_updated"], 1)
        self.assertIsNone(JobRole.objects.get(id=role.data["id"]).level)

        editable = self.client.post("/api/v2/administration/roles/", {
            "title": "Auditor interno", "reason": "Creación temporal para edición",
        }, format="json")
        edited = self.client.patch(f'/api/v2/administration/roles/{editable.data["id"]}/', {
            "title": "Auditor corporativo", "reason": "Actualización del nombre del cargo",
        }, format="json")
        self.assertEqual(edited.status_code, 200, edited.data)
        removed = self.client.delete(f'/api/v2/administration/roles/{editable.data["id"]}/', {
            "reason": "Eliminación del cargo temporal",
        }, format="json")
        self.assertEqual(removed.status_code, 204, removed.data)
