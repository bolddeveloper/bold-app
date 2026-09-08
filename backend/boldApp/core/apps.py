from django.apps import AppConfig


# Define la configuracion del modulo nucleo (organigrama y seguridad) dentro
# del paquete boldApp. Es el primer modulo de dominio del ecosistema: expone
# la organizacion (unidades, cargos, plazas), el modelo de permisos y los
# accesos especiales/auditoria que el resto de modulos (tareas incluido, en
# su futuro rework) consultaran en vez de reimplementar su propia logica de
# autorizacion.
class CoreConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "boldApp.core"
    label = "boldApp_core"
    verbose_name = "Bold — Núcleo (Organigrama y Seguridad)"

    def ready(self):
        from . import signals  # noqa: F401
