import base64
from django.test import TestCase
from rest_framework.test import APIClient
from boldApp.core.models import Employee, UserAccount

class NotificationSettingsTests(TestCase):
    def setUp(self):
        self.users = [UserAccount.objects.create_user(email=f"tone{i}@bold.gt", employee=Employee.objects.create(full_name=f"Tone {i}")) for i in range(2)]
        self.client = APIClient()
        self.client.force_authenticate(self.users[0])
        self.url = "/api/v2/auth/notification-settings/"

    def test_preferences_are_saved_only_for_current_user(self):
        result = self.client.patch(self.url, {"sound": "post", "volume": 30}, format="json")
        self.assertEqual(result.status_code, 200)
        self.assertEqual(self.client.get(self.url).data["sound"], "post")
        self.client.force_authenticate(self.users[1])
        self.assertEqual(self.client.get(self.url).data["sound"], "samsung")
        self.client.force_authenticate(None)
        self.assertIn(self.client.get(self.url).status_code, [401, 403])

    def test_invalid_audio_and_values_do_not_replace_preferences(self):
        for data in [{"sound": "unknown"}, {"volume": 101}, {"sound": "custom"}, {"custom_audio": "data:text/html;base64,PHNjcmlwdD4="}, {"custom_audio": "data:audio/mpeg;base64,YmFk"}, {"user": str(self.users[1].pk)}]:
            self.assertEqual(self.client.patch(self.url, data, format="json").status_code, 400)
        audio = "data:audio/ogg;base64," + base64.b64encode(b"OggSdemo").decode()
        self.assertEqual(self.client.patch(self.url, {"custom_audio": audio, "sound": "custom", "custom_name": "demo.ogg"}, format="json").status_code, 200)
        self.assertEqual(self.client.get(self.url).data["custom_audio"], audio)
