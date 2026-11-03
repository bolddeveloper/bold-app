from io import BytesIO
from unittest.mock import patch, Mock

from asgiref.sync import async_to_sync
from django.core.exceptions import RequestAborted
from django.core.files.uploadedfile import SimpleUploadedFile, InMemoryUploadedFile
from django.test import SimpleTestCase, RequestFactory
from boldApp.core.memory_uploads import MemoryOnlyASGIHandler


class MemoryUploadTests(SimpleTestCase):
    def test_daphne_never_spools_and_limits_declared_and_chunked_bodies(self):
        from boldApp.core.daphne_memory import MemoryWebRequest
        request=object.__new__(MemoryWebRequest)
        request.basic_error=Mock()
        with patch('tempfile.TemporaryFile',side_effect=AssertionError('Daphne disk spool forbidden')):
            request.gotLength(3*1024*1024)
            request.handleContentChunk(b'x'*(3*1024*1024))
            self.assertIsInstance(request.content,BytesIO)
            self.assertEqual(request.content.tell(),3*1024*1024)
            self.assertFalse(request._parsePOSTFormSubmission)
            request.content.close()
            with patch('boldApp.core.daphne_memory.MAX_REQUEST_BYTES',3):
                for length in (4,None):
                    request.gotLength(length)
                    request.handleContentChunk(b'123');request.handleContentChunk(b'4')
                    self.assertTrue(request.body_too_large)
                    self.assertEqual(request.content.getvalue(),b'')
                    request.process()
                    self.assertEqual(request.basic_error.call_args.args[0],413)
                    request.content.close()

    def test_multipart_above_django_disk_threshold_stays_in_memory(self):
        with patch('tempfile.NamedTemporaryFile', side_effect=AssertionError('Disk upload forbidden')):
            request=RequestFactory().post('/upload/',{'file':SimpleUploadedFile('photo.webp',b'x'*(3*1024*1024))})
            self.assertIsInstance(request.FILES['file'],InMemoryUploadedFile)

    def test_asgi_never_spools_body_and_rejects_oversized_requests(self):
        handler=object.__new__(MemoryOnlyASGIHandler)
        async def check():
            async def receive():return {'type':'http.request','body':b'payload','more_body':False}
            with patch('tempfile.SpooledTemporaryFile',side_effect=AssertionError('Disk request forbidden')):
                body=await handler.read_body(receive)
                self.assertIsInstance(body,BytesIO);self.assertEqual(body.read(),b'payload');body.close()
                sent=[]
                async def send(message):sent.append(message)
                with patch('boldApp.core.memory_uploads.MAX_REQUEST_BYTES',3):
                    await handler.handle({},receive,send)
                self.assertEqual(sent[0]['status'],413)
        async_to_sync(check)()

    def test_disconnection_aborts_without_retaining_a_body(self):
        handler=object.__new__(MemoryOnlyASGIHandler)
        async def receive():return {'type':'http.disconnect'}
        with self.assertRaises(RequestAborted):async_to_sync(handler.read_body)(receive)
