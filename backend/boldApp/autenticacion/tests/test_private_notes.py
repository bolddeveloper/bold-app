from django.test import TestCase
from rest_framework.test import APIClient
from boldApp.core.models import Employee, UserAccount
from ..models import PrivateNote


class PrivateNoteTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.users = [UserAccount.objects.create_user(email=f"note{i}@bold.gt", employee=Employee.objects.create(full_name=f"Note {i}")) for i in range(2)]
        self.client.force_authenticate(self.users[0])
        self.url = "/api/v2/auth/private-note/"

    def test_private_and_available_from_another_device(self):
        self.assertEqual(self.client.get(self.url).data, {"content": "", "version": 0})
        self.assertEqual(self.client.put(self.url, {"content": "<b>Personal</b>", "version": 0}, format="json").status_code, 200)
        device = APIClient()
        device.force_authenticate(self.users[0])
        self.assertEqual(device.get(self.url).data["content"], "<b>Personal</b>")
        device.force_authenticate(self.users[1])
        self.assertEqual(device.get(self.url).data["content"], "")

    def test_stale_device_cannot_overwrite(self):
        self.client.put(self.url, {"content": "First", "version": 0}, format="json")
        self.assertEqual(self.client.put(self.url, {"content": "Stale", "version": 0}, format="json").status_code, 409)
        self.assertEqual(PrivateNote.objects.get().content, "First")

    def test_requires_login_and_valid_payload(self):
        self.assertEqual(self.client.put(self.url, {"content": "x"}, format="json").status_code, 400)
        self.client.force_authenticate(None)
        self.assertIn(self.client.get(self.url).status_code, [401, 403])
