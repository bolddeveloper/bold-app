import secrets
from datetime import timedelta
from urllib.parse import urlsplit

from asgiref.sync import sync_to_async
from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from mcp.server.auth.provider import (
    AccessToken, AuthorizationCode, AuthorizeError, RefreshToken, RegistrationError, TokenError,
)
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken
from rest_framework.exceptions import AuthenticationFailed

from boldApp.autenticacion.services import token_hash
from boldApp.autenticacion.models import AuthSession
from .authentication import validate_authorization
from .models import McpAccessToken, McpAuthorization, McpClient, McpRefreshToken


SCOPES = ["bold.read", "bold.write"]


def public_origin():
    return settings.MCP_PUBLIC_ORIGIN.rstrip("/")


def resource_url():
    return public_origin() + "/api/v2/mcp"


def grant_queryset():
    return McpAuthorization.objects.select_related(
        "session__user_account", "source_session", "assignment__employee", "client",
    )


def access_authorization(raw_token):
    token = McpAccessToken.objects.select_related(
        "authorization__session__user_account", "authorization__assignment__employee",
        "authorization__client", "authorization__source_session",
    ).filter(token_hash=token_hash(raw_token), expires_at__gt=timezone.now()).first()
    if not token:
        raise AuthenticationFailed("La conexión MCP expiró o no es válida.")
    validate_authorization(token.authorization)
    return token


def issue_tokens(authorization, *, refresh):
    now = timezone.now()
    expires = min(now + timedelta(hours=1), authorization.session.expires_at)
    if authorization.session.idle_expires_at:
        expires = min(expires, authorization.session.idle_expires_at)
    raw = secrets.token_urlsafe(48)
    McpAccessToken.objects.create(token_hash=token_hash(raw), authorization=authorization, expires_at=expires)
    renewal = None
    if refresh:
        renewal = secrets.token_urlsafe(48)
        McpRefreshToken.objects.create(token_hash=token_hash(renewal), authorization=authorization)
    return OAuthToken(
        access_token=raw, token_type="Bearer", refresh_token=renewal,
        expires_in=max(1, int((expires - now).total_seconds())), scope=" ".join(authorization.scopes),
    )


