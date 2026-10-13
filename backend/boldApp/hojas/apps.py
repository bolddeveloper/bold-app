from django.apps import AppConfig


class HojasConfig(AppConfig):
    name = "boldApp.hojas"
    label = "boldApp_hojas"
    verbose_name = "BOLD - Hojas"

    def ready(self):
        from . import signals  # noqa: F401
        from boldApp.core.resource_context import register_resource_access_guard
        from .access import participates
        register_resource_access_guard("sheets", "file", participates)
