import base64
import uuid

from django.http import HttpResponse
from rest_framework import serializers
from rest_framework.exceptions import NotFound, ValidationError

from boldApp.core.avatar import validate_avatar


class ScreenshotsField(serializers.JSONField):
    def to_internal_value(self, value):
        if not isinstance(value, list) or len(value) > 3:
            raise ValidationError("Puedes adjuntar hasta tres capturas.")
        previous = {item["id"]: item for item in getattr(self.parent.instance, "screenshots", [])}
        result, seen = [], set()
        for item in value:
            if not isinstance(item, dict):
                raise ValidationError("Captura inválida.")
            if "data_url" not in item:
                key = item.get("id")
                if not isinstance(key, str) or key not in previous or key in seen:
                    raise ValidationError("La captura no pertenece a este reporte.")
                capture = previous[key]
            else:
                data = item["data_url"]
                name = item.get("name", "Captura")
                if not isinstance(data, str) or not data or len(data) > 410000 or not isinstance(name, str) or not 1 <= len(name) <= 120:
                    raise ValidationError("Usa capturas de hasta 300 KB con un nombre válido.")
                name = serializers.CharField(min_length=1, max_length=120).run_validation(name)
                validate_avatar(data, "reporte")
                capture = {"id": str(uuid.uuid4()), "name": name, "data_url": data}
            seen.add(capture["id"])
            result.append(capture)
        return result

    def to_representation(self, value):
        return [{"id": item["id"], "name": item["name"]} for item in value]


def screenshot_response(captures, image_id, request=None):
    item = next((item for item in captures if item["id"] == image_id), None)
    if not item:
        raise NotFound("La captura ya no está disponible.")
    from boldApp.workspace.image_storage import image_id as stored_id
    if stored_id(item["data_url"]):
        from boldApp.workspace.image_views import StoredImageView
        if request is None:
            raise ValidationError("Usa la dirección protegida de la imagen.")
        return StoredImageView().get(request, stored_id(item["data_url"]))
    response = HttpResponse(base64.b64decode(item["data_url"].split(",", 1)[1]), content_type="image/webp")
    response["Cache-Control"] = "private, no-store"
    response["X-Content-Type-Options"] = "nosniff"
    return response
