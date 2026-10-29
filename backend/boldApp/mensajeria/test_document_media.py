import io
import re
import struct
import uuid
import zipfile
from types import SimpleNamespace
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase, TestCase, TransactionTestCase, override_settings
from rest_framework.exceptions import ValidationError

from .document_uploads import DOCUMENT_MIMES, MAIN, CT_NS, REL_NS
from .media import prepare, private_media_response
from . import test_media as chat_fixtures, test_channel_media as channel_fixtures, test_history_search as history_fixtures
from .models import MessageMedia, ChannelMedia, DirectMessage, SearchDocument


def pdf_bytes():
    data, positions = b"%PDF-1.7\n", []
    for index, body in enumerate((b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>", b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << >> >>"), 1):
        positions.append(len(data)); data += str(index).encode() + b" 0 obj\n" + body + b"\nendobj\n"
    offset=len(data)
    return data + b"xref\n0 4\n0000000000 65535 f \n" + b"".join(f"{value:010d} 00000 n \n".encode() for value in positions) + b"trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n" + str(offset).encode() + b"\n%%EOF\n"


def office_bytes(extension="docx", extras=None, main_xml=None):
    path, mime, family, name = MAIN[extension]
    parts = {"[Content_Types].xml": f'<Types xmlns="{CT_NS}"><Override PartName="/{path}" ContentType="{mime}"/></Types>',
        "_rels/.rels": f'<Relationships xmlns="{REL_NS}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="{path}"/></Relationships>',
        path: main_xml or f'<{name} xmlns="http://schemas.openxmlformats.org/{family}/2006/main"/>', **(extras or {})}
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for key, value in parts.items():
            archive.writestr(key, value)
    return output.getvalue()


def upload(extension="pdf", content=None, mime=None, name=None):
    if content is None:
        content = pdf_bytes() if extension == "pdf" else office_bytes(extension) if extension in MAIN else b"Columna,Valor\nUno,2\n"
    return SimpleUploadedFile(name or "entrega." + extension, content, content_type=DOCUMENT_MIMES[extension] if mime is None else mime)


class DocumentValidationTests(SimpleTestCase):
    def test_all_formats_keep_original_bytes_and_canonical_mime(self):
        for extension, mime in DOCUMENT_MIMES.items():
            file = upload(extension)
            original = file.read(); file.seek(0)
            result = prepare(file)
            self.assertEqual((result["kind"], result["mime_type"], result["content"]), ("document", mime, original))
            self.assertIsNone(result["width"])
        self.assertEqual(prepare(upload("csv", mime="application/vnd.ms-excel"))["mime_type"], "text/csv")
        self.assertEqual(prepare(upload("docx", mime="application/octet-stream"))["kind"], "document")

    def test_filename_mime_and_pdf_envelope_must_agree(self):
        for file in (upload("pdf", mime="text/plain"), upload("pdf", name="run.exe"), upload("pdf", content=b"%PDF-1.7\nnot complete"),
            upload("pdf", content=re.sub(rb"startxref\n\d+", b"startxref\n999999", pdf_bytes())), upload("pdf", content=pdf_bytes()+b"<script/>")):
            with self.assertRaises(ValidationError):
                prepare(file)

    def test_text_is_bounded_utf8_and_csv_is_structural_not_an_html_preview(self):
        self.assertEqual(prepare(upload("txt", content=b"<script>literal, never rendered</script>"))["kind"], "document")
        for content in (b"\xff\xfe\x00\x00", b"a\0b", b" \n\t", b"a" * (2*1024*1024 + 1)):
            with self.assertRaises(ValidationError):prepare(upload("txt", content=content))
        for content in (b'a,"unterminated', b","*257, b'a,"'+b"a"*150000+b'"'):
            with self.assertRaises(ValidationError):prepare(upload("csv", content=content))

    def test_office_rejects_wrong_kind_missing_parts_macros_entities_and_traversal(self):
        payloads = [office_bytes("xlsx"), b"PK\x03\x04not-a-zip", b'MZ'+office_bytes(),office_bytes(extras={'WORD/DOCUMENT.XML':'<other/>'}),office_bytes(extras={"../outside.xml":"bad"}),
            office_bytes(extras={"word/vbaProject.bin":b"macro"}), office_bytes(extras={"word/embeddings/object1.bin":b"object"}),
            office_bytes(extras={"word/activeX/activeX1.xml":"<x/>"}),
            office_bytes(main_xml='<!DOCTYPE document [<!ENTITY x "bad">]><document>&x;</document>'),
            office_bytes(main_xml='<document xmlns="wrong"/>')]
        for payload in payloads:
            with self.assertRaises(ValidationError):prepare(upload("docx", content=payload))

    def test_office_checks_all_parts_crc_xml_and_external_relationships(self):
        external = f'<Relationships xmlns="{REL_NS}"><Relationship Id="bad" Type="image" TargetMode="External" Target="https://example.invalid/remote.png"/></Relationships>'
        for extra in ({"word/_rels/document.xml.rels":external}, {"word/styles.xml":"<invalid"},
            {"word/huge.xml":"<x>"+"0"*700000+"</x>"}, {"word/evil.exe":b"run"}, {"word/utf16.xml":"<x/>".encode("utf-16")}):
            with self.assertRaises(ValidationError):prepare(upload("docx", content=office_bytes(extras=extra)))
        hyperlink = f'<Relationships xmlns="{REL_NS}"><Relationship Id="good" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" TargetMode="External" Target="https://bold.gt/help"/></Relationships>'
        self.assertEqual(prepare(upload("docx", content=office_bytes(extras={"word/_rels/document.xml.rels":hyperlink})))["kind"], "document")
        broken = bytearray(office_bytes()); end=broken.rfind(b"PK\x05\x06"); struct.pack_into("<H",broken,end+10,2049)
        with self.assertRaises(ValidationError), patch("boldApp.mensajeria.document_uploads.zipfile.ZipFile",side_effect=AssertionError("reject before allocating entries")):
            prepare(upload("docx", content=bytes(broken)))


