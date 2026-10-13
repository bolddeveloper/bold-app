import json
import re

from rest_framework.exceptions import PermissionDenied, ValidationError

from boldApp.workspace.image_storage import authorized_image, image_id
from boldApp.workspace.models import ImageBinding, StoredImage


def bind_images(workbook, request=None):
    references = {image_id(path) for path in re.findall(r"/api/v2/media/images/[0-9a-f-]{36}/", json.dumps(workbook.document))}
    references.discard(None)
    if not references:
        return
    bound = set(ImageBinding.objects.filter(resource_kind="workbook", resource_id=workbook.id, field="document", image_id__in=references).values_list("image_id", flat=True))
    pending = references - bound
    if not pending:
        return
    images = list(StoredImage.objects.filter(pk__in=pending))
    if request is not None and len(images) != len(pending):
        raise ValidationError("Una imagen de la hoja ya no está disponible.")
    for image in images:
        # Reverse updates copy images from an already-authorized task; client changes still require image access.
        if request is not None and not authorized_image(request, image):
            raise PermissionDenied("No puedes reutilizar esta imagen en la hoja.")
        ImageBinding.objects.get_or_create(image=image, resource_kind="workbook", resource_id=workbook.id, field="document")
