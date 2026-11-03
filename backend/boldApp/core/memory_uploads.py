"""Request buffers stay in bounded RAM; uploaded files never spill to disk."""
from io import BytesIO

from django.core.exceptions import RequestAborted
from django.core.files.uploadhandler import MemoryFileUploadHandler
from django.core.handlers.asgi import ASGIHandler

# Includes multipart overhead and the existing 20 MB Excel import.
MAX_REQUEST_BYTES = 32 * 1024 * 1024


class BodyLimitExceeded(Exception):
    pass


class MemoryOnlyUploadHandler(MemoryFileUploadHandler):
    def handle_raw_input(self, input_data, META, content_length, boundary, encoding=None):
        self.activated = True
        self.received = 0

    def receive_data_chunk(self, raw_data, start):
        self.received += len(raw_data)
        if self.received > MAX_REQUEST_BYTES:
            from django.core.exceptions import RequestDataTooBig
            raise RequestDataTooBig('El archivo supera el límite de carga en memoria.')
        return super().receive_data_chunk(raw_data, start)


class MemoryOnlyASGIHandler(ASGIHandler):
    async def handle(self, scope, receive, send):
        try:
            await super().handle(scope, receive, send)
        except BodyLimitExceeded:
            await send({'type': 'http.response.start', 'status': 413, 'headers': [(b'content-type', b'application/json')]})
            await send({'type': 'http.response.body', 'body': b'{"detail":"La solicitud supera 32 MB."}'})

    async def read_body(self, receive):
        content = BytesIO()
        try:
            while True:
                message = await receive()
                if message['type'] == 'http.disconnect':
                    raise RequestAborted()
                chunk = message.get('body', b'')
                if content.tell() + len(chunk) > MAX_REQUEST_BYTES:
                    raise BodyLimitExceeded()
                content.write(chunk)
                if not message.get('more_body', False):
                    content.seek(0)
                    return content
        except BaseException:
            content.close()
            raise
