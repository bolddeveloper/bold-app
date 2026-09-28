import os
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase, TestCase, override_settings

from boldApp.core.request_metadata import request_ip


class RequestIPTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    @override_settings(TRUST_CLOUDFLARE_CONNECTING_IP=False)
    def test_forwarded_ip_is_ignored_by_default(self):
        request = self.factory.get(
            "/", REMOTE_ADDR="127.0.0.1", HTTP_CF_CONNECTING_IP="203.0.113.20"
        )
        self.assertEqual(request_ip(request), "127.0.0.1")

    @override_settings(TRUST_CLOUDFLARE_CONNECTING_IP=True)
    def test_cloudflare_ip_is_used_when_the_private_tunnel_is_trusted(self):
        request = self.factory.get(
            "/", REMOTE_ADDR="172.20.0.5", HTTP_CF_CONNECTING_IP="2001:db8::25"
        )
        self.assertEqual(request_ip(request), "2001:db8::25")

    @override_settings(TRUST_CLOUDFLARE_CONNECTING_IP=True)
    def test_invalid_cloudflare_ip_falls_back_to_valid_remote_address(self):
        request = self.factory.get(
            "/", REMOTE_ADDR="172.20.0.5", HTTP_CF_CONNECTING_IP="not-an-ip"
        )
        self.assertEqual(request_ip(request), "172.20.0.5")


class HealthEndpointTests(TestCase):
    @patch.dict(os.environ, {"REDIS_URL": ""})
    def test_reports_database_and_local_development_dependencies(self):
        response = self.client.get("/health/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertEqual(
            response.json(),
            {"status": "ok", "checks": {"database": True, "redis": True}},
        )
