import secrets

from django.conf import settings
from django.contrib.auth import authenticate
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.cache import cache
from django.db import transaction
from django.middleware.csrf import get_token
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from boldApp.core.models import PositionAssignment, UserAccount

from .models import AuthChallenge, AuthMFAMethod, AuthSession
from .serializers import LoginSerializer, MFADisableSerializer, MFAVerifySerializer, PasswordChangeSerializer, RecoveryConfirmSerializer, RecoveryRequestSerializer, TOTPConfirmSerializer, WebSocketTicketSerializer
from .services import consume_recovery_code, create_challenge, create_session, decrypt_secret, encrypt_secret, generate_totp_secret, issue_ws_ticket, matching_totp_counter, normalize_email, provisioning_uri, record_event, replace_recovery_codes, revoke_all_sessions, revoke_session, send_password_reset, token_hash
from .throttles import AccountThrottle, IPThrottle, MFAThrottle, RecoveryAccountThrottle, RecoveryIPThrottle, WebSocketTicketThrottle


def _set_session_cookie(response, raw, session):
    response.set_cookie(
        settings.AUTH_SESSION_COOKIE_NAME, raw,
        expires=session.expires_at, httponly=True, secure=not settings.DEBUG,
        samesite=settings.AUTH_SESSION_COOKIE_SAMESITE, path="/",
    )


def _clear_session_cookie(response):
    response.delete_cookie(settings.AUTH_SESSION_COOKIE_NAME, path="/", samesite=settings.AUTH_SESSION_COOKIE_SAMESITE)


@method_decorator(ensure_csrf_cookie, name="dispatch")
class SessionView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        get_token(request)
        if not request.user or not request.user.is_authenticated:
            return Response({"authenticated": False, "csrf_token": get_token(request)})
        mfa_enabled = request.user.mfa_methods.filter(is_active=True).exists()
        return Response({"authenticated": True, "csrf_token": get_token(request), "account": {"id": str(request.user.id), "employee": str(request.user.employee_id), "email": request.user.email}, "expires_at": request.auth.expires_at, "mfa_verified": bool(request.auth.mfa_verified_at), "mfa_enabled": mfa_enabled, "mfa_enrollment_required": settings.AUTH_MFA_REQUIRED and not mfa_enabled, "password_change_required": request.user.must_change_password})


@method_decorator(csrf_protect, name="dispatch")
class LoginView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [IPThrottle, AccountThrottle]

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"]
        user = authenticate(request=request, email=email, password=serializer.validated_data["password"])
        if not user or not user.is_active:
            record_event("login.password_failed", request, success=False, reason="invalid_credentials", metadata={"email": email})
            return Response({"detail": "Credenciales incorrectas."}, status=status.HTTP_401_UNAUTHORIZED)
        methods = list(user.mfa_methods.filter(is_active=True, method_type=AuthMFAMethod.TYPE_TOTP))
        if methods:
            challenge = secrets.token_urlsafe(32)
            cache.set(f"auth:login:{token_hash(challenge)}", str(user.id), timeout=300)
            return Response({"mfa_required": True, "challenge": challenge})
        raw, session = create_session(user, request)
        response = Response({
            "authenticated": True,
            "mfa_required": False,
            "expires_at": session.expires_at,
            "mfa_enrollment_required": settings.AUTH_MFA_REQUIRED,
            "password_change_required": user.must_change_password,
        })
        _set_session_cookie(response, raw, session)
        return response


@method_decorator(csrf_protect, name="dispatch")
class MFALoginVerifyView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [MFAThrottle]

    def post(self, request):
        serializer = MFAVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        key = f"auth:login:{token_hash(serializer.validated_data['challenge'])}"
        user_id = cache.get(key)
        user = UserAccount.objects.filter(id=user_id, is_active=True).first() if user_id else None
        if not user:
            return Response({"detail": "El desafío expiró."}, status=status.HTTP_401_UNAUTHORIZED)
        code = serializer.validated_data["code"]
        method = None; matched_counter = None
        for item in user.mfa_methods.filter(is_active=True, method_type=AuthMFAMethod.TYPE_TOTP):
            counter = matching_totp_counter(decrypt_secret(item.secret_encrypted), code)
            if counter is not None and (item.last_totp_counter is None or counter > item.last_totp_counter): method = item; matched_counter = counter; break
        if not method:
            if consume_recovery_code(user, code):
                cache.delete(key)
                raw, session = create_session(user, request, auth_strength="recovery_code", mfa_verified=True)
                record_event("mfa.recovery_code_used", request, user=user, session=session)
                response = Response({"authenticated": True, "expires_at": session.expires_at, "password_change_required": user.must_change_password}); _set_session_cookie(response, raw, session); return response
            record_event("login.mfa_failed", request, user=user, success=False, reason="invalid_code")
            return Response({"detail": "Código incorrecto."}, status=status.HTTP_401_UNAUTHORIZED)
        cache.delete(key)
        method.last_used_at = timezone.now(); method.last_totp_counter = matched_counter; method.save(update_fields=["last_used_at", "last_totp_counter"])
        raw, session = create_session(user, request, auth_strength="password_totp", mfa_verified=True)
        response = Response({"authenticated": True, "expires_at": session.expires_at, "password_change_required": user.must_change_password})
        _set_session_cookie(response, raw, session)
        return response


