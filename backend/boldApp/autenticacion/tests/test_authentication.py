import re
import time as time_module
from datetime import time
from zoneinfo import ZoneInfo

from django.core import mail
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from boldApp.core.models import Employee, UserAccount

from ..models import AuthEvent, AuthSession
from ..services import consume_ws_ticket, next_daily_cutoff, totp_code


@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend", SECURE_SSL_REDIRECT=False, DEBUG=True, AUTH_ENCRYPTION_KEY="")
class AuthenticationFlowTests(TestCase):
    password = "Una frase segura 2026!"

    def setUp(self):
        cache.clear()
        employee = Employee.objects.create(full_name="Ana Seguridad")
        self.user = UserAccount.objects.create_user(email="ana.seguridad@bold.gt", employee=employee, password=self.password, is_staff=True)
        self.client = APIClient(enforce_csrf_checks=True)

    def csrf(self):
        response = self.client.get("/api/v2/auth/session/")
        self.assertEqual(response.status_code, 200)
        return self.client.cookies["csrftoken"].value

    def post(self, path, data):
        return self.client.post(path, data, format="json", HTTP_X_CSRFTOKEN=self.client.cookies["csrftoken"].value)

    def login(self):
        self.csrf()
        response = self.post("/api/v2/auth/login/", {"email": self.user.email, "password": self.password})
        self.assertEqual(response.status_code, 200, getattr(response, "data", None))
        return response

    def test_cookie_session_is_opaque_http_only_and_expires_at_next_guatemala_cutoff(self):
        response = self.login()
        cookie = response.cookies["bold_session"]
        self.assertTrue(cookie["httponly"])
        self.assertNotIn(cookie.value, AuthSession.objects.values_list("token_hash", flat=True))
        session = AuthSession.objects.get()
        local_expiry = session.expires_at.astimezone(ZoneInfo("America/Guatemala"))
        self.assertEqual(local_expiry.timetz().replace(tzinfo=None), time(7, 0))
        self.assertIsNone(session.idle_expires_at)
        restored = self.client.get("/api/v2/auth/session/")
        self.assertTrue(restored.data["authenticated"])

    def test_login_requires_csrf_and_rejects_non_corporate_email(self):
        rejected = self.client.post("/api/v2/auth/login/", {"email": self.user.email, "password": self.password}, format="json")
        self.assertEqual(rejected.status_code, 403)
        self.csrf()
        outside = self.post("/api/v2/auth/login/", {"email": "ana@example.com", "password": self.password})
        self.assertEqual(outside.status_code, 400)

    def test_totp_enrollment_login_and_replay_protection(self):
        self.login()
        setup = self.post("/api/v2/auth/mfa/totp/setup/", {"label": "Teléfono"})
        self.assertEqual(setup.status_code, 201)
        code = totp_code(setup.data["secret"])
        confirmed = self.post("/api/v2/auth/mfa/totp/confirm/", {"method_id": setup.data["method_id"], "code": code})
        self.assertEqual(confirmed.status_code, 200)
        self.assertEqual(len(confirmed.data["recovery_codes"]), 10)
        self.assertTrue(self.client.get("/api/v2/auth/session/").data["mfa_enabled"])
        self.post("/api/v2/auth/logout/", {})
        first = self.post("/api/v2/auth/login/", {"email": self.user.email, "password": self.password})
        self.assertTrue(first.data["mfa_required"])
        next_code = totp_code(setup.data["secret"], time_module.time() + 30)
        verified = self.post("/api/v2/auth/mfa/verify/", {"challenge": first.data["challenge"], "code": next_code})
        self.assertEqual(verified.status_code, 200)
        second = self.post("/api/v2/auth/login/", {"email": self.user.email, "password": self.password})
        replay = self.post("/api/v2/auth/mfa/verify/", {"challenge": second.data["challenge"], "code": next_code})
        self.assertEqual(replay.status_code, 401)

        wrong_password = self.post("/api/v2/auth/mfa/disable/", {"current_password": "incorrecta", "code": confirmed.data["recovery_codes"][0]})
        self.assertEqual(wrong_password.status_code, 400)
        disabled = self.post("/api/v2/auth/mfa/disable/", {"current_password": self.password, "code": confirmed.data["recovery_codes"][0]})
        self.assertEqual(disabled.status_code, 200, disabled.data)
        self.assertFalse(self.user.mfa_methods.filter(is_active=True).exists())
        self.assertFalse(self.user.recovery_codes.filter(used_at__isnull=True).exists())
        self.assertFalse(AuthSession.objects.filter(user_account=self.user, revoked_at__isnull=True).exists())
        self.assertTrue(AuthEvent.objects.filter(event_type="mfa.disabled", user_account=self.user).exists())

    @override_settings(AUTH_MFA_REQUIRED=True)
    def test_required_mfa_enrollment_is_gated_but_setup_remains_available(self):
        login = self.login()
        self.assertTrue(login.data["mfa_enrollment_required"])
        blocked = self.client.get("/api/v2/core/employees/")
        self.assertEqual(blocked.status_code, 403)
        setup = self.post("/api/v2/auth/mfa/totp/setup/", {"label": "Trabajo"})
        confirmed = self.post("/api/v2/auth/mfa/totp/confirm/", {"method_id": setup.data["method_id"], "code": totp_code(setup.data["secret"])})
        self.assertEqual(confirmed.status_code, 200)
        session = self.client.get("/api/v2/auth/session/")
        self.assertFalse(session.data["mfa_enrollment_required"])
        self.assertEqual(self.client.get("/api/v2/core/employees/").status_code, 200)

    def test_admin_password_reset_requires_mfa_and_forces_target_to_change_it(self):
        self.login()
        target_employee = Employee.objects.create(full_name="Cuenta Reasignada")
        target = UserAccount.objects.create_user(email="reasignada@bold.gt", employee=target_employee, password="Anterior segura 2026!")
        endpoint = f"/api/v2/core/user-accounts/{target.id}/"
        blocked = self.client.patch(endpoint, {"password": "Temporal segura 2027!"}, format="json", HTTP_X_CSRFTOKEN=self.client.cookies["csrftoken"].value)
        self.assertEqual(blocked.status_code, 400)

        setup = self.post("/api/v2/auth/mfa/totp/setup/", {"label": "Administración"})
        self.post("/api/v2/auth/mfa/totp/confirm/", {"method_id": setup.data["method_id"], "code": totp_code(setup.data["secret"])})
        self.post("/api/v2/auth/logout/", {})
        challenge = self.post("/api/v2/auth/login/", {"email": self.user.email, "password": self.password})
        verified = self.post("/api/v2/auth/mfa/verify/", {"challenge": challenge.data["challenge"], "code": totp_code(setup.data["secret"], time_module.time() + 30)})
        self.assertEqual(verified.status_code, 200)
        reset = self.client.patch(endpoint, {"password": "Temporal segura 2027!"}, format="json", HTTP_X_CSRFTOKEN=self.client.cookies["csrftoken"].value)
        self.assertEqual(reset.status_code, 200, reset.data)
        target.refresh_from_db()
        self.assertTrue(target.must_change_password)
        self.assertEqual(target.credentials_version, 2)
        self.assertTrue(AuthEvent.objects.filter(event_type="password.admin_reset", user_account=target, actor_account=self.user).exists())

        target_client = APIClient(enforce_csrf_checks=True)
        target_client.get("/api/v2/auth/session/")
        csrf = target_client.cookies["csrftoken"].value
        target_login = target_client.post("/api/v2/auth/login/", {"email": target.email, "password": "Temporal segura 2027!"}, format="json", HTTP_X_CSRFTOKEN=csrf)
        self.assertTrue(target_login.data["password_change_required"])
        self.assertEqual(target_client.get(f"/api/v2/core/employees/{target.employee_id}/").status_code, 403)
        changed = target_client.post("/api/v2/auth/password/change/", {"current_password": "Temporal segura 2027!", "password": "Definitiva segura 2028!"}, format="json", HTTP_X_CSRFTOKEN=csrf)
        self.assertEqual(changed.status_code, 200, changed.data)
        target.refresh_from_db()
        self.assertFalse(target.must_change_password)

    def test_password_reset_is_single_use_and_revokes_sessions(self):
        self.login()
        requested = self.client.post("/api/v2/auth/password/reset/request/", {"email": self.user.email}, format="json")
        self.assertEqual(requested.status_code, 200)
        token = re.search(r"reset_token=([^\s]+)", mail.outbox[0].body).group(1)
        changed = self.client.post("/api/v2/auth/password/reset/confirm/", {"token": token, "password": "Otra frase segura 2027!"}, format="json")
        self.assertEqual(changed.status_code, 200, changed.data)
        reused = self.client.post("/api/v2/auth/password/reset/confirm/", {"token": token, "password": "Otra frase segura 2028!"}, format="json")
        self.assertEqual(reused.status_code, 400)
        self.assertFalse(AuthSession.objects.filter(revoked_at__isnull=True).exists())
        self.assertTrue(AuthEvent.objects.filter(event_type="password.reset_completed").exists())

    def test_staff_websocket_ticket_is_single_use(self):
        self.login()
        response = self.post("/api/v2/auth/websocket-ticket/", {"channel": "core"})
        self.assertEqual(response.status_code, 200)
        self.assertIsNotNone(consume_ws_ticket(response.data["ticket"]))
        self.assertIsNone(consume_ws_ticket(response.data["ticket"]))

    def test_cutoff_function_always_targets_seven_am_guatemala(self):
        cutoff = next_daily_cutoff()
        self.assertEqual(cutoff.astimezone(ZoneInfo("America/Guatemala")).hour, 7)
