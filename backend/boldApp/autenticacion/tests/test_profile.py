import base64
import io
from django.core.management import call_command
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from boldApp.core.models import UserAccount


@override_settings(DEBUG=True, PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class ProfileTests(TestCase):
    def setUp(self):
        call_command("seed_demo_data", stdout=io.StringIO())
        self.user = UserAccount.objects.get(email="samuel@bold.gt")
        self.other = UserAccount.objects.get(email="luis@bold.gt")
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.url = "/api/v2/auth/profile/"

    def test_profile_is_private_and_updates_only_current_account(self):
        avatar = "data:image/webp;base64," + base64.b64encode(b"RIFF" + b"\x00" * 4 + b"WEBP" + b"test").decode()
        result = self.client.patch(self.url, {"name": "Nombre nuevo", "biography": "Mi biografía", "avatar_url": avatar}, format="json")
        self.assertEqual(result.status_code, 200)
        self.user.refresh_from_db(); self.other.refresh_from_db()
        self.assertEqual(self.user.employee.full_name, "Nombre nuevo")
        self.assertEqual(self.user.biography, "Mi biografía")
        self.assertEqual(self.user.avatar_url, avatar)
        self.assertFalse(self.other.biography)
        self.assertEqual(self.client.get(self.url).data["id"], str(self.user.pk))
        self.assertNotIn("password", self.client.get(self.url).data)
        self.assertEqual(self.client.patch(self.url, {"avatar_url": None}, format="json").status_code, 200)
        self.assertIsNone(self.client.get(self.url).data["avatar_url"])
        self.assertEqual(APIClient().get(self.url).status_code, 401)

    def test_invalid_photos_and_privileged_fields_never_change_identity(self):
        for fields in ({"name": " "}, {"biography": "a" * 501}, {"email": "other@bold.gt"}, {"id": str(self.other.pk)}, {"is_superuser": True}, {"avatar_url": "data:image/svg+xml;base64,c2NyaXB0"}, {"avatar_url": "data:image/webp;base64,broken"}, {"avatar_url": "data:image/webp;base64," + "a" * 410000}):
            self.assertEqual(self.client.patch(self.url, fields, format="json").status_code, 400)
        self.user.refresh_from_db()
        self.assertFalse(self.user.is_superuser)
        self.assertEqual(self.user.email, "samuel@bold.gt")

    def test_banner_color_validation_and_isolation(self):
        original = self.other.banner_color
        result = self.client.patch(self.url, {"banner_color": "#7cabdd"}, format="json")
        self.assertEqual(result.status_code, 200)
        self.user.refresh_from_db(); self.other.refresh_from_db()
        self.assertEqual(self.user.banner_color, "#7cabdd")
        self.assertEqual(self.other.banner_color, original)
        self.assertEqual(self.client.get(self.url).data["banner_color"], "#7cabdd")
        for value in ("red", "#123", "#gggggg", "url(https://example.com)", "#123456\n"):
            self.assertEqual(self.client.patch(self.url, {"banner_color": value}, format="json").status_code, 400)
