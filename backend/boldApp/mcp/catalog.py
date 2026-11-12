"""Discover registered BOLD actions while keeping login and secrets interactive."""
import re
from dataclasses import dataclass
from functools import lru_cache

from django.urls import URLResolver, get_resolver


MODULES = {
    "home": "Inicio",
    "tasks": "Tareas y proyectos",
    "inbox": "Bandeja y notificaciones",
    "calendar": "Calendario",
    "docs": "Docs y Drive",
    "reports": "Informes",
    "sheets": "Sheets",
    "chat": "Chat",
    "slack": "Slack",
    "brands": "Marcas",
    "profile": "Perfil y preferencias",
    "organization": "Equipo y organización",
    "permissions": "Permisos",
    "administration": "Administración",
    "suggestions": "Sugerencias",
}
MODULE_SOURCES = {"home": {"tasks", "calendar", "inbox"}, "drive": {"docs"}, "reports": {"tasks", "administration"}}
PROFILE_PATHS = {
    "profile", "presence", "shortcut-settings", "notification-settings",
    "interface-settings", "private-note",
}
# Browser-only flows issue credentials, authorize external accounts or serve HTML editors.
INTERACTIVE_PARTS = {
    "oauth", "configuration", "websocket-ticket", "phone", "editor", "open-office",
    "published-view", "push", "task-drafts", "grant", "outbox-grant",
    "ticket", "draft-grants", "phone-transfers",
}


@dataclass(frozen=True)
class Operation:
    id: str
    module: str
    method: str
    path: str
    parameters: tuple
    callback: object
    action: str

    def description(self):
        return {
            "operation": self.id, "method": self.method, "path": self.path,
            "path_parameters": list(self.parameters),
            "action": self.action, "read_only": self.method == "GET",
        }


def module_for(path):
    suffix = path.removeprefix("/api/v2/")
    parts = suffix.split("/")
    first = parts[0]
    if any(part in INTERACTIVE_PARTS for part in parts):
        return None
    if first == 'assistant':
        return None  # Interactive approvals cannot be called by a model/MCP client.
    if first == "auth":
        return "profile" if len(parts) > 1 and parts[1] in PROFILE_PATHS else None
    if first == "messaging":
        return "slack" if len(parts) > 1 and parts[1] in {
            "channels", "servers", "server-order", "directory", "search",
        } else "chat"
    return {
        "notifications": "inbox", "calendar": "calendar", "workspace": "docs",
        "sheets": "sheets", "brands": "brands", "core": "organization",
        "permissions": "permissions", "administration": "administration",
        "suggestions": "suggestions",
    }.get(first, "tasks") if first not in {"google", "media", "mcp"} else None


def walk_patterns(patterns, prefix=""):
    for pattern in patterns:
        route = prefix + str(pattern.pattern)
        if isinstance(pattern, URLResolver):
            yield from walk_patterns(pattern.url_patterns, route)
        else:
            yield route, pattern.callback


@lru_cache(maxsize=1)
def operations():
    result = {}
    for route, callback in walk_patterns(get_resolver().url_patterns):
        if not route.startswith("api/v2/") or "format" in route:
            continue
        path = "/" + route.replace("^", "").replace("$", "").replace("\\Z", "")
        path = re.sub(r"\(\?P<(\w+)>[^)]+\)", r"{\1}", path)
        path = re.sub(r"<(?:\w+:)?(\w+)>", r"{\1}", path)
        if any(character in path for character in "[]()?"):
            continue
        module = module_for(path)
        cls = getattr(callback, "cls", None) or getattr(callback, "view_class", None)
        authentication = getattr(callback, "initkwargs", {}).get(
            "authentication_classes", getattr(cls, "authentication_classes", None),
        )
        if not module or cls is None or not authentication:
            continue
        actions = getattr(callback, "actions", None)
        methods = actions or {
            method: method for method in ("get", "post", "put", "patch", "delete")
            if hasattr(cls, method) and method in cls.http_method_names
        }
        for method, action in methods.items():
            if method not in {"get", "post", "put", "patch", "delete"}:
                continue
            name = re.sub(r"[^a-zA-Z0-9]+", "_", path.removeprefix("/api/v2/")).strip("_")
            identity = method + "_" + name
            result[identity] = Operation(
                identity, module, method.upper(), path,
                tuple(re.findall(r"{(\w+)}", path)), callback, action,
            )
    return result
