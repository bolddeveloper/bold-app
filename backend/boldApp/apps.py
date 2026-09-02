from django.apps import AppConfig


# Define la configuracion de la app boldApp, nucleo del modulo de tareas.
class BoldAppConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "boldApp"
    verbose_name = "Bold App"

    def ready(self):
        from . import signals  # noqa: F401