class BoldOAuthProvider:
    @sync_to_async
    def get_client(self, client_id):
        client = McpClient.objects.filter(pk=client_id).first()
        return OAuthClientInformationFull.model_validate(client.metadata) if client else None

    @sync_to_async
    def register_client(self, client_info):
        if client_info.token_endpoint_auth_method != "none":
            raise RegistrationError("invalid_client_metadata", "BOLD requiere un cliente público con PKCE.")
        for redirect in client_info.redirect_uris:
            parsed = urlsplit(str(redirect))
            if (
                parsed.fragment or parsed.username or parsed.password
                or parsed.scheme not in {"https", "http"}
                or (parsed.scheme == "http" and parsed.hostname not in {"localhost", "127.0.0.1", "::1"})
            ):
                raise RegistrationError("invalid_redirect_uri", "Utiliza HTTPS o el retorno local de tu aplicación.")
        if len(client_info.redirect_uris) > 10:
            raise RegistrationError("invalid_client_metadata", "Demasiadas direcciones de retorno.")
        if len(client_info.model_dump_json()) > 16384:
            raise RegistrationError("invalid_client_metadata", "Los datos del cliente son demasiado grandes.")
        McpClient.objects.create(id=client_info.client_id, metadata=client_info.model_dump(mode="json"))

    @sync_to_async
    def authorize(self, client, params):
        if params.resource != resource_url():
            raise AuthorizeError("invalid_target", "El recurso solicitado no es el MCP de BOLD.")
        scopes = params.scopes or ["bold.read"]
        if not set(scopes).issubset(SCOPES) or "bold.read" not in scopes:
            raise AuthorizeError("invalid_scope", "BOLD requiere bold.read y admite bold.write.")
        secret = secrets.token_urlsafe(32)
        McpAuthorization.objects.create(
            request_hash=token_hash(secret), client_id=client.client_id,
            parameters=params.model_dump(mode="json"), scopes=scopes,
            expires_at=timezone.now() + timedelta(minutes=10),
        )
        return public_origin() + "/api/v2/mcp/consent/?request=" + secret

    @sync_to_async
    def load_authorization_code(self, client, authorization_code):
        row = grant_queryset().filter(
            code_hash=token_hash(authorization_code), client_id=client.client_id,
            consumed_at__isnull=True, expires_at__gt=timezone.now(),
        ).first()
        if not row:
            return None
        try:
            validate_authorization(row)
        except AuthenticationFailed:
            return None
        return AuthorizationCode(
            code=authorization_code, scopes=row.scopes,
            expires_at=row.expires_at.timestamp(), client_id=row.client_id,
            code_challenge=row.parameters["code_challenge"],
            redirect_uri=row.parameters["redirect_uri"],
            redirect_uri_provided_explicitly=row.parameters["redirect_uri_provided_explicitly"],
            resource=resource_url(), subject=str(row.session.user_account_id),
        )

    @sync_to_async
    @transaction.atomic
    def exchange_authorization_code(self, client, authorization_code):
        row = grant_queryset().select_for_update(of=("self",)).filter(
            code_hash=token_hash(authorization_code.code), client_id=client.client_id,
            consumed_at__isnull=True, expires_at__gt=timezone.now(),
        ).first()
        if not row:
            raise TokenError("invalid_grant", "El código expiró o ya se utilizó.")
        try:
            validate_authorization(row)
        except AuthenticationFailed as error:
            raise TokenError("invalid_grant", str(error)) from error
        now = timezone.now()
        refresh = "refresh_token" in client.grant_types
        if refresh:
            # The OAuth session survives the browser cutoff, but explicit source logout still revokes it.
            row.source_session = row.session
            row.session = AuthSession.objects.create(
                user_account=row.source_session.user_account,
                token_hash=token_hash(secrets.token_urlsafe(48)),
                device_name=("MCP · " + row.client.metadata.get("client_name", "Aplicación MCP"))[:120],
                user_agent="BOLD MCP", expires_at=now + timedelta(days=30),
                credentials_version=row.source_session.credentials_version,
                mfa_verified_at=row.source_session.mfa_verified_at,
                auth_strength=row.source_session.auth_strength,
            )
        row.consumed_at = now
        row.save(update_fields=["consumed_at", "source_session", "session"])
        return issue_tokens(row, refresh=refresh)

    @sync_to_async
    def load_refresh_token(self, client, refresh_token):
        row = grant_queryset().filter(
            refresh_tokens__token_hash=token_hash(refresh_token), client_id=client.client_id,
        ).first()
        if not row:
            return None
        try:
            validate_authorization(row)
        except AuthenticationFailed:
            return None
        return RefreshToken(
            token=refresh_token, client_id=row.client_id, scopes=row.scopes,
            expires_at=int(row.session.expires_at.timestamp()), resource=resource_url(),
            subject=str(row.session.user_account_id),
        )

    @sync_to_async
    def exchange_refresh_token(self, client, refresh_token, scopes):
        with transaction.atomic():
            row = grant_queryset().select_for_update(of=("self",)).filter(
                refresh_tokens__token_hash=token_hash(refresh_token.token), client_id=client.client_id,
            ).first()
            if not row:
                raise TokenError("invalid_grant", "La renovación no es válida.")
            try:
                validate_authorization(row)
            except AuthenticationFailed as error:
                raise TokenError("invalid_grant", str(error)) from error
            if set(scopes) != set(row.scopes):
                raise TokenError("invalid_scope", "Para cambiar los permisos debes autorizar una conexión nueva.")
            token = row.refresh_tokens.get(token_hash=token_hash(refresh_token.token))
            if not token.consumed_at:
                token.consumed_at = timezone.now()
                token.save(update_fields=["consumed_at"])
                return issue_tokens(row, refresh=True)
            # Commit family revocation before returning the replay error.
            row.revoked_at = timezone.now()
            row.save(update_fields=["revoked_at"])
        raise TokenError("invalid_grant", "La renovación ya se utilizó. Vuelve a autorizar la conexión.")

    @sync_to_async
    def load_access_token(self, token):
        try:
            row = access_authorization(token)
        except AuthenticationFailed:
            return None
        return AccessToken(
            token=token, client_id=row.authorization.client_id,
            scopes=row.authorization.scopes, expires_at=int(row.expires_at.timestamp()),
            resource=resource_url(), subject=str(row.authorization.session.user_account_id),
        )

    @sync_to_async
    def revoke_token(self, token):
        digest = token_hash(token.token)
        McpAuthorization.objects.filter(
            Q(tokens__token_hash=digest) | Q(refresh_tokens__token_hash=digest),
        ).update(revoked_at=timezone.now())
