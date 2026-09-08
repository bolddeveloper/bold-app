from django.apps import AppConfig


# Define la configuracion del modulo de tareas dentro del paquete boldApp.
# El label "boldApp_tareas" refleja la jerarquia del paquete y se usa como
# prefijo de las tablas en la base de datos (boldApp_tareas_task, etc.).
class TareasConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "boldApp.tareas"
    label = "boldApp_tareas"
    verbose_name = "Bold — Módulo de Tareas"

    def ready(self):
        from . import signals  # noqa: F401
