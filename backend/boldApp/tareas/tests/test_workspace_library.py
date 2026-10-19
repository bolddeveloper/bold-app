import io
from uuid import uuid4
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.test import TransactionTestCase, skipUnlessDBFeature
from rest_framework.test import APIClient
from boldApp.core.models import PositionAssignment


@override_settings(SECURE_SSL_REDIRECT=False)
class WorkspaceLibraryTests(TestCase):
    def setUp(self):
        call_command("seed_demo_data", verbosity=0, stdout=io.StringIO())
        self.owner = PositionAssignment.objects.get(employee__user_account__email="ana@bold.gt", is_active=True)
        self.member = PositionAssignment.objects.get(employee__user_account__email="david@bold.gt", is_active=True)
        self.client = APIClient(); self.login(self.owner)
        self.folder = {"id": str(uuid4()), "name": "Personal", "parentId": None, "color": "#ef1f2d", "projectIds": [], "taskIds": []}
        self.url = "/api/v2/workspace-library/"

    def login(self, assignment):
        self.client.force_authenticate(assignment.employee.user_account)
        self.client.credentials(HTTP_X_ASSIGNMENT_ID=str(assignment.pk))

    def test_library_durable_private_cas_and_tree_validation(self):
        body = {"revision": 0, "folders": [self.folder]}
        self.assertEqual(self.client.put(self.url, body, format="json").status_code, 200)
        self.assertEqual(self.client.put(self.url, body, format="json").status_code, 409)
        self.assertEqual(self.client.get(self.url).data["folders"][0]["name"], "Personal")
        self.login(self.member); self.assertEqual(self.client.get(self.url).data["folders"], [])
        self.login(self.owner)
        self.assertEqual(self.client.put(self.url, {"revision": 1, "folders": [{**self.folder, "parentId": self.folder["id"]}]}, format="json").status_code, 400)

    def test_cross_department_collaboration_updates_owner_library_and_conflicts(self):
        self.client.put(self.url, {"revision": 0, "folders": [self.folder]}, format="json")
        response = self.client.post("/api/v2/workspace-sharing/", {"folder_id": self.folder["id"], "folders": [self.folder], "member_ids": [str(self.member.pk)]}, format="json")
        self.assertEqual(response.status_code, 200, response.data); record = response.data
        self.login(self.member)
        self.assertEqual(len(self.client.get("/api/v2/workspace-sharing/").data["items"]), 1)
        body = {"id": record["id"], "folder_id": record["folder_id"], "revision": record["revision"], "folders": [{**self.folder, "name": "Colaboración"}]}
        self.assertEqual(self.client.patch("/api/v2/workspace-sharing/", body, format="json").status_code, 200)
        self.assertEqual(self.client.patch("/api/v2/workspace-sharing/", body, format="json").status_code, 409)
        body["revision"] += 1; body["member_ids"] = []
        self.assertEqual(self.client.patch("/api/v2/workspace-sharing/", body, format="json").status_code, 400)
        self.login(self.owner)
        self.assertEqual(self.client.get(self.url).data["folders"][0]["name"], "Colaboración")

    def test_new_links_reject_unknown_resources_without_mutating_library(self):
        folder = {**self.folder, "projectIds": [str(uuid4())]}
        self.assertEqual(self.client.put(self.url, {"revision": 0, "folders": [folder]}, format="json").status_code, 400)
        self.assertEqual(self.client.get(self.url).data, {"folders": [], "revision": 0})


@override_settings(SECURE_SSL_REDIRECT=False)
class WorkspaceLibraryConcurrencyTests(TransactionTestCase):
    @skipUnlessDBFeature("has_select_for_update")
    def test_simultaneous_first_save_and_later_updates_do_not_overwrite(self):
        from concurrent.futures import ThreadPoolExecutor
        from threading import Barrier
        from django.db import close_old_connections
        from boldApp.core.models import UserAccount
        from boldApp.tareas.models import WorkspaceLibrary

        call_command("seed_demo_data", verbosity=0, stdout=io.StringIO())
        assignment = PositionAssignment.objects.get(employee__user_account__email="ana@bold.gt", is_active=True)
        identity = str(uuid4())
        for revision in (0, 1):
            barrier = Barrier(2, timeout=10)

            def save(name):
                close_old_connections()
                try:
                    client = APIClient()
                    client.force_authenticate(UserAccount.objects.get(employee_id=assignment.employee_id))
                    client.credentials(HTTP_X_ASSIGNMENT_ID=str(assignment.pk))
                    barrier.wait()
                    return client.put("/api/v2/workspace-library/", {"revision": revision, "folders": [{
                        "id": identity, "name": name, "parentId": None, "color": "#ef1f2d", "projectIds": [], "taskIds": [],
                    }]}, format="json").status_code
                finally:
                    close_old_connections()

            with ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(save, ["Dispositivo A", "Dispositivo B"]))
            self.assertEqual(sorted(results), [200, 409])
            row = WorkspaceLibrary.objects.get(owner__employee_id=assignment.employee_id, unit=assignment.position.unit)
            self.assertEqual(row.revision, revision + 1)
            self.assertIn(row.folders[0]["name"], ["Dispositivo A", "Dispositivo B"])
