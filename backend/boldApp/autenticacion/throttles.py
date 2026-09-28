import hashlib

from rest_framework.throttling import SimpleRateThrottle

from boldApp.core.request_metadata import request_ip


class IPThrottle(SimpleRateThrottle):
    scope = "auth_login_ip"

    def parse_rate(self, rate):
        if rate and "/" in rate:
            count, period = rate.split("/", 1)
            if period.endswith("min") and period[:-3].isdigit():
                return int(count), int(period[:-3]) * 60
        return SimpleRateThrottle.parse_rate(self, rate)

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": request_ip(request) or "unknown"}


class AccountThrottle(SimpleRateThrottle):
    scope = "auth_login_account"

    parse_rate = IPThrottle.parse_rate

    def get_cache_key(self, request, view):
        email = str(request.data.get("email", "")).strip().lower()
        ident = hashlib.sha256(email.encode()).hexdigest()
        return self.cache_format % {"scope": self.scope, "ident": ident}


class MFAThrottle(IPThrottle):
    scope = "auth_mfa"


class MFAEnrollmentThrottle(IPThrottle):
    scope = "auth_mfa_enrollment"

    def get_cache_key(self, request, view):
        ident = str(request.user.pk) if request.user and request.user.is_authenticated else request_ip(request) or "unknown"
        return self.cache_format % {"scope": self.scope, "ident": ident}


class RecoveryIPThrottle(IPThrottle):
    scope = "auth_recovery_ip"


class RecoveryAccountThrottle(AccountThrottle):
    scope = "auth_recovery_account"


class WebSocketTicketThrottle(IPThrottle):
    scope = "auth_websocket_ticket"
