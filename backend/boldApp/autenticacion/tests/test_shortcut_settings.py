from django.test import TestCase
from rest_framework.test import APIClient
from boldApp.core.models import Employee, UserAccount

class ShortcutSettingsTests(TestCase):
    def test_shortcuts_validate_conflicts_and_are_isolated_per_user(self):
        users = [UserAccount.objects.create_user(email=f"shortcut{i}@bold.gt", employee=Employee.objects.create(full_name=f"Shortcut {i}")) for i in range(2)]
        client = APIClient()
        url = "/api/v2/auth/shortcut-settings/"
        client.force_authenticate(users[0])
        self.assertEqual(client.put(url, {"tasks": "Ctrl+Alt+Z", "drive": ""}, format="json").status_code, 200)
        self.assertEqual(client.get(url).data["tasks"], "Ctrl+Alt+Z")
        for data in [{"tasks": "Ctrl+Shift+5"}, {"tasks": "Ctrl+S"}, {"tasks": "A"}, {"tasks": ["Ctrl+K"]}, {"user": str(users[1].pk)}]:
            self.assertEqual(client.put(url, data, format="json").status_code, 400)
        self.assertEqual(client.get(url).data["tasks"], "Ctrl+Alt+Z")
        client.force_authenticate(users[1])
        self.assertEqual(client.get(url).data["tasks"], "Ctrl+Shift+2")
        client.force_authenticate(None)
        self.assertIn(client.get(url).status_code, [401, 403])
