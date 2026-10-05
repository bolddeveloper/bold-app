"""Registro desacoplado de contexto confiable para permisos sobre recursos."""


_providers = {}
_access_guards = {}


def register_resource_access_guard(module_code, resource, guard):
    """Domain participation is an additional restriction, never a permission grant."""
    _access_guards[(module_code, resource)] = guard


def resource_participation_allows(assignment, permission, resource_id):
    guard = _access_guards.get((permission.module_code, permission.resource))
    return resource_id is None or guard is None or guard(assignment, resource_id)


def register_resource_context(module_code, resource, provider):
    _providers[(module_code.strip().lower(), resource.strip().lower())] = provider


def resolve_resource_context(permission, resource_id):
    if resource_id is None:
        return {}
    provider = _providers.get((permission.module_code, permission.resource))
    if provider is None:
        return {}
    return provider(resource_id) or {}
