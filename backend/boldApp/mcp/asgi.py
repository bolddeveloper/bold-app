import hashlib
import logging
from functools import lru_cache
from urllib.parse import urlsplit

from asgiref.sync import sync_to_async, ThreadSensitiveContext
from django.conf import settings
from django.core.cache import caches
from django.db import close_old_connections
from django.http import HttpRequest
from django.utils import timezone
from mcp.server.auth.handlers.metadata import MetadataHandler
from mcp.server.auth.routes import build_metadata, create_auth_routes, create_protected_resource_routes, cors_middleware
from mcp.server.auth.settings import ClientRegistrationOptions, RevocationOptions
from mcp.server.transport_security import TransportSecuritySettings
from pydantic import AnyHttpUrl
from rest_framework.exceptions import AuthenticationFailed
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route
from starlette.applications import Starlette

from .dispatcher import MAX_BODY_BYTES
from .oauth import BoldOAuthProvider, SCOPES, access_authorization, public_origin, resource_url
from .server import build_server
from boldApp.core.request_metadata import request_ip


logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def oauth_app():
    issuer = public_origin() + "/api/v2/mcp/oauth"
    registration = ClientRegistrationOptions(enabled=True, valid_scopes=SCOPES, default_scopes=["bold.read"])
    revocation = RevocationOptions(enabled=True)
    routes = create_auth_routes(
        BoldOAuthProvider(), issuer_url=AnyHttpUrl(issuer),
        client_registration_options=registration, revocation_options=revocation,
    )
    routes = [
        Route("/api/v2/mcp/oauth" + route.path, route.app, methods=route.methods)
        for route in routes if route.path != "/.well-known/oauth-authorization-server"
    ]
    metadata = build_metadata(AnyHttpUrl(issuer), None, registration, revocation)
    metadata.grant_types_supported = ["authorization_code"]
    metadata.token_endpoint_auth_methods_supported = ["none"]
    metadata.revocation_endpoint_auth_methods_supported = ["none"]
    routes.append(Route(
        "/.well-known/oauth-authorization-server/api/v2/mcp/oauth",
        cors_middleware(MetadataHandler(metadata).handle, ["GET", "OPTIONS"]), methods=["GET", "OPTIONS"],
    ))
    routes.extend(create_protected_resource_routes(
        AnyHttpUrl(resource_url()), [AnyHttpUrl(issuer)], scopes_supported=SCOPES, resource_name="BOLD",
    ))
    return Starlette(routes=routes)


@sync_to_async
def within_rate_limit(scope, identity):
    bucket = int(timezone.now().timestamp()) // 60
    group = "rpc" if scope["path"] == "/api/v2/mcp" else "oauth"
    key = "mcp.rate:" + group + ":" + hashlib.sha256(identity.encode()).hexdigest() + ":" + str(bucket)
    cache = caches['mcp']
    cache.add(key, 0, 120)
    return cache.incr(key) <= (120 if group == "rpc" else 30)


class McpHTTP:
    def __init__(self, fallback):
        self.fallback = fallback

    async def __call__(self, scope, receive, send):
        path = scope.get("path", "")
        oauth_path = path.startswith("/api/v2/mcp/oauth/") or path in {
            "/.well-known/oauth-authorization-server/api/v2/mcp/oauth",
            "/.well-known/oauth-protected-resource/api/v2/mcp",
        }
        if not settings.MCP_ENABLED or (path != "/api/v2/mcp" and not oauth_path):
            return await self.fallback(scope, receive, send)
        async def private_send(message):
            if message['type'] == 'http.response.start':
                headers = [(key,value) for key,value in message.get('headers', []) if key.lower() not in (b'cache-control',b'referrer-policy')]
                message = {**message, 'headers': headers + [(b'cache-control',b'no-store'),(b'referrer-policy',b'no-referrer')]}
            await send(message)
        async with ThreadSensitiveContext():
            await sync_to_async(close_old_connections)()
            try:
                await self.handle(scope, receive, private_send, oauth_path)
            finally:
                await sync_to_async(close_old_connections)()

    async def handle(self, scope, receive, send, oauth_path):
        path = scope["path"]
        request = Request(scope)
        raw = request.headers.get("authorization", "")
        client_address = scope.get("client") or ("unknown",)
        client_request = HttpRequest()
        client_request.META = {
            "REMOTE_ADDR": str(client_address[0]),
            "HTTP_CF_CONNECTING_IP": request.headers.get("cf-connecting-ip", ""),
        }
        identity = request_ip(client_request) or "unknown"
        try:
            allowed = await within_rate_limit(scope, identity)
        except Exception:
            logger.exception("El límite de solicitudes MCP no está disponible")
            return await JSONResponse({"detail": "MCP no está disponible temporalmente."}, status_code=503)(scope, receive, send)
        if not allowed:
            return await JSONResponse(
                {"detail": "Demasiadas solicitudes. Intenta de nuevo en un minuto."},
                status_code=429, headers={"Retry-After": "60"},
            )(scope, receive, send)
        if oauth_path:
            if scope['method'] == 'POST':
                body = bytearray()
                while True:
                    frame = await receive()
                    if frame['type'] == 'http.disconnect':
                        return
                    body.extend(frame.get('body', b''))
                    if len(body) > 32768:
                        return await JSONResponse({'detail': 'La solicitud OAuth supera 32 KB.'}, status_code=413)(scope, receive, send)
                    if not frame.get('more_body', False):
                        break
                original_receive = receive
                pending = True
                async def receive():
                    nonlocal pending
                    if pending:
                        pending = False
                        return {'type': 'http.request', 'body': bytes(body), 'more_body': False}
                    return await original_receive()
            return await oauth_app()(scope, receive, send)
        try:
            scheme, token = raw.split(" ", 1)
            if scheme.lower() != "bearer" or not token:
                raise ValueError
            await sync_to_async(access_authorization)(token)
        except (ValueError, AuthenticationFailed):
            return await JSONResponse(
                {"detail": "Autoriza la conexión con tu cuenta de BOLD."},
                status_code=401, headers={
                    "WWW-Authenticate": 'Bearer resource_metadata="' + public_origin() + '/.well-known/oauth-protected-resource/api/v2/mcp"',
                    "Cache-Control": "no-store",
                },
            )(scope, receive, send)
        host = urlsplit(public_origin()).netloc
        app = build_server(token).streamable_http_app(
            streamable_http_path="/api/v2/mcp", stateless_http=True, json_response=True,
            max_request_body_size=MAX_BODY_BYTES,
            transport_security=TransportSecuritySettings(
                allowed_hosts=[host, "backend", "localhost:*", "127.0.0.1:*"],
                allowed_origins=[public_origin()],
            ),
        )
        # Daphne does not drive ASGI lifespan. Each stateless request owns its SDK runtime.
        async with app.router.lifespan_context(app):
            await app(scope, receive, send)
