import secrets
from datetime import timedelta
from urllib.parse import urlsplit

from asgiref.sync import sync_to_async
from django.conf import settings
from django.db import transaction
from django.utils import timezone
from mcp.server.auth.provider import (
    AccessToken, AuthorizationCode, AuthorizeError, RegistrationError, TokenError,
)
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken
from rest_framework.exceptions import AuthenticationFailed

from boldApp.autenticacion.services import token_hash
from .authentication import validate_authorization
from .models import McpAccessToken, McpAuthorization, McpClient


SCOPES = ["bold.read", "bold.write"]


def public_origin():
    return settings.MCP_PUBLIC_ORIGIN.rstrip("/")


def resource_url():
    return public_origin() + "/api/v2/mcp"


def grant_queryset():
    return McpAuthorization.objects.select_related(
        "session__user_account", "assignment__employee", "client",
    )


def access_authorization(raw_token):
    token = McpAccessToken.objects.select_related(
        "authorization__session__user_account", "authorization__assignment__employee",
        "authorization__client",
    ).filter(token_hash=token_hash(raw_token), expires_at__gt=timezone.now()).first()
    if not token:
        raise AuthenticationFailed("La conexión MCP expiró o no es válida.")
    validate_authorization(token.authorization)
    return token


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
        expires = min(now + timedelta(hours=1), row.session.expires_at)
        if row.session.idle_expires_at:
            expires = min(expires, row.session.idle_expires_at)
        raw = secrets.token_urlsafe(48)
        McpAccessToken.objects.create(token_hash=token_hash(raw), authorization=row, expires_at=expires)
        row.consumed_at = now
        row.save(update_fields=["consumed_at"])
        return OAuthToken(
            access_token=raw, token_type="Bearer",
            expires_in=max(1, int((expires - now).total_seconds())), scope=" ".join(row.scopes),
        )

    async def load_refresh_token(self, client, refresh_token):
        return None

    async def exchange_refresh_token(self, client, refresh_token, scopes):
        raise TokenError("unsupported_grant_type", "Vuelve a autorizar BOLD al vencer la conexión.")

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
        McpAuthorization.objects.filter(tokens__token_hash=token_hash(token.token)).update(revoked_at=timezone.now())