class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        revoke_session(request.auth, "logout", request.user)
        record_event("logout", request, user=request.user, actor=request.user, session=request.auth)
        response = Response(status=status.HTTP_204_NO_CONTENT)
        _clear_session_cookie(response)
        return response


class SessionListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        rows = request.user.auth_sessions.filter(revoked_at__isnull=True).order_by("-last_used_at")
        return Response([{"id": row.id, "client_type": row.client_type, "device_name": row.device_name, "created_at": row.created_at, "last_used_at": row.last_used_at, "expires_at": row.expires_at, "current": row.id == request.auth.id} for row in rows])


class PasswordChangeView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request):
        serializer = PasswordChangeSerializer(data=request.data, context={"user": request.user})
        serializer.is_valid(raise_exception=True)
        if not request.user.check_password(serializer.validated_data["current_password"]):
            return Response({"current_password": ["La contraseña actual es incorrecta."]}, status=status.HTTP_400_BAD_REQUEST)
        user = UserAccount.objects.select_for_update().get(id=request.user.id)
        user.set_password(serializer.validated_data["password"])
        user.password_changed_at = timezone.now(); user.must_change_password = False; user.credentials_version += 1
        user.save(update_fields=["password", "password_changed_at", "must_change_password", "credentials_version", "updated_at"])
        revoke_all_sessions(user, "password_changed", user)
        record_event("password.changed", request, user=user, actor=user)
        response = Response({"detail": "Contraseña actualizada. Inicia sesión nuevamente."})
        _clear_session_cookie(response)
        return response


class RecoveryRequestView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [RecoveryIPThrottle, RecoveryAccountThrottle]

    def post(self, request):
        serializer = RecoveryRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try: email = normalize_email(serializer.validated_data["email"])
        except ValueError: email = ""
        user = UserAccount.objects.filter(email__iexact=email, is_active=True).first()
        if user:
            raw, _ = create_challenge(user, AuthChallenge.PURPOSE_PASSWORD_RESET, request)
            send_password_reset(user, raw)
        record_event("password.reset_requested", request, user=user, metadata={"email": email})
        return Response({"detail": "Si la cuenta existe, enviaremos instrucciones al correo registrado."})


class RecoveryConfirmView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [RecoveryIPThrottle]

    @transaction.atomic
    def post(self, request):
        serializer = RecoveryConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        challenge = AuthChallenge.objects.select_for_update().select_related("user_account").filter(token_hash=token_hash(serializer.validated_data["token"]), purpose=AuthChallenge.PURPOSE_PASSWORD_RESET, consumed_at__isnull=True, invalidated_at__isnull=True, expires_at__gt=timezone.now()).first()
        if not challenge:
            return Response({"detail": "El enlace no es válido o expiró."}, status=status.HTTP_400_BAD_REQUEST)
        user = challenge.user_account
        try:
            validate_password(serializer.validated_data["password"], user)
        except DjangoValidationError as error:
            return Response({"password": error.messages}, status=status.HTTP_400_BAD_REQUEST)
        user.set_password(serializer.validated_data["password"]); user.password_changed_at = timezone.now(); user.must_change_password = False; user.credentials_version += 1
        user.save(update_fields=["password", "password_changed_at", "must_change_password", "credentials_version", "updated_at"])
        challenge.consumed_at = timezone.now(); challenge.save(update_fields=["consumed_at"])
        revoke_all_sessions(user, "password_reset")
        record_event("password.reset_completed", request, user=user)
        return Response({"detail": "Contraseña actualizada. Ya puedes iniciar sesión."})


