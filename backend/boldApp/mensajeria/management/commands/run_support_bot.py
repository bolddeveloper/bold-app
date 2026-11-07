import logging
import shutil
import subprocess
import signal
from threading import Event
from uuid import UUID

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import close_old_connections
from django.core.cache import caches
from django.utils import timezone

from boldApp.core.models import OrganizationalUnit
from boldApp.mensajeria.support_bot import configure_identity, drain


logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = 'Responde a @soportebold con la cuenta de ChatGPT conectada a Codex en este host.'

    def add_arguments(self, parser):
        parser.add_argument('--unit', default=settings.BOLD_SUPPORT_UNIT_ID, help='Departamento de la identidad; por defecto BOLD_SUPPORT_UNIT_ID.')
        parser.add_argument('--once', action='store_true')
        parser.add_argument('--check', action='store_true', help='Verifica configuración y sesión sin crear identidad, responder ni consumir modelo.')
        parser.add_argument('--interval', type=float, default=2)

    def handle(self, *args, **options):
        if not settings.BOLD_SUPPORT_ENABLED:
            raise CommandError('Activa BOLD_SUPPORT_ENABLED para iniciar el bot.')
        if options['interval'] < 1:
            raise CommandError('El intervalo mínimo es un segundo.')
        if settings.BOLD_SUPPORT_DAILY_LIMIT < 1 or settings.BOLD_SUPPORT_USER_DAILY_LIMIT < 1:
            raise CommandError('Los límites diarios de soporte deben ser positivos.')
        if not settings.DEBUG and (
            settings.CHANNEL_LAYERS['default']['BACKEND'] != 'channels_redis.core.RedisChannelLayer'
            or settings.CACHES['support']['BACKEND'] != 'django.core.cache.backends.redis.RedisCache'
        ):
            raise CommandError('Soporte requiere REDIS_URL y eventos compartidos de Redis en producción.')
        try:
            unit = OrganizationalUnit.objects.filter(pk=UUID(str(options['unit']))).first()
        except (ValueError, TypeError):
            raise CommandError('Configura BOLD_SUPPORT_UNIT_ID con el UUID de un departamento válido.') from None
        if not unit:
            raise CommandError('Departamento no disponible.')
        try:
            caches['support'].get('worker')
        except Exception:
            raise CommandError('La caché compartida de soporte no está disponible.') from None
        executable = shutil.which(settings.BOLD_SUPPORT_CODEX_BINARY)
        if not executable:
            raise CommandError('No se encontró Codex CLI. Configura BOLD_SUPPORT_CODEX_BINARY.')
        try:
            status = subprocess.run([executable, 'login', 'status'], capture_output=True, text=True, timeout=15)
        except (OSError, subprocess.TimeoutExpired):
            raise CommandError('No se pudo comprobar la sesión de Codex.') from None
        if status.returncode or 'ChatGPT' not in status.stdout + status.stderr:
            raise CommandError('Inicia sesión con ChatGPT mediante codex login. Este bot no usa claves de API.')
        if options['check']:
            self.stdout.write('Configuración y sesión de Codex verificadas. Sin inferencias ni cambios de datos.')
            return
        configure_identity(unit)
        self.stdout.write('Soporte BOLD activo. Solo lecturas y menciones explícitas; consumo en la cuenta de Codex configurada.')
        stopping = Event()
        previous_term = signal.signal(signal.SIGTERM, lambda *_: stopping.set())
        try:
            while not stopping.is_set():
                close_old_connections()
                try:
                    caches['support'].set('worker', timezone.now().timestamp(), 150)
                    completed = drain(limit=1)
                    if completed:
                        self.stdout.write(f'Respuestas publicadas: {completed}')
                except Exception:
                    logger.exception('Falló el ciclo de soporte; las inferencias iniciadas no se repiten.')
                    if options['once']:
                        raise
                if options['once']:
                    return
                stopping.wait(options['interval'])
        except KeyboardInterrupt:
            self.stdout.write('Soporte BOLD detenido.')
        finally:
            signal.signal(signal.SIGTERM, previous_term)
            close_old_connections()
