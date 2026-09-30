from django.apps import AppConfig


class NotificacionesConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "boldApp.notificaciones"
    label = "boldApp_notificaciones"
    verbose_name = "Bold — Módulo de Notificaciones"

    def ready(self):
        from . import signals  # noqa: F401
