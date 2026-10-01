"""Registro desacoplado de contexto confiable para permisos sobre recursos."""


_providers = {}


def register_resource_context(module_code, resource, provider):
    _providers[(module_code.strip().lower(), resource.strip().lower())] = provider


def resolve_resource_context(permission, resource_id):
    if resource_id is None:
        return {}
    provider = _providers.get((permission.module_code, permission.resource))
    if provider is None:
        return {}
    return provider(resource_id) or {}
