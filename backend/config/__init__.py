# Expone la app de Celery para que @shared_task se registre correctamente
# apenas se importa el paquete config (patron estandar de Django+Celery).

from .celery import app as celery_app


__all__ = ("celery_app",)
