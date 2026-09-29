import json
import re

from django.core import mail
from django.core.management import call_command
from django.test import TestCase, override_settings
from rest_framework.test import APIClient, APIRequestFactory

from boldApp.autenticacion.models import AuthChallenge, AuthEvent, AuthMFAMethod, AuthSession
from boldApp.autenticacion.services import create_challenge, create_session, encrypt_secret, generate_totp_secret
from boldApp.core.models import Employee, JobRole, OrganizationalUnit, Position, PositionAssignment, UserAccount
from boldApp.tareas.models import ActivityLog, Project, Task, TaskStatus

from ..models import AdministrativeAction, OffboardingCase, OrganizationCatalogOption, ResponsibilityTransfer, SystemAuditEvent


@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend", SECURE_SSL_REDIRECT=False, DEBUG=True, AUTH_ENCRYPTION_KEY="")
class AdministrationApiTests(TestCase):
    def test_role_levels_persist_reject_duplicates_and_preserve_audit(self):
        endpoint = "/api/v2/administration/organization-options/"
        created = self.client.post(endpoint, {"kind": "role_level", "value": " Especialista "}, format="json")
        self.assertEqual(created.status_code, 201, created.data)
        overview = self.client.get("/api/v2/administration/organization/")
        self.assertIn("Especialista", [row["value"] for row in overview.data["role_levels"]])
        duplicate = self.client.post(endpoint, {"kind": "role_level", "value": "especialista"}, format="json")
        self.assertEqual(duplicate.status_code, 400)
        inherited = JobRole.objects.exclude(level__isnull=True).exclude(level="").first()
        duplicate_existing = self.client.post(endpoint, {"kind": "role_level", "value": inherited.level.upper()}, format="json")
        self.assertEqual(duplicate_existing.status_code, 400)
        self.assertTrue(SystemAuditEvent.objects.filter(event_type="administration.catalog_option_created", target_id=created.data["id"]).exists())
        deleted = self.client.post("/api/v2/administration/roles/delete-level/", {"level": "Especialista", "confirmation": "Especialista", "confirmed": True}, format="json")
        self.assertEqual(deleted.status_code, 200, deleted.data)
        self.assertFalse(OrganizationCatalogOption.objects.filter(pk=created.data["id"]).exists())
        self.assertTrue(SystemAuditEvent.objects.filter(event_type="administration.job_role_level_deleted").exists())

    def setUp(self):
        call_command("seed_demo_data", verbosity=0)
        self.owner = UserAccount.objects.get(email="ana@bold.gt")
        self.owner.is_superuser = True
        self.owner.is_staff = True
        self.owner.save(update_fields=["is_superuser", "is_staff", "updated_at"])
        direction = OrganizationalUnit.objects.get(is_control_plane=True)
        direction_position = Position.objects.create(
            unit=direction,
            job_role=self.owner.employee.position_assignments.first().position.job_role,
            display_order=40,
        )
        self.owner_assignment = PositionAssignment.objects.create(
            employee=self.owner.employee,
            position=direction_position,
        )
        request = APIRequestFactory().get("/", REMOTE_ADDR="127.0.0.1")
        _, self.owner_session = create_session(self.owner, request, auth_strength="password_totp", mfa_verified=True)
        self.client = APIClient()
        self.client.force_authenticate(self.owner, self.owner_session)
        self.client.credentials(HTTP_X_ASSIGNMENT_ID=str(self.owner_assignment.id))

    def test_only_superuser_can_open_administration_and_sensitive_actions_require_recent_mfa(self):
        self.assertEqual(self.client.get("/api/v2/administration/dashboard/").status_code, 200)
        ordinary = UserAccount.objects.get(email="samuel@bold.gt")
        ordinary_client = APIClient(); ordinary_client.force_authenticate(ordinary)
        ordinary_client.credentials(HTTP_X_ASSIGNMENT_ID=str(ordinary.employee.position_assignments.get(is_active=True, released_at__isnull=True).id))
        self.assertEqual(ordinary_client.get("/api/v2/administration/dashboard/").status_code, 403)
        ordinary.is_superuser = True
        ordinary.save(update_fields=["is_superuser", "updated_at"])
        self.assertEqual(ordinary_client.get("/api/v2/administration/dashboard/").status_code, 403)

        weak_client = APIClient(); weak_client.force_authenticate(self.owner, AuthSession.objects.create(
            user_account=self.owner, token_hash="1" * 64, expires_at=self.owner_session.expires_at,
            auth_strength="password", credentials_version=self.owner.credentials_version,
        ))
        weak_client.credentials(HTTP_X_ASSIGNMENT_ID=str(self.owner_assignment.id))
        samuel = ordinary.employee
        response = weak_client.post(f"/api/v2/administration/employees/{samuel.id}/revoke-sessions/", {"reason": "Prueba sin MFA reciente"}, format="json")
        self.assertEqual(response.status_code, 403)
        role = JobRole.objects.first()
        response = weak_client.patch(f"/api/v2/administration/roles/{role.id}/", {"title": role.title, "reason": "Edición sin MFA reciente"}, format="json")
        self.assertEqual(response.status_code, 403)
        level = OrganizationCatalogOption.objects.create(kind="role_level", value="Especialista")
        level_url = f"/api/v2/administration/organization-options/{level.id}/"
        self.assertEqual(weak_client.patch(level_url, {"value": "Experto"}, format="json").status_code, 403)
        self.assertEqual(ordinary_client.patch(level_url, {"value": "Experto"}, format="json").status_code, 403)
        self.assertEqual(ordinary_client.patch("/api/v2/administration/organization-options/00000000-0000-0000-0000-000000000000/", {"value": "Experto"}, format="json").status_code, 403)
        self.assertEqual(self.client.patch(level_url, {"value": "Experto"}, format="json").status_code, 200)

    def test_dashboard_layout_defaults_persists_per_user_and_validates(self):
        endpoint = "/api/v2/administration/dashboard/"
        initial = self.client.get(endpoint)
        self.assertEqual(len(initial.data["layout"]), 6)
        modules_widget = next(
            widget for widget in initial.data["layout"] if widget["type"] == "modules"
        )
        self.assertTrue(modules_widget["metrics"])
        self.assertTrue(
            all(metric.startswith("module.") for metric in modules_widget["metrics"])
        )
        layout = [
            {"type": "metric", "metrics": ["organization.employees_active", "security.active_sessions"], "visualization": "bar"},
            {"type": "activity"},
        ]
        saved = self.client.put(endpoint, {"widgets": layout}, format="json")
        self.assertEqual(saved.status_code, 200, saved.data)
        self.assertEqual(self.client.get(endpoint).data["layout"], layout)

        other = UserAccount.objects.get(email="samuel@bold.gt")
        other.is_superuser = True
        other.save(update_fields=["is_superuser", "updated_at"])
        direction = OrganizationalUnit.objects.get(is_control_plane=True)
        other_position = Position.objects.create(
            unit=direction,
            job_role=JobRole.objects.create(title="Asistente de Dirección", level="executive"),
            display_order=50,
        )
        other_assignment = PositionAssignment.objects.create(employee=other.employee, position=other_position)
        other_client = APIClient(); other_client.force_authenticate(other)
        other_client.credentials(HTTP_X_ASSIGNMENT_ID=str(other_assignment.id))
        self.assertEqual(len(other_client.get(endpoint).data["layout"]), 6)

        legacy = self.client.put(endpoint, {"widgets": [{"type": "metric", "metric": "organization.accounts_active", "visualization": "circle"}]}, format="json")
        self.assertEqual(legacy.data["layout"][0]["metrics"], ["organization.accounts_active"])

        invalid_layouts = [[], layout * 5, [layout[1], layout[1]], [{"type": "unknown"}], [
            {"type": "metric", "metrics": ["organization.unknown"], "visualization": "circle"}
        ], [{"type": "metric", "metrics": ["organization.employees_active", "organization.employees_active"], "visualization": "bar"}]]
        for invalid in invalid_layouts:
            self.assertEqual(self.client.put(endpoint, {"widgets": invalid}, format="json").status_code, 400)

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

    @override_settings(ADMIN_TEMPORARY_PASSWORD_ENABLED=True)
    def test_owner_with_recent_mfa_can_create_forced_change_temporary_password(self):
        password = "Ámbar Río Seguro 2026! Z9"
        created = self.client.post("/api/v2/administration/employees/", {
            "full_name": "Acceso Temporal",
            "email": "temporal@bold.gt",
            "temporary_password": password,
        }, format="json")

        self.assertEqual(created.status_code, 201, created.data)
        self.assertEqual(created.data["credential_mode"], "temporary_password")
        account = UserAccount.objects.get(email="temporal@bold.gt")
        self.assertTrue(account.check_password(password))
        self.assertTrue(account.must_change_password)
        self.assertFalse(AuthChallenge.objects.filter(user_account=account, purpose=AuthChallenge.PURPOSE_INVITATION).exists())
        self.assertEqual(len(mail.outbox), 0)

        action = AdministrativeAction.objects.get(action_type="employee_created", target_account=account)
        event = SystemAuditEvent.objects.get(event_type="administration.employee_created", target_id=account.employee_id)
        audit_payload = json.dumps({"action": action.metadata, "changes": event.changes, "metadata": event.metadata})
        self.assertNotIn(password, audit_payload)
        self.assertIn("temporary_password", audit_payload)

        login_client = APIClient(enforce_csrf_checks=True)
        csrf_response = login_client.get("/api/v2/auth/session/")
        logged_in = login_client.post(
            "/api/v2/auth/login/",
            {"email": account.email, "password": password},
            format="json",
            HTTP_X_CSRFTOKEN=csrf_response.cookies["csrftoken"].value,
        )
        self.assertEqual(logged_in.status_code, 200, logged_in.data)
        self.assertTrue(logged_in.data["password_change_required"])

    @override_settings(ADMIN_TEMPORARY_PASSWORD_ENABLED=True)
    def test_temporary_password_creation_requires_recent_owner_mfa(self):
        weak_session = AuthSession.objects.create(
            user_account=self.owner,
            token_hash="2" * 64,
            expires_at=self.owner_session.expires_at,
            auth_strength="password",
            credentials_version=self.owner.credentials_version,
        )
        weak_client = APIClient()
        weak_client.force_authenticate(self.owner, weak_session)
        weak_client.credentials(HTTP_X_ASSIGNMENT_ID=str(self.owner_assignment.id))
        response = weak_client.post("/api/v2/administration/employees/", {
            "full_name": "Sin MFA",
            "email": "sin.mfa@bold.gt",
            "temporary_password": "Ámbar Río Seguro 2026! Z9",
        }, format="json")
        self.assertEqual(response.status_code, 403)
        self.assertFalse(UserAccount.objects.filter(email="sin.mfa@bold.gt").exists())

    def test_temporary_password_creation_is_disabled_by_default(self):
        response = self.client.post("/api/v2/administration/employees/", {
            "full_name": "Bandera Apagada",
            "email": "bandera.apagada@bold.gt",
            "temporary_password": "Ámbar Río Seguro 2026! Z9",
        }, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertFalse(UserAccount.objects.filter(email="bandera.apagada@bold.gt").exists())

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

    def test_owner_can_assign_an_open_vacant_position_to_existing_employee(self):
        target = UserAccount.objects.get(email="samuel@bold.gt")
        direction = OrganizationalUnit.objects.get(is_control_plane=True)
        position = Position.objects.create(
            unit=direction,
            job_role=JobRole.objects.first(),
            display_order=91,
            is_open=True,
        )
        response = self.client.post(
            f"/api/v2/administration/employees/{target.employee_id}/assign-position/",
            {"position": str(position.id), "reason": "Nueva responsabilidad en Dirección"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        assignment = PositionAssignment.objects.get(position=position, employee=target.employee, is_active=True)
        self.assertTrue(AdministrativeAction.objects.filter(action_type="position_assigned", target_employee=target.employee, metadata__assignment_id=str(assignment.id)).exists())
        self.assertTrue(SystemAuditEvent.objects.filter(event_type="administration.position_assigned", target_id=target.employee_id).exists())

    def test_position_assignment_requires_recent_mfa_and_an_open_vacancy(self):
        target = UserAccount.objects.get(email="samuel@bold.gt")
        direction = OrganizationalUnit.objects.get(is_control_plane=True)
        role = JobRole.objects.first()
        vacancy = Position.objects.create(unit=direction, job_role=role, display_order=92, is_open=True)
        payload = {"position": str(vacancy.id), "reason": "Asignación administrativa de prueba"}
        weak_session = AuthSession.objects.create(
            user_account=self.owner,
            token_hash="4" * 64,
            expires_at=self.owner_session.expires_at,
            auth_strength="password",
            credentials_version=self.owner.credentials_version,
        )
        weak_client = APIClient(); weak_client.force_authenticate(self.owner, weak_session)
        weak_client.credentials(HTTP_X_ASSIGNMENT_ID=str(self.owner_assignment.id))
        self.assertEqual(weak_client.post(f"/api/v2/administration/employees/{target.employee_id}/assign-position/", payload, format="json").status_code, 403)
        self.assertFalse(PositionAssignment.objects.filter(position=vacancy).exists())

        vacancy.is_open = False; vacancy.save(update_fields=["is_open"])
        closed = self.client.post(f"/api/v2/administration/employees/{target.employee_id}/assign-position/", payload, format="json")
        self.assertEqual(closed.status_code, 400)
        occupied = self.owner_assignment.position
        occupied_response = self.client.post(
            f"/api/v2/administration/employees/{target.employee_id}/assign-position/",
            {"position": str(occupied.id), "reason": "Intento sobre plaza ya ocupada"},
            format="json",
        )
        self.assertEqual(occupied_response.status_code, 400)

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

    def test_owner_can_set_employee_temporary_password_and_revoke_access(self):
        target = UserAccount.objects.get(email="samuel@bold.gt")
        original_version = target.credentials_version
        request = APIRequestFactory().get("/", REMOTE_ADDR="127.0.0.1")
        _, target_session = create_session(target, request)
        _, challenge = create_challenge(target, AuthChallenge.PURPOSE_PASSWORD_RESET, request)
        password = "Bosque Seguro Temporal 2026! Z9"

        response = self.client.post(
            f"/api/v2/administration/employees/{target.employee_id}/set-temporary-password/",
            {
                "password": password,
                "password_confirmation": password,
                "reason": "Salida inesperada del empleado",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        target.refresh_from_db(); target_session.refresh_from_db(); challenge.refresh_from_db()
        self.assertTrue(target.check_password(password))
        self.assertTrue(target.must_change_password)
        self.assertEqual(target.credentials_version, original_version + 1)
        self.assertIsNotNone(target.password_changed_at)
        self.assertIsNotNone(target_session.revoked_at)
        self.assertIsNotNone(challenge.invalidated_at)
        self.assertNotIn("password", response.data)
        action = AdministrativeAction.objects.get(action_type="temporary_password_set", target_account=target)
        audit_payload = json.dumps({"metadata": action.metadata, "response": response.data})
        self.assertNotIn(password, audit_payload)
        self.assertTrue(SystemAuditEvent.objects.filter(event_type="administration.temporary_password_set", target_id=target.employee_id).exists())
        self.assertTrue(AuthEvent.objects.filter(event_type="password.admin_reset", user_account=target, actor_account=self.owner).exists())

    def test_temporary_password_reset_requires_recent_mfa_and_cannot_target_owner(self):
        target = UserAccount.objects.get(email="samuel@bold.gt")
        original_hash = target.password
        weak_session = AuthSession.objects.create(
            user_account=self.owner,
            token_hash="3" * 64,
            expires_at=self.owner_session.expires_at,
            auth_strength="password",
            credentials_version=self.owner.credentials_version,
        )
        weak_client = APIClient(); weak_client.force_authenticate(self.owner, weak_session)
        weak_client.credentials(HTTP_X_ASSIGNMENT_ID=str(self.owner_assignment.id))
        payload = {
            "password": "Bosque Seguro Temporal 2026! Z9",
            "password_confirmation": "Bosque Seguro Temporal 2026! Z9",
            "reason": "Prueba sin MFA reciente",
        }
        denied = weak_client.post(
            f"/api/v2/administration/employees/{target.employee_id}/set-temporary-password/",
            payload,
            format="json",
        )
        self.assertEqual(denied.status_code, 403)
        target.refresh_from_db()
        self.assertEqual(target.password, original_hash)

        owner_denied = self.client.post(
            f"/api/v2/administration/employees/{self.owner.employee_id}/set-temporary-password/",
            payload,
            format="json",
        )
        self.assertEqual(owner_denied.status_code, 400)

    def test_temporary_password_reset_validates_confirmation_and_policy(self):
        target = UserAccount.objects.get(email="samuel@bold.gt")
        endpoint = f"/api/v2/administration/employees/{target.employee_id}/set-temporary-password/"
        mismatch = self.client.post(endpoint, {
            "password": "Bosque Seguro Temporal 2026! Z9",
            "password_confirmation": "Una contraseña diferente 2026!",
            "reason": "Prueba de confirmación",
        }, format="json")
        self.assertEqual(mismatch.status_code, 400)
        weak = self.client.post(endpoint, {
            "password": "12345678",
            "password_confirmation": "12345678",
            "reason": "Prueba de política",
        }, format="json")
        self.assertEqual(weak.status_code, 400)
        self.assertFalse(AdministrativeAction.objects.filter(action_type="temporary_password_set", target_account=target).exists())

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
        self.assertIn("reports_to_position", created_position)

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

    def test_owner_can_move_units_without_creating_hierarchy_cycles(self):
        unit_type = OrganizationCatalogOption.objects.filter(kind=OrganizationCatalogOption.UNIT_TYPE).first().value
        sensitivity = OrganizationCatalogOption.objects.filter(kind=OrganizationCatalogOption.SENSITIVITY).first().value
        root_a = OrganizationalUnit.objects.create(name="Área A", unit_type=unit_type, sensitivity_level=sensitivity)
        root_b = OrganizationalUnit.objects.create(name="Área B", unit_type=unit_type, sensitivity_level=sensitivity)
        child = OrganizationalUnit.objects.create(name="Equipo móvil", unit_type=unit_type, sensitivity_level=sensitivity, parent_unit=root_a)
        endpoint = f"/api/v2/administration/units/{child.id}/"

        moved = self.client.patch(endpoint, {
            "name": "Equipo reubicado",
            "unit_type": child.unit_type,
            "sensitivity_level": child.sensitivity_level,
            "parent_unit": str(root_b.id),
            "reason": "Corrección de la estructura organizacional",
        }, format="json")
        self.assertEqual(moved.status_code, 200, moved.data)
        child.refresh_from_db()
        self.assertEqual(child.parent_unit, root_b)
        self.assertEqual(child.name, "Equipo reubicado")

        descendant = OrganizationalUnit.objects.create(name="Subequipo", unit_type=unit_type, sensitivity_level=sensitivity, parent_unit=child)
        cycle = self.client.patch(endpoint, {
            "parent_unit": str(descendant.id),
            "reason": "Intento de ciclo organizacional",
        }, format="json")
        self.assertEqual(cycle.status_code, 400)
        child.refresh_from_db()
        self.assertEqual(child.parent_unit, root_b)
        self.assertTrue(SystemAuditEvent.objects.filter(event_type="administration.organizational_unit_updated", target_id=child.id).exists())

    def test_unit_deletion_is_limited_to_empty_non_control_units(self):
        direction = OrganizationalUnit.objects.get(is_control_plane=True)
        empty = OrganizationalUnit.objects.create(name="Unidad temporal", unit_type=direction.unit_type, sensitivity_level=direction.sensitivity_level)
        deleted = self.client.delete(f"/api/v2/administration/units/{empty.id}/", {"reason": "Unidad creada en ubicación incorrecta"}, format="json")
        self.assertEqual(deleted.status_code, 204, deleted.data)
        self.assertFalse(OrganizationalUnit.objects.filter(id=empty.id).exists())

        parent = OrganizationalUnit.objects.create(name="Unidad con rama", unit_type=direction.unit_type, sensitivity_level=direction.sensitivity_level)
        OrganizationalUnit.objects.create(name="Unidad hija", unit_type=direction.unit_type, sensitivity_level=direction.sensitivity_level, parent_unit=parent)
        blocked = self.client.delete(f"/api/v2/administration/units/{parent.id}/", {"reason": "Intento de eliminación con dependencias"}, format="json")
        self.assertEqual(blocked.status_code, 400)
        self.assertEqual(blocked.data["blocking_subunits"], 1)

        protected_delete = self.client.delete(f"/api/v2/administration/units/{direction.id}/", {"reason": "Intento sobre la unidad estructural"}, format="json")
        self.assertEqual(protected_delete.status_code, 400)
        protected_move = self.client.patch(f"/api/v2/administration/units/{direction.id}/", {
            "parent_unit": str(parent.id),
            "reason": "Intento de mover la unidad estructural",
        }, format="json")
        self.assertEqual(protected_move.status_code, 400)

        overview = self.client.get("/api/v2/administration/organization/")
        direction_row = next(row for row in overview.data["units"] if str(row["id"]) == str(direction.id))
        self.assertTrue(direction_row["is_control_plane"])

    def test_owner_position_is_visible_but_cannot_be_modified_even_with_recent_mfa(self):
        owner_position = self.owner_assignment.position
        overview = self.client.get("/api/v2/administration/organization/")
        row = next(item for item in overview.data["positions"] if str(item["id"]) == str(owner_position.id))
        self.assertTrue(row["is_protected"])

        response = self.client.patch(
            f"/api/v2/administration/positions/{owner_position.id}/",
            {
                "is_open": not owner_position.is_open,
                "reason": "Intento de modificar la plaza protegida",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 403, response.data)
        owner_position.refresh_from_db()
        self.assertEqual(owner_position.is_open, row["is_open"])

        deleted = self.client.delete(
            f"/api/v2/administration/positions/{owner_position.id}/",
            {"reason": "Intento de eliminar la plaza protegida"},
            format="json",
        )
        self.assertEqual(deleted.status_code, 405, getattr(deleted, "data", None))
        self.assertTrue(type(owner_position).objects.filter(pk=owner_position.id).exists())
