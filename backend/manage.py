#!/usr/bin/env python
"""Utilidad de linea de comandos de Django para boldApp."""
import os
import sys


def main():
    """Ejecuta tareas administrativas de Django."""

    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

    try:
        from django.core.management import execute_from_command_line
    except ImportError as exc:
        raise ImportError(
            "No se pudo importar Django. Asegurate de que este instalado y "
            "disponible en tu variable de entorno PYTHONPATH. "
            "Verifica tambien que hayas activado un entorno virtual."
        ) from exc

    execute_from_command_line(sys.argv)


if __name__ == "__main__":
    main()