class TOTPSetupView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        request.user.mfa_methods.filter(method_type=AuthMFAMethod.TYPE_TOTP, is_active=False).delete()
        secret = generate_totp_secret()
        method = AuthMFAMethod.objects.create(user_account=request.user, method_type=AuthMFAMethod.TYPE_TOTP, label=str(request.data.get("label") or "Aplicación autenticadora")[:80], secret_encrypted=encrypt_secret(secret))
        return Response({"method_id": method.id, "secret": secret, "provisioning_uri": provisioning_uri(request.user, secret)}, status=status.HTTP_201_CREATED)


class TOTPConfirmView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [MFAThrottle]

    @transaction.atomic
    def post(self, request):
        serializer = TOTPConfirmSerializer(data=request.data); serializer.is_valid(raise_exception=True)
        method = AuthMFAMethod.objects.select_for_update().filter(id=serializer.validated_data["method_id"], user_account=request.user, method_type=AuthMFAMethod.TYPE_TOTP, is_active=False).first()
        counter = matching_totp_counter(decrypt_secret(method.secret_encrypted), serializer.validated_data["code"]) if method else None
        if not method or counter is None:
            return Response({"detail": "Código incorrecto."}, status=status.HTTP_400_BAD_REQUEST)
        method.is_active = True; method.is_primary = not request.user.mfa_methods.filter(is_active=True).exists(); method.verified_at = timezone.now(); method.last_totp_counter = counter; method.save(update_fields=["is_active", "is_primary", "verified_at", "last_totp_counter"])
        codes = replace_recovery_codes(request.user)
        record_event("mfa.enrolled", request, user=request.user, actor=request.user, session=request.auth, metadata={"method": "totp"})
        return Response({"recovery_codes": codes})


class MFADisableView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [MFAThrottle]

    @transaction.atomic
    def post(self, request):
        serializer = MFADisableSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = UserAccount.objects.select_for_update().get(id=request.user.id)
        if not user.check_password(serializer.validated_data["current_password"]):
            record_event("mfa.disable_failed", request, user=user, actor=user, session=request.auth, success=False, reason="invalid_password")
            return Response({"current_password": ["La contraseña actual es incorrecta."]}, status=status.HTTP_400_BAD_REQUEST)

        methods = list(user.mfa_methods.select_for_update().filter(is_active=True, method_type=AuthMFAMethod.TYPE_TOTP))
        if not methods:
            return Response({"detail": "La cuenta no tiene MFA activo."}, status=status.HTTP_400_BAD_REQUEST)

        code = serializer.validated_data["code"]
        verified = False
        for method in methods:
            counter = matching_totp_counter(decrypt_secret(method.secret_encrypted), code)
            if counter is not None and (method.last_totp_counter is None or counter > method.last_totp_counter):
                verified = True
                break
        if not verified:
            verified = consume_recovery_code(user, code)
        if not verified:
            record_event("mfa.disable_failed", request, user=user, actor=user, session=request.auth, success=False, reason="invalid_code")
            return Response({"code": ["El código MFA o de recuperación es incorrecto."]}, status=status.HTTP_400_BAD_REQUEST)

        now = timezone.now()
        user.mfa_methods.filter(is_active=True).update(is_active=False, is_primary=False, disabled_at=now, disabled_by_account=user)
        user.recovery_codes.filter(used_at__isnull=True).delete()
        user.credentials_version += 1
        user.save(update_fields=["credentials_version", "updated_at"])
        revoke_all_sessions(user, "mfa_disabled", user)
        record_event("mfa.disabled", request, user=user, actor=user, session=request.auth)
        response = Response({"detail": "MFA desactivado. Inicia sesión nuevamente."})
        _clear_session_cookie(response)
        return response


class WebSocketTicketView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [WebSocketTicketThrottle]

    def post(self, request):
        serializer = WebSocketTicketSerializer(data=request.data); serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if data["channel"] == "core":
            if not request.user.is_staff:
                return Response({"detail": "No autorizado."}, status=status.HTTP_403_FORBIDDEN)
        else:
            if not data.get("assignment") or not data.get("unit") or not PositionAssignment.objects.filter(id=data["assignment"], employee_id=request.user.employee_id, is_active=True, released_at__isnull=True).exists():
                return Response({"detail": "Asignación inválida."}, status=status.HTTP_403_FORBIDDEN)
        raw = issue_ws_ticket(request.user, request.auth, data.get("assignment"), data.get("unit"), data["channel"] == "core")
        record_event("websocket.ticket_issued", request, user=request.user, session=request.auth, metadata={"channel": data["channel"]})
        return Response({"ticket": raw, "expires_in": settings.AUTH_WEBSOCKET_TICKET_TTL_SECONDS})
