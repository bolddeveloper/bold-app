"""Bound Daphne's pre-ASGI body buffer without Twisted's disk spool."""
from io import BytesIO

from daphne import http_protocol
from .memory_uploads import MAX_REQUEST_BYTES


class MemoryWebRequest(http_protocol.WebRequest):
    def gotLength(self, length):
        self.content=BytesIO()
        self.body_too_large=length is not None and length>MAX_REQUEST_BYTES
        # Django parses forms; avoid Twisted parsing the same multipart first.
        self._parsePOSTFormSubmission=False

    def handleContentChunk(self, data):
        if self.body_too_large:
            return
        if self.content.tell()+len(data)>MAX_REQUEST_BYTES:
            self.content.seek(0);self.content.truncate()
            self.body_too_large=True
        else:
            self.content.write(data)

    def process(self):
        if self.body_too_large:
            self.basic_error(413,b'Content Too Large','La solicitud supera 32 MB.')
            return
        return super().process()


def install_memory_requests():
    # Daphne's pinned factory resolves this class for every new connection.
    http_protocol.WebRequest=MemoryWebRequest
