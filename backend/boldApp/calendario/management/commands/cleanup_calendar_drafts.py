from time import sleep

from django.core.management.base import BaseCommand

from boldApp.calendario.tasks import cleanup_calendar_drafts


class Command(BaseCommand):
    help = "Limpia cada minuto los borradores de Google Meet abandonados (desarrollo local)."

    def handle(self, *args, **options):
        self.stdout.write("Limpieza de borradores de Meet activa. Ctrl+C para detener.")
        try:
            while True:
                cleanup_calendar_drafts()
                sleep(60)
        except KeyboardInterrupt:
            pass
