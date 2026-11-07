from django.apps import AppConfig


class McpConfig(AppConfig):
    name = "boldApp.mcp"
    label = "bold_mcp"
    verbose_name = "BOLD — Conexiones MCP"

    def ready(self):
        from django.conf import settings
        from django.core.checks import Error, register
        from urllib.parse import urlsplit

        @register()
        def check_mcp_origin(app_configs, **kwargs):
            if not settings.MCP_ENABLED:
                return []
            origin = urlsplit(settings.MCP_PUBLIC_ORIGIN)
            if (
                not origin.hostname or origin.username or origin.password or origin.query or origin.fragment
                or origin.path not in {"", "/"}
                or (origin.scheme != "https" and not (
                    settings.DEBUG and origin.scheme == "http"
                    and origin.hostname in {"localhost", "127.0.0.1", "::1"}
                ))
            ):
                return [Error("MCP_PUBLIC_ORIGIN debe ser un origen HTTPS público o localhost en desarrollo.", id="bold_mcp.E001")]
            if not settings.DEBUG and settings.CACHES.get('mcp', {}).get('BACKEND') != 'django.core.cache.backends.redis.RedisCache':
                return [Error('MCP requiere la caché compartida de Redis en producción. Configura REDIS_URL.', id='bold_mcp.E002')]
            return []
