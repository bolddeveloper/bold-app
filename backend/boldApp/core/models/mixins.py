import uuid

from django.db import models


# Define un modelo abstracto reutilizable para las llaves primarias UUID del
# diagrama. Duplica boldApp/tareas/models/mixins.py a proposito: el nucleo no
# depende del modulo de tareas (que sera reescrito mas adelante), y esta
# clase son tres lineas sin logica que mantener sincronizada.
class UUIDPrimaryKeyModel(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    class Meta:
        abstract = True
