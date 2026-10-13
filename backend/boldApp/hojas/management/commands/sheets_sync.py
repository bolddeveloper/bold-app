from threading import Event

from django.core.management.base import BaseCommand
from django.db import close_old_connections

from boldApp.hojas.tasks import recover_pending


class Command(BaseCommand):
    help = "Recupera trabajos pendientes de Hojas en desarrollo local sin Celery/Redis."

    def handle(self, *args, **options):
        stopped = Event()
        try:
            while not stopped.wait(3):
                close_old_connections()
                recover_pending()
        except KeyboardInterrupt:
            stopped.set()