@override_settings(MESSAGING_PILOT_ENABLED=False)
class ChatDocumentTests(TestCase):
    root = chat_fixtures.ChatMediaTests.root
    setUp = chat_fixtures.ChatMediaTests.setUp
    identity = chat_fixtures.ChatMediaTests.identity
    as_person = chat_fixtures.ChatMediaTests.as_person
    open = chat_fixtures.ChatMediaTests.open
    upload = chat_fixtures.ChatMediaTests.upload
    fake_store = chat_fixtures.ChatMediaTests.fake_store
    drive = chat_fixtures.ChatMediaTests.drive

    def test_document_send_retry_search_and_authenticated_attachment_download(self):
        with patch("boldApp.mensajeria.upload_outbox.attach", side_effect=self.fake_store) as store:
            conversation = self.open(); token=uuid.uuid4()
            first=self.upload(conversation,token,file=upload("pdf"))
            self.assertEqual(first.status_code,201,first.data)
            retry=self.upload(conversation,token,file=upload("pdf"))
            self.assertEqual(retry.status_code,200,retry.data);self.assertEqual(store.call_count,1)
        message=first.data["message"];self.assertEqual(message["media"]["kind"],"document")
        self.assertNotIn("drive_id",str(first.data))
        for kind in ("file","document"):
            result=self.client.get(f"{self.root}{conversation}/library/",{"kind":kind,"q":"entrega"})
            self.assertEqual(result.status_code,200,result.data);self.assertEqual(len(result.data["results"]),1)
        self.assertEqual(self.client.get("/api/v2/messaging/search/",{"kind":"text"}).data["results"],[])
        endpoint=f"{self.root}{conversation}/messages/{message['id']}/media/"
        with patch("boldApp.workspace.image_storage.storage_user",return_value=object()),patch("boldApp.workspace.service.google",return_value=SimpleNamespace(content=pdf_bytes())):
            response=self.client.get(endpoint)
            self.assertEqual(response.status_code,200,response.data if hasattr(response,"data") else "")
            self.assertEqual(response.content,pdf_bytes());self.assertTrue(response["Content-Disposition"].startswith("attachment;"))
            self.assertEqual(response["X-Content-Type-Options"],"nosniff")
            self.assertIn("sandbox",response["Content-Security-Policy"])
        with patch("boldApp.workspace.service.google",side_effect=AssertionError("membership first")):
            self.assertEqual(self.as_person(self.eve).get(endpoint).status_code,404)

    def test_invalid_document_never_touches_drive_or_creates_a_message(self):
        conversation=self.open()
        with patch("boldApp.mensajeria.upload_outbox.attach",side_effect=AssertionError("validate before publication")):
            result=self.upload(conversation,file=upload("pdf",content=b"fake"))
        self.assertEqual(result.status_code,400);self.assertFalse(DirectMessage.objects.exists())


