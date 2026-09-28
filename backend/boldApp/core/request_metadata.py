from ipaddress import ip_address

from django.conf import settings


def _valid_ip(value):
    try:
        return str(ip_address(str(value or "").strip()))
    except ValueError:
        return None


def request_ip(request):
    """Returns a validated client IP without trusting forwarding headers by default."""
    if request is None:
        return None

    if settings.TRUST_CLOUDFLARE_CONNECTING_IP:
        cloudflare_ip = _valid_ip(request.META.get("HTTP_CF_CONNECTING_IP"))
        if cloudflare_ip:
            return cloudflare_ip

    return _valid_ip(request.META.get("REMOTE_ADDR"))
