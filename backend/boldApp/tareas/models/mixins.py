import uuid

from django.db import models


# Define un manager que expone unicamente los registros no eliminados (borrado logico).
class ActiveManager(models.Manager):

    def get_queryset(self):
        return super().get_queryset().filter(deleted_at__isnull=True)


# Define un modelo abstracto reutilizable para tablas con borrado logico (deleted_at).
class SoftDeleteModel(models.Model):
    deleted_at = models.DateTimeField(null=True, blank=True)

    objects = ActiveManager()
    all_objects = models.Manager()

    class Meta:
        abstract = True


# Define un modelo abstracto reutilizable para las llaves primarias UUID del diagrama.
class UUIDPrimaryKeyModel(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    class Meta:
        abstract = True
