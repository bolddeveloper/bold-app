import io
from uuid import uuid4
from django.core.management import call_command
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from boldApp.core.models import PositionAssignment, Permission, JobRolePermission
from boldApp.marcas.models import Brand


@override_settings(SECURE_SSL_REDIRECT=False)
class BrandTests(TestCase):
    def setUp(self):
        call_command("seed_demo_data", verbosity=0, stdout=io.StringIO())
        self.owner = PositionAssignment.objects.get(employee__user_account__email="luis@bold.gt", is_active=True)
        self.member = PositionAssignment.objects.get(employee__user_account__email="david@bold.gt", is_active=True)
        self.other = PositionAssignment.objects.get(employee__user_account__email="ana@bold.gt", is_active=True)
        self.client = APIClient(); self.login(self.owner)
        self.url = "/api/v2/brands/"

    def login(self, assignment):
        self.client.force_authenticate(assignment.employee.user_account)
        self.client.credentials(HTTP_X_ASSIGNMENT_ID=str(assignment.pk))

    def grant(self, assignment):
        for permission in Permission.objects.filter(module_code="brands"):
            JobRolePermission.objects.create(job_role=assignment.position.job_role, permission=permission, scope_type="own_unit", effect="allow", reason="Prueba explícita")

    def create_brand(self):
        response = self.client.post(self.url, {"name": "Marca Demo", "details": {"client_name": "Cliente", "paid_ads": True, "extra": {"Objetivo": "Contexto"}}}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def test_cross_department_explicit_share_edit_conflict_and_revocation(self):
        brand = self.create_brand(); endpoint = self.url + brand["id"] + "/"
        self.grant(self.member); self.login(self.member)
        self.assertEqual(self.client.get(endpoint).status_code, 404)
        self.login(self.owner)
        shared = self.client.put(endpoint + "members/", {"revision": 1, "member_ids": [str(self.member.pk)]}, format="json")
        self.assertEqual(shared.status_code, 200, shared.data)
        self.login(self.member)
        self.assertEqual(self.client.get(endpoint).status_code, 200)
        self.assertEqual(self.client.patch(endpoint, {"revision": 2, "description": "Contexto nuevo"}, format="json").status_code, 200)
        self.assertEqual(self.client.patch(endpoint, {"revision": 2, "name": "No sobrescribir"}, format="json").status_code, 409)
        self.assertEqual(self.client.put(endpoint + "members/", {"revision": 3, "member_ids": []}, format="json").status_code, 403)
        self.assertEqual(self.client.delete(endpoint + "?revision=3").status_code, 403)
        self.login(self.owner)
        self.assertEqual(self.client.put(endpoint + "members/", {"revision": 3, "member_ids": []}, format="json").status_code, 200)
        self.login(self.member); self.assertEqual(self.client.get(endpoint).status_code, 404)

    def test_permissions_logo_and_new_links_fail_closed(self):
        self.login(self.member)
        self.assertEqual(self.client.post(self.url, {"name": "Sin permiso"}, format="json").status_code, 403)
        self.login(self.owner)
        self.assertEqual(self.client.post(self.url, {"name": "Inexistente", "project_ids": [str(uuid4())]}, format="json").status_code, 400)
        self.assertEqual(self.client.post(self.url, {"name": "Logo inseguro", "logo": "https://external.example/tracking.svg"}, format="json").status_code, 400)
        self.assertFalse(Brand.objects.exists())

    def test_archives_without_deleting_projects_or_brand_record(self):
        brand = self.create_brand(); endpoint = self.url + brand["id"] + "/"
        self.assertEqual(self.client.delete(endpoint + "?revision=1").status_code, 204)
        self.assertIsNotNone(Brand.objects.get(pk=brand["id"]).archived_at)
        self.assertEqual(self.client.get(endpoint).status_code, 404)
