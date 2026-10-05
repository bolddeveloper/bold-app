from datetime import timedelta
import hashlib
import json
import secrets
from urllib.parse import urlencode, urlparse

import requests
from django.conf import settings
from django.core import signing
from django.core.cache import cache
from django.http import HttpResponse
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from boldApp.autenticacion.models import AuthSession
from boldApp.autenticacion.services import encrypt_secret
from .models import GoogleConnection
from .service import configured
from .google_config import SCOPES as SERVICE_SCOPES, credentials, configuration, public_connection

def demo_email():
    return settings.GOOGLE_WORKSPACE_DEMO_EMAIL if settings.DEBUG else ""


class ConnectionView(APIView):
    def get(self, request):
        return Response({**public_connection(request.user), "editors_enabled": settings.GOOGLE_WORKSPACE_EDITORS_ENABLED, "demo_email": demo_email()})

    def delete(self, request):
        # Unlink only this BOLD account. No files or other employees' connections are deleted.
        GoogleConnection.objects.filter(user=request.user).delete()
        return Response(status=204)


class StartView(APIView):
    def post(self, request):
        if not configured():
            raise ValidationError("El administrador todavía debe configurar el cliente Google de BOLD.")
        if not getattr(request.auth, "pk", None):
            raise PermissionDenied("Inicia sesión en BOLD antes de conectar Google.")
        service = request.data.get("service", "all")
        if service != "all" and service not in SERVICE_SCOPES:
            raise ValidationError("Servicio Google inválido.")
        # All entry points request one consent; Google can still return partial grants.
        requested_scopes = set().union(*SERVICE_SCOPES.values())
        identity, _ = credentials()
        config = configuration()
        nonce = secrets.token_urlsafe(32)
        origin = request.headers.get("Origin")
        origin = origin if origin in settings.CORS_ALLOWED_ORIGINS else settings.FRONTEND_URL.rstrip("/")
        cache.set("bold-workspace-oauth:" + nonce, str(request.auth.pk), timeout=600)
        state = signing.dumps({"session": str(request.auth.pk), "nonce": nonce, "origin": origin, "service": service, "version": config["version"]}, salt="bold-workspace")
        return Response({"authorization_url": "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode({"client_id": identity, "redirect_uri": settings.GOOGLE_WORKSPACE_REDIRECT_URI, "response_type": "code", "scope": "openid email " + " ".join(sorted(requested_scopes)), "include_granted_scopes": "true", "access_type": "offline", "prompt": "consent select_account", "login_hint": demo_email() or request.user.email, "state": state})})


def popup(status, origin=None):
    origin = origin if origin in settings.CORS_ALLOWED_ORIGINS else settings.FRONTEND_URL.rstrip("/")
    label = "Tu cuenta Google quedó conectada. Puedes volver a BOLD." if status == "connected" else "No se completó la conexión. Vuelve a BOLD e inténtalo de nuevo."
    message = json.dumps({"type": "bold:workspace", "status": status})
    return HttpResponse(f'<html lang="es"><meta charset="utf-8"><title>Conectar Google · BOLD</title><p>{label}</p><script>window.opener?.postMessage({message},{json.dumps(origin)});if({json.dumps(status)}==="connected")window.close();</script></html>')


class CallbackView(APIView):
    authentication_classes = []
    permission_classes = []

    def get(self, request):
        try:
            state = signing.loads(request.query_params.get("state", ""), salt="bold-workspace", max_age=600)
        except signing.BadSignature:
            return popup("failed")
        origin = state.get("origin")
        if state.get("version") != configuration()["version"]:
            return popup("failed", origin)
        nonce = state.get("nonce", "")
        expected = cache.get("bold-workspace-oauth:" + nonce)
        # add makes consumption atomic even if two callbacks arrive together.
        if expected != state.get("session") or not cache.add("bold-workspace-used:" + nonce, True, timeout=600):
            return popup("failed", origin)
        session = AuthSession.objects.select_related("user_account").filter(pk=expected, revoked_at__isnull=True).first()
        if not session or not session.user_account.is_active or session.expires_at <= timezone.now() or session.credentials_version != session.user_account.credentials_version or (session.idle_expires_at and session.idle_expires_at <= timezone.now()):
            return popup("failed", origin)
        if request.query_params.get("error") or not request.query_params.get("code"):
            return popup("cancelled", origin)
        try:
            identity, secret = credentials()
            response = requests.post("https://oauth2.googleapis.com/token", data={"code": request.query_params["code"], "client_id": identity, "client_secret": secret, "redirect_uri": settings.GOOGLE_WORKSPACE_REDIRECT_URI, "grant_type": "authorization_code"}, timeout=15)
            response.raise_for_status()
            token = response.json()
            profile = requests.get("https://www.googleapis.com/oauth2/v3/userinfo", headers={"Authorization": "Bearer " + token["access_token"]}, timeout=15)
            profile.raise_for_status()
            account = profile.json()
            if not account.get("email_verified") or not account.get("sub"):
                return popup("failed", origin)
            company = account["email"].lower().endswith("@" + settings.GOOGLE_WORKSPACE_COMPANY_DOMAIN.lower()) and account["email"].lower() == session.user_account.email.lower()
            demo = settings.DEBUG and account["email"].lower() == settings.GOOGLE_WORKSPACE_DEMO_EMAIL.lower()
            if not company and not demo:
                return popup("wrong_account", origin)
            previous = GoogleConnection.objects.filter(user=session.user_account, subject=account["sub"]).first()
            refresh = encrypt_secret(token["refresh_token"]) if token.get("refresh_token") else previous.refresh_token_encrypted if previous and previous.client_id in ("", identity) else ""
            if not refresh:
                return popup("failed", origin)
            granted = token.get("scope", "")
            zone = previous.time_zone if previous else "UTC"
            if SERVICE_SCOPES["calendar"] <= set(granted.split()):
                calendar = requests.get("https://www.googleapis.com/calendar/v3/calendars/primary", headers={"Authorization": "Bearer " + token["access_token"]}, params={"fields": "timeZone"}, timeout=15)
                if calendar.status_code == 200:
                    zone = calendar.json().get("timeZone", "UTC")
            GoogleConnection.objects.update_or_create(user=session.user_account, defaults={"email": account["email"], "subject": account["sub"], "client_id": identity, "time_zone": zone, "scopes": granted, "refresh_token_encrypted": refresh, "access_token_encrypted": encrypt_secret(token["access_token"]), "expires_at": timezone.now() + timedelta(seconds=token.get("expires_in", 3600))})
        except (requests.RequestException, KeyError, ValueError):
            return popup("failed", origin)
        return popup("connected", origin)
