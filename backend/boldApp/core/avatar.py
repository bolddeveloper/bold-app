import base64
import binascii
from rest_framework.exceptions import ValidationError


def validate_avatar(value, label="perfil"):
    """The same bounded WebP representation used by project and account avatars."""
    if not value:
        return None
    prefix = "data:image/webp;base64,"
    if not value.startswith(prefix):
        raise ValidationError(f"La imagen del {label} debe ser WebP.")
    try:
        decoded = base64.b64decode(value[len(prefix):], validate=True)
    except (ValueError, binascii.Error):
        raise ValidationError(f"La imagen del {label} no contiene Base64 válido.")
    if len(decoded) > 300 * 1024:
        raise ValidationError(f"La imagen del {label} no puede superar 300 KB.")
    if not decoded.startswith(b"RIFF") or decoded[8:12] != b"WEBP":
        raise ValidationError("El contenido enviado no es una imagen WebP válida.")
    return value
