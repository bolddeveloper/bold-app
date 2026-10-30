import base64
import os
from pathlib import Path
import re
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = "Crea una pareja VAPID en un archivo nuevo; no imprime ni sobrescribe claves."

    def add_arguments(self, parser):
        parser.add_argument("--output", required=True)
        parser.add_argument("--subject", default="mailto:soporte@bold.gt")

    def handle(self, *args, **options):
        subject = options["subject"]
        if not re.fullmatch(r"mailto:[A-Za-z0-9._+\-]+@[A-Za-z0-9.\-]+", subject):
            raise CommandError("Indica un contacto mailto válido para el proveedor de notificaciones.")
        path = Path(options["output"]).expanduser().resolve()
        private = ec.generate_private_key(ec.SECP256R1())
        secret = base64.urlsafe_b64encode(private.private_bytes(serialization.Encoding.DER,
            serialization.PrivateFormat.PKCS8, serialization.NoEncryption())).decode()
        public = base64.urlsafe_b64encode(private.public_key().public_bytes(serialization.Encoding.X962,
            serialization.PublicFormat.UncompressedPoint)).decode().rstrip("=")
        content = f"WEB_PUSH_ENABLED=true\nWEB_PUSH_PUBLIC_KEY={public}\nWEB_PUSH_PRIVATE_KEY={secret}\nWEB_PUSH_SUBJECT={subject}\n"
        try:
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, "w", encoding="ascii", newline="\n") as target:
                target.write(content); target.flush(); os.fsync(target.fileno())
        except OSError as error:
            raise CommandError("No se pudo crear el archivo privado. La carpeta debe existir y el archivo de destino debe ser nuevo.") from error
        self.stdout.write(f"Configuración VAPID creada en {path}. Las claves no se han mostrado ni activado en el servidor.")