@override_settings(MESSAGING_PILOT_ENABLED=False)
class ChannelDocumentTests(TestCase):
    root=channel_fixtures.ChannelMediaTests.root
    setUp=channel_fixtures.ChannelMediaTests.setUp
    identity=channel_fixtures.ChannelMediaTests.identity
    as_person=channel_fixtures.ChannelMediaTests.as_person
    send=channel_fixtures.ChannelMediaTests.send
    deny=channel_fixtures.ChannelMediaTests.deny
    drive=channel_fixtures.ChannelMediaTests.drive
    fake_store=channel_fixtures.ChannelMediaTests.fake_store
    upload=channel_fixtures.ChannelMediaTests.upload

    def test_documents_in_channels_and_threads_remain_private_and_searchable(self):
        root=self.send("Raíz de prueba").data["message"]
        with patch("boldApp.mensajeria.upload_outbox.attach",side_effect=self.fake_store):
            result=self.upload(file=upload("docx"),parent_id=root["id"])
        self.assertEqual(result.status_code,201,result.data)
        message=result.data["message"]
        for endpoint in (self.url+"library/", "/api/v2/messaging/search/"):
            response=self.client.get(endpoint,{"kind":"document","q":"entrega"})
            self.assertEqual(response.status_code,200,response.data);self.assertEqual(response.data["results"][0]["source_id"],message["id"])
        self.deny("slack.channel.read")
        with patch("boldApp.workspace.service.google",side_effect=AssertionError("ACL first")):
            self.assertEqual(self.client.get(self.url+f"messages/{message['id']}/media/").status_code,404)


from . import test_upload_outbox as outbox_fixtures


@override_settings(MESSAGING_PILOT_ENABLED=False,AUTH_MFA_REQUIRED=False,CELERY_TASK_ALWAYS_EAGER=True,
    AUTH_ENCRYPTION_KEY='synthetic-upload-outbox-tests-only')
class DocumentProviderTests(TransactionTestCase):
    root=outbox_fixtures.UploadOutboxTests.root
    identity=outbox_fixtures.UploadOutboxTests.identity
    as_person=outbox_fixtures.UploadOutboxTests.as_person
    open=outbox_fixtures.UploadOutboxTests.open
    setUp=outbox_fixtures.UploadOutboxTests.setUp

    def test_worker_keeps_original_office_bytes_and_private_drive_structure_for_chat_and_threads(self):
        from .upload_outbox import perform
        original=office_bytes('docx')
        channel=self.client.post('/api/v2/messaging/channels/',{'unit_id':str(self.unit.pk),'name':'Documentos'},format='json').data['id']
        channel_url=f'/api/v2/messaging/channels/{channel}/'
        parent=self.client.post(channel_url+'messages/',{'client_id':str(uuid.uuid4()),'body':'Raíz'},format='json').data['message']['id']
        for base,extra in ((f'{self.root}{self.conversation}/',{}),(channel_url,{'parent_id':parent})):
            nonce=str(uuid.uuid4())
            queued=self.client.post(base+'uploads/',{'client_id':nonce,'file':upload('docx',content=original)},format='multipart')
            self.assertEqual(queued.status_code,202,queued.data)
            self.assertTrue(perform(queued.data['id']))
            values={'client_id':nonce,'upload_id':queued.data['id'],'body':'Documento original',**extra}
            response=self.client.post(base+'messages/',values,format='json');self.assertEqual(response.status_code,201,response.data)
            writes=len(self.drive.calls)
            repeat=self.client.post(base+'messages/',values,format='json');self.assertEqual(repeat.status_code,200,repeat.data)
            self.assertEqual(len(self.drive.calls),writes,'publication and confirmed retry do not contact Google')
            media=(ChannelMedia if extra else MessageMedia).objects.get(message_id=response.data['message']['id'])
            saved=self.drive.files[media.drive_id]
            self.assertEqual(saved['content'],original);self.assertTrue(saved['metadata']['name'].endswith('.docx'))
            received=self.as_person(self.bob).get(base+f'messages/{media.message_id}/media/')
            self.assertEqual(received.status_code,200);self.assertEqual(received.content,original)
            self.assertTrue(received['Content-Disposition'].startswith('attachment;'))
        self.assertEqual(sum(bool(row['content']) for row in self.drive.files.values()),2)
        self.assertTrue(all('permissions' not in row['metadata'] for row in self.drive.files.values()))
