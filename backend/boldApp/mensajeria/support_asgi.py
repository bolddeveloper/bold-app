"""Keep local support replies on the same event loop as in-memory Channels."""
import asyncio
import logging

from asgiref.sync import sync_to_async
from django.conf import settings
from django.db import close_old_connections

from .support_bot import drain


logger = logging.getLogger(__name__)


def local_pass():
    close_old_connections()
    try:
        return drain()
    finally:
        close_old_connections()


class LocalSupportHTTP:
    def __init__(self, app):
        self.app = app
        self.task = None

    async def run(self):
        while settings.BOLD_SUPPORT_ENABLED:
            try:
                await sync_to_async(local_pass, thread_sensitive=False)()
            except Exception:
                logger.exception('No se pudo procesar soporte local; no se repiten inferencias iniciadas.')
            await asyncio.sleep(2)

    async def __call__(self, scope, receive, send):
        if settings.DEBUG and settings.BOLD_SUPPORT_ENABLED and (self.task is None or self.task.done()):
            self.task = asyncio.create_task(self.run())
        return await self.app(scope, receive, send)
