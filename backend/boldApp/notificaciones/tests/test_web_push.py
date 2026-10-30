import base64
import json
import uuid
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from django.conf import settings
from django.core.cache import cache
from django.test import TestCase, RequestFactory, override_settings
from django.utils import timezone
from requests import Response
from rest_framework.test import APIClient

from boldApp.autenticacion.models import AuthSession
from boldApp.autenticacion.services import create_session, decrypt_secret
from boldApp.core.models import Employee, UserAccount, OrganizationalUnit, JobRole, Position, PositionAssignment
from boldApp.notificaciones.models import PushDevice, PushDelivery, Notification
from boldApp.notificaciones.push import queue_notice, drain, send_hint
from boldApp.notificaciones.services import create_notification


def encoded(value):
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


@override_settings(WEB_PUSH_ENABLED=True, WEB_PUSH_PUBLIC_KEY="test-public-only", WEB_PUSH_PRIVATE_KEY="test-private-only",
    AUTH_ENCRYPTION_KEY="isolated-push-tests", AUTH_MFA_REQUIRED=False, AUTH_SESSION_IDLE_SECONDS=300)
class WebPushTests(TestCase):
    def setUp(self):
        cache.clear()
        unit = OrganizationalUnit.objects.create(name="Push aislado", unit_type="department", sensitivity_level="low")
        role = JobRole.objects.create(title="Pruebas")
        self.people = []
        for suffix in ("a", "b"):
            employee = Employee.objects.create(full_name="Prueba " + suffix)
            user = UserAccount.objects.create_user(email=f"push-{suffix}@bold.gt", employee=employee,
                notification_settings={"desktop_enabled": True, "enabled": True, "volume": 60})
            assignment = PositionAssignment.objects.create(employee=employee, position=Position.objects.create(unit=unit, job_role=role))
            self.people.append((user, assignment))
        self.user, self.assignment = self.people[0]
        self.client, self.session = self.client_for(self.user, self.assignment)
        private = ec.generate_private_key(ec.SECP256R1())
        self.subscription = {"endpoint": "https://fcm.googleapis.com/fcm/send/isolated-device", "expirationTime": None,
            "keys": {"auth": encoded(b"0123456789abcdef"), "p256dh": encoded(private.public_key().public_bytes(
                serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint))}}

    def client_for(self, user, assignment):
        raw, session = create_session(user, RequestFactory().get("/", REMOTE_ADDR="127.0.0.1"))
        client = APIClient(enforce_csrf_checks=True)
        client.cookies[settings.AUTH_SESSION_COOKIE_NAME] = raw
        client.get("/api/v2/auth/session/")
        client.credentials(HTTP_X_ASSIGNMENT_ID=str(assignment.pk), HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value)
        return client, session

    def register(self, client=None, subscription=None):
        response = (client or self.client).post("/api/v2/notifications/push/devices/", subscription or self.subscription, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        return PushDevice.objects.get(pk=response.data["device_id"])

    def notice(self, **extra):
        return create_notification(recipient=self.assignment, event_type="comment.created", title="Texto privado de prueba",
            body="Información que no debe salir al proveedor", **extra)

    def resolve(self, row, device, client=None, **changes):
        query = {"notification_id": str(row.pk), "device_id": str(device.pk), "binding": str(device.binding), **changes}
        return (client or self.client).get("/api/v2/notifications/push/resolve/", query)

    def test_opt_in_requires_real_session_csrf_active_own_assignment_and_valid_provider_keys(self):
        config = self.client.get("/api/v2/notifications/push/config/")
        self.assertEqual(config.status_code, 200)
        self.assertNotIn("test-private-only", json.dumps(config.data))
        self.assertIn("no-store", config["Cache-Control"])
        self.client.credentials(HTTP_X_ASSIGNMENT_ID=str(self.assignment.pk))
        self.assertEqual(self.client.post("/api/v2/notifications/push/devices/", self.subscription, format="json").status_code, 403)
        self.client.credentials(HTTP_X_ASSIGNMENT_ID=str(self.assignment.pk), HTTP_X_CSRFTOKEN=self.client.cookies["csrftoken"].value)
        for endpoint in ("http://127.0.0.1/", "https://169.254.169.254/", "https://fcm.googleapis.com.evil.example/wp/a",
                "https://evil@fcm.googleapis.com/wp/a", "https://fcm.googleapis.com:8443/wp/a", "https://example.com/push", "https://fcm.googleapis.com/wp/a#fragment"):
            with self.subTest(endpoint=endpoint):
                response = self.client.post("/api/v2/notifications/push/devices/", {**self.subscription, "endpoint": endpoint}, format="json")
                self.assertEqual(response.status_code, 400)
        for keys in ({"auth": "invalid", "p256dh": "invalid"}, {**self.subscription["keys"], "extra": "invalid"}):
            self.assertEqual(self.client.post("/api/v2/notifications/push/devices/", {**self.subscription, "keys": keys}, format="json").status_code, 400)
        device = self.register()
        self.assertNotIn("https://", device.subscription_encrypted)
        self.assertEqual(json.loads(decrypt_secret(device.subscription_encrypted))["endpoint"], self.subscription["endpoint"])
        self.assertEqual(self.register().binding, device.binding, "Idempotent renewal must not invalidate queued hints")
        self.client.credentials(HTTP_X_ASSIGNMENT_ID=str(self.people[1][1].pk))
        self.assertEqual(self.client.get("/api/v2/notifications/push/config/").status_code, 403)

    def test_resolution_is_generic_private_unread_and_does_not_extend_session_idle_lifetime(self):
        device = self.register()
        row = self.notice(metadata={"actor_is_owner": True})
        session = AuthSession.objects.get(pk=self.session.pk)
        response = self.resolve(row, device)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(set(response.data), {"allowed", "actor_is_owner", "sound"})
        self.assertNotIn(row.title, json.dumps(response.data))
        self.assertIn("no-store", response["Cache-Control"])
        self.assertEqual(AuthSession.objects.get(pk=session.pk).idle_expires_at, session.idle_expires_at)
        row.is_read = True; row.save(update_fields=["is_read"])
        self.assertEqual(self.resolve(row, device).status_code, 404)
        row.is_read = False; row.dismissed_at = timezone.now(); row.save(update_fields=["is_read", "dismissed_at"])
        self.assertEqual(self.resolve(row, device).status_code, 404)

    def test_logout_expiry_credentials_and_account_switch_reject_old_hints(self):
        device = self.register(); row = self.notice()
        other_client, _ = self.client_for(*self.people[1])
        self.assertEqual(self.resolve(row, device, other_client).status_code, 404)
        new_device = self.register(other_client)
        self.assertEqual(new_device.pk, device.pk)
        self.assertNotEqual(new_device.binding, device.binding)
        self.assertEqual(self.resolve(row, device).status_code, 404)
        rebound = self.register()
        queue_notice(row)
        self.assertEqual(self.resolve(row, rebound).status_code, 200)
        AuthSession.objects.filter(pk=self.session.pk).update(revoked_at=timezone.now())
        self.assertEqual(self.resolve(row, rebound).status_code, 401)
        with patch("boldApp.notificaciones.push.send_hint") as transport:
            drain(); transport.assert_not_called()

    def test_muted_event_permission_loss_and_expired_login_are_checked_again_at_delivery(self):
        self.register(); row = self.notice()
        self.user.notification_settings["events"] = {"comment.created": False}
        self.user.save(update_fields=["notification_settings"])
        with patch("boldApp.notificaciones.push.send_hint") as transport:
            drain(); transport.assert_not_called()
        PushDelivery.objects.all().delete()
        self.user.notification_settings["events"] = {}; self.user.save(update_fields=["notification_settings"])
        # A raw notice for an inaccessible private Chat never leaves the server.
        row.module, row.resource_type, row.resource_id = "messaging", "direct_conversation", uuid.uuid4()
        row.save(update_fields=["module", "resource_type", "resource_id"]); queue_notice(row)
        with patch("boldApp.notificaciones.push.send_hint") as transport:
            drain(); transport.assert_not_called()
        PushDelivery.objects.all().delete()
        row.module, row.resource_type, row.resource_id = "tasks", "", None
        row.save(update_fields=["module", "resource_type", "resource_id"]); queue_notice(row)
        AuthSession.objects.filter(pk=self.session.pk).update(expires_at=timezone.now() - timedelta(seconds=1))
        with patch("boldApp.notificaciones.push.send_hint") as transport:
            drain(); transport.assert_not_called()

    def test_durable_queue_deduplicates_and_emits_only_encrypted_identifier_hints(self):
        device = self.register(); row = self.notice(); queue_notice(row)
        self.assertEqual(PushDelivery.objects.count(), 1)
        with patch("boldApp.notificaciones.push.send_hint", return_value=SimpleNamespace(status_code=201)) as transport:
            self.assertEqual(drain(), 1)
            payload = transport.call_args.args[1]
            self.assertEqual(set(payload), {"v", "device_id", "binding", "notification_id", "assignment_id"})
            self.assertEqual(payload["device_id"], str(device.pk))
            self.assertNotIn(row.title, json.dumps(payload))
            self.assertEqual(drain(), 0)
            transport.assert_called_once()
        self.assertEqual(PushDelivery.objects.get().state, "sent")

    def test_retries_are_bounded_expired_and_gone_devices_are_retired(self):
        device = self.register(); self.notice()
        with patch("boldApp.notificaciones.push.send_hint", side_effect=TimeoutError()):
            for _ in range(3):
                PushDelivery.objects.update(next_attempt_at=timezone.now() - timedelta(seconds=1))
                drain()
        row = PushDelivery.objects.get()
        self.assertEqual(row.attempts, 3); self.assertEqual(row.state, "discarded")
        PushDelivery.objects.all().delete(); self.notice()
        from pywebpush import WebPushException
        response = Response(); response.status_code = 410
        with patch("boldApp.notificaciones.push.send_hint", side_effect=WebPushException("gone", response=response)):
            drain()
        device.refresh_from_db(); self.assertIsNotNone(device.revoked_at)
        self.assertEqual(PushDelivery.objects.get().state, "discarded")

    def test_real_transport_encrypts_and_disables_redirects_and_proxy_environment(self):
        key = ec.generate_private_key(ec.SECP256R1())
        private = base64.urlsafe_b64encode(key.private_bytes(serialization.Encoding.DER,
            serialization.PrivateFormat.PKCS8, serialization.NoEncryption())).decode()
        response = Response(); response.status_code = 201; response._content = b""
        with override_settings(WEB_PUSH_PRIVATE_KEY=private), patch("requests.Session.post", autospec=True, return_value=response) as post:
            send_hint(self.subscription, {"test": "never plaintext"}, 300)
            self.assertNotIn(b"never plaintext", post.call_args.kwargs["data"])
            self.assertIs(post.call_args.kwargs["allow_redirects"], False)
            self.assertEqual(post.call_args.kwargs["timeout"], (3, 6))
            self.assertEqual(str(post.call_args.kwargs["headers"]["ttl"]), "300")
            self.assertIs(post.call_args.args[0].trust_env, False)
            self.assertNotIn("x-wns-type", {key.lower(): value for key, value in post.call_args.kwargs["headers"].items()})
            send_hint({**self.subscription, "endpoint": "https://wns2-test.notify.windows.com/w/?token=isolated"}, {"v": 1}, 120)
            headers = {key.lower(): value for key, value in post.call_args.kwargs["headers"].items()}
            self.assertEqual(headers["x-wns-type"], "wns/raw")
            self.assertEqual(headers["x-wns-ttl"], "120")

    def test_credentials_idle_expiry_and_released_assignment_stop_pending_delivery(self):
        device = self.register(); self.notice()
        from boldApp.notificaciones.push import session_valid
        for change in ({"credentials_version": 0}, {"idle_expires_at": timezone.now() - timedelta(seconds=1)}):
            AuthSession.objects.filter(pk=self.session.pk).update(**change)
            session = AuthSession.objects.select_related("user_account").get(pk=self.session.pk)
            self.assertFalse(session_valid(session, self.assignment))
            with patch("boldApp.notificaciones.push.send_hint") as transport:
                drain(); transport.assert_not_called()
            AuthSession.objects.filter(pk=self.session.pk).update(credentials_version=self.user.credentials_version, idle_expires_at=timezone.now() + timedelta(minutes=5))
        self.assignment.is_active = False; self.assignment.released_at = timezone.now()
        self.assignment.save(update_fields=["is_active", "released_at"])
        self.assertFalse(session_valid(AuthSession.objects.select_related("user_account").get(pk=self.session.pk), self.assignment))

    def test_socket_failure_still_wakes_push_and_unconfigured_delivery_is_inert(self):
        from boldApp.notificaciones.events import dispatch_notification
        row = self.notice()
        with patch("boldApp.notificaciones.events.get_channel_layer", side_effect=RuntimeError()), patch("boldApp.notificaciones.push.wake_worker") as wake:
            with self.assertRaises(RuntimeError): dispatch_notification(row)
            wake.assert_called_once()
        self.register()
        with override_settings(WEB_PUSH_ENABLED=False), patch("boldApp.notificaciones.push.send_hint") as transport:
            self.notice(); self.assertEqual(drain(), 0); transport.assert_not_called()

    def test_expired_or_unqueued_provider_hints_do_not_resolve(self):
        device = self.register(); notice = self.notice()
        PushDelivery.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.resolve(notice, device).status_code, 404)
        PushDelivery.objects.all().delete()
        self.assertEqual(self.resolve(notice, device).status_code, 404)
