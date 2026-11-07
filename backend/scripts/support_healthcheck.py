"""Check the dedicated worker heartbeat without inference or private output."""
import os
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

try:
    import django
    django.setup()
    from django.core.cache import caches
    stamp = caches['support'].get('worker')
    healthy = isinstance(stamp, (int, float)) and 0 <= time.time()-stamp < 150
except Exception:
    healthy = False

raise SystemExit(0 if healthy else 1)
