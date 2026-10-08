import json

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from rest_framework.exceptions import APIException

from boldApp.core.models import UserAccount, JobRole
from boldApp.autenticacion.models import PrivateNote
from boldApp.tareas.models import Project, Task, Comment, Attachment
from boldApp.sugerencias.models import Suggestion
from boldApp.workspace.image_storage import IMAGE_FIELDS, resource_key, storage_user, store_instance_images, task_path, rename_instance_folders
from boldApp.workspace.models import ImageStorageRoot, ImageDocument


class Command(BaseCommand):
    help = "Migra imágenes existentes a Drive sin borrar originales ante errores; puede reanudarse."

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=0, help="Máximo de registros con imágenes por ejecución; 0 procesa todos.")

    def handle(self, *args, **options):
        root = ImageStorageRoot.objects.filter(active=True).select_related("user").first()
        if not root:
            raise CommandError("Primero selecciona la carpeta en Administración → Conectores → Almacenamiento de imágenes.")
        storage_user(root)
        completed, failures = 0, 0
        for model in (UserAccount, Project, Task, Comment, Attachment, Suggestion, PrivateNote, JobRole, ImageDocument):
            for candidate in model.objects.order_by("pk").iterator(chunk_size=100):
                kind, _ = resource_key(candidate)
                fields = IMAGE_FIELDS[kind]
                payload = json.dumps({field: getattr(candidate, field) for field in fields})
                if "data:image/" not in payload:
                    rename_instance_folders(candidate)
                    continue
                if options["limit"] and completed + failures >= options["limit"]:
                    break
                try:
                    with transaction.atomic():
                        instance = model.objects.select_for_update().get(pk=candidate.pk)
                        if kind == "task":
                            task_path(instance)
                        store_instance_images(instance)
                        if kind == "note":
                            instance.version += 1
                            instance.save(update_fields=["version"])
                    completed += 1
                    self.stdout.write(f"Migrado {kind} {candidate.pk}")
                except APIException as error:
                    failures += 1
                    self.stderr.write(f"Pendiente {kind} {candidate.pk}: {error.detail}")
        self.stdout.write(f"Migrados: {completed}. Pendientes con error: {failures}.")
        if failures:
            raise CommandError("Conservados los originales de los registros pendientes. Corrige la conexión y repite el comando.")
