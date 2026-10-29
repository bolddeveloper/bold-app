import time
from django.core.management.base import BaseCommand,CommandError
from boldApp.mensajeria.upload_tasks import drain_media_uploads


class Command(BaseCommand):
    help='Process one bounded batch of staged messaging files; no inline HTTP/eager fallback.'

    def add_arguments(self,parser):
        parser.add_argument('--watch',action='store_true',help='Solo staging local: mantener el trabajador de pruebas activo hasta Ctrl+C.')
        parser.add_argument('--interval',type=int,default=30)

    def handle(self,*args,**options):
        if not options['watch']:
            self.stdout.write(str(drain_media_uploads.run()))
            return
        if not 15<=options['interval']<=60:
            raise CommandError('El intervalo del trabajador local debe estar entre 15 y 60 segundos.')
        from .bootstrap_messaging_staging import checked_profile,CLIENT,PROJECT
        from boldApp.workspace.models import GoogleConnection,GoogleOAuthConfiguration,ImageStorageRoot
        from boldApp.mensajeria.models import MediaUpload
        def check_target():
            checked_profile()
            root=ImageStorageRoot.objects.filter(active=True,folder_id='1r7DLaKq97Tjo0KsTtkR7ANevO9dy9mbb',
                client_id=CLIENT,user__email='samuel@bold.gt').first()
            if (not root or ImageStorageRoot.objects.exclude(pk=root.pk).exists() or
                not GoogleOAuthConfiguration.objects.filter(pk=1,enabled=True,project_id=PROJECT,client_id=CLIENT).exists() or
                GoogleConnection.objects.count()!=1 or not GoogleConnection.objects.filter(user_id=root.user_id,
                    subject=root.subject,client_id=CLIENT,email='samuel@bold.gt').exists() or
                MediaUpload.objects.filter(root__isnull=False).exclude(root=root).exists()):
                raise CommandError('El trabajador local solo admite el cliente, conexión y carpeta privados del ensayo aprobado.')
        check_target()
        self.stdout.write('Trabajador local de pruebas activo. Lotes acotados, sin llamadas a Google en reposo; Ctrl+C lo detiene. No es un servicio de producción.')
        self.stdout.flush()
        try:
            while True:
                check_target()
                result=drain_media_uploads.run()
                if result['examined'] or result['cleaned'] or result['cleanup_review']:
                    self.stdout.write(str(result));self.stdout.flush()
                time.sleep(options['interval'])
        except KeyboardInterrupt:
            self.stdout.write('Trabajador local detenido; se conservan los intentos y archivos.')
