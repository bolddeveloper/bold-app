from copy import deepcopy
from io import StringIO
from unittest.mock import patch
import uuid

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from boldApp.core.authorization import resolve_access
from boldApp.core.models import Employee, JobRole, JobRolePermission, OrganizationalUnit, Permission, PermissionAuditLog, Position, PositionAssignment, UserAccount
from boldApp.hojas.document import blank
from boldApp.hojas.models import Member, Workbook


@override_settings(SHEETS_PILOT_ENABLED=True, SECURE_SSL_REDIRECT=False)
class SheetsPilotTests(TestCase):
    def setUp(self):
        self.it = OrganizationalUnit.objects.create(name="Equipo de IT", unit_type="team", sensitivity_level="low")
        self.other = OrganizationalUnit.objects.create(name="Otro equipo", unit_type="team", sensitivity_level="low")
        self.role = JobRole.objects.create(title="Desarrollador Full Stack Junior")
        employee = Employee.objects.create(full_name="Persona del piloto")
        self.account = UserAccount.objects.create_user(email="pilot@bold.gt", employee=employee, password="Test-password-2026!", is_superuser=True)
        self.assignment = PositionAssignment.objects.create(employee=employee, position=Position.objects.create(unit=self.it, job_role=self.role))
        self.outside = PositionAssignment.objects.create(employee=employee, position=Position.objects.create(unit=self.other, job_role=self.role))
        self.settings_override = override_settings(SHEETS_PILOT_UNIT_IDS=(str(self.it.pk),))
        self.settings_override.enable()
        self.addCleanup(self.settings_override.disable)
        self.client = APIClient()
        self.client.force_authenticate(self.account)
        self.client.credentials(HTTP_X_ASSIGNMENT_ID=str(self.outside.pk))

    def test_only_active_it_assignment_passes_even_for_same_account_and_role(self):
        for permission in Permission.objects.filter(code__startswith="sheets."):
            self.assertTrue(resolve_access(self.assignment, permission, self.it).allowed)
            denied = resolve_access(self.outside, permission, self.other)
            self.assertFalse(denied.allowed)
            self.assertEqual(denied.reason_code, "sheets_pilot_restricted")
        self.assignment.is_active = False
        self.assignment.save()
        self.assertFalse(resolve_access(self.assignment, Permission.objects.get(code="sheets.file.read"), self.it).allowed)

    def test_normal_permissions_and_denials_still_apply_inside_it(self):
        self.account.is_superuser = False
        self.account.save()
        permission = Permission.objects.get(code="sheets.file.read")
        self.assertFalse(resolve_access(self.assignment, permission, self.it).allowed)
        rule = JobRolePermission.objects.create(job_role=self.role, permission=permission, scope_type="own_unit", effect="allow")
        self.assertTrue(resolve_access(self.assignment, permission, self.it).allowed)
        self.assertFalse(resolve_access(self.outside, permission, self.other).allowed)
        rule.effect = "deny"
        rule.save()
        self.assertFalse(resolve_access(self.assignment, permission, self.it).allowed)

    def test_empty_or_wrong_allowlist_is_closed_and_other_modules_unchanged(self):
        permission = Permission.objects.get(code="sheets.file.read")
        for identities in ((), (str(uuid.uuid4()),)):
            with self.settings(SHEETS_PILOT_UNIT_IDS=identities):
                self.assertFalse(resolve_access(self.assignment, permission, self.it).allowed)
        for permission in Permission.objects.exclude(code__startswith="sheets."):
            pilot = resolve_access(self.outside, permission, self.other)
            with self.settings(SHEETS_PILOT_ENABLED=False):
                normal = resolve_access(self.outside, permission, self.other)
            self.assertEqual((pilot.allowed, pilot.reason_code), (normal.allowed, normal.reason_code), permission.code)
        with self.settings(SHEETS_PILOT_ENABLED=False):
            self.assertTrue(resolve_access(self.outside, Permission.objects.get(code="sheets.file.read"), self.other).allowed)

    def test_library_authorization_and_file_endpoints_block_non_it_owner(self):
        document = blank("Piloto")
        file = Workbook.objects.create(owner=self.account, creator=self.assignment, name="Piloto", document=document)
        response = self.client.post("/api/v2/core/authorize/", {"assignment": str(self.outside.pk), "permission_code": "sheets.file.read", "target_unit": str(self.it.pk)}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(response.data["allowed"])
        for endpoint in ("library/", "directory/", f"files/{file.pk}/", f"files/{file.pk}/export/"):
            self.assertEqual(self.client.get("/api/v2/sheets/" + endpoint).status_code, 403, endpoint)
        response = self.client.post("/api/v2/sheets/files/", {"id": str(uuid.uuid4()), "name": "No crear", "is_template": True}, format="json")
        self.assertEqual(response.status_code, 403)
        self.client.credentials(HTTP_X_ASSIGNMENT_ID=str(self.assignment.pk))
        self.assertEqual(self.client.get("/api/v2/sheets/library/").status_code, 200)

    def test_sharing_does_not_admit_people_outside_pilot(self):
        employee = Employee.objects.create(full_name="Persona externa al piloto")
        account = UserAccount.objects.create_user(email="outside@bold.gt", employee=employee, password="Test-password-2026!", is_superuser=True)
        assignment = PositionAssignment.objects.create(employee=employee, position=Position.objects.create(unit=self.other, job_role=self.role))
        file = Workbook.objects.create(owner=self.account, creator=self.assignment, name="Compartido", document=blank("Compartido"))
        Member.objects.create(workbook=file, account=account, role="editor")
        self.client.force_authenticate(account)
        self.client.credentials(HTTP_X_ASSIGNMENT_ID=str(assignment.pk))
        self.assertEqual(self.client.get(f"/api/v2/sheets/files/{file.pk}/").status_code, 403)

    def test_preflight_checks_excel_without_writing_files_or_audits(self):
        def respond(endpoint, document, **kwargs):
            result = deepcopy(document)
            if endpoint == "export":
                return b"PK-test-xlsx"
            if endpoint == "calculate":
                result["sheets"][result["sheetOrder"][0]]["cellData"]["2"]["0"]["v"] = 50
            return {"document": result}
        counts = (Workbook.objects.count(), PermissionAuditLog.objects.count())
        with patch("boldApp.hojas.management.commands.sheets_preflight.engine.call", side_effect=respond) as engine:
            output = StringIO()
            call_command("sheets_preflight", stdout=output)
            self.assertIn("Excel:", output.getvalue())
            self.assertEqual(engine.call_count, 3)
        self.assertEqual((Workbook.objects.count(), PermissionAuditLog.objects.count()), counts)

    def test_preflight_rejects_unconfigured_unknown_or_unprivileged_pilot(self):
        for identities in ((), ("invalid",), (str(uuid.uuid4()),)):
            with self.settings(SHEETS_PILOT_UNIT_IDS=identities), self.assertRaises(CommandError):
                call_command("sheets_preflight", stdout=StringIO())
        self.account.is_superuser = False
        self.account.save()
        with self.assertRaises(CommandError):
            call_command("sheets_preflight", stdout=StringIO())

