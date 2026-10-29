import time
from django.core.management.base import BaseCommand,CommandError
from boldApp.mensajeria.automations import drain


class Command(BaseCommand):
    help = 'Ejecuta como máximo 25 automatizaciones autorizadas y vencidas; no activa ni modifica sus fechas por su cuenta.'

    def add_arguments(self,parser):
        parser.add_argument('--watch',action='store_true',help='Solo staging local autorizado: comprobar fechas reales hasta Ctrl+C.')
        parser.add_argument('--interval',type=int,default=30)

    def handle(self, *args, **options):
        if not options['watch']:
            self.stdout.write(str(drain(limit=25)));return
        if not 15<=options['interval']<=60:
            raise CommandError('El intervalo de pruebas debe estar entre 15 y 60 segundos.')
        from .prepare_staging_automations import check_automation_staging,CHANNEL
        from boldApp.mensajeria.models import ChannelAutomation
        def checked():
            check_automation_staging()
            if ChannelAutomation.objects.exclude(channel_id=CHANNEL).exists():
                raise CommandError('El trabajador interactivo solo ejecuta reglas del canal sintético de aceptación.')
        checked()
        self.stdout.write('Trabajador de automatizaciones del staging activo, con reloj real. No es Celery Beat distribuido; Ctrl+C lo detiene.');self.stdout.flush()
        try:
            while True:
                checked();result=drain(limit=25)
                if result['examined']:
                    self.stdout.write(str(result));self.stdout.flush()
                time.sleep(options['interval'])
        except KeyboardInterrupt:
            self.stdout.write('Trabajador local detenido; reglas y resultados conservados.')
