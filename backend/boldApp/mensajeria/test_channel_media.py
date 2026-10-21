import io
import json
import uuid
from types import SimpleNamespace
from unittest.mock import patch

from PIL import Image
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from boldApp.workspace.models import ImageStorageRoot
from . import test_channels as base
from .media import MAX_BYTES
from .models import ChannelMedia, ChannelMessage, DepartmentChannel, MessageMedia


@override_settings(MESSAGING_PILOT_ENABLED=False)
class ChannelMediaTests(TestCase):
    root = base.DepartmentChannelTests.root
    setUp = base.DepartmentChannelTests.setUp
    identity = base.DepartmentChannelTests.identity
    as_person = base.DepartmentChannelTests.as_person
    send = base.DepartmentChannelTests.send
    deny = base.DepartmentChannelTests.deny

    def picture(self, color="red"):
        output = io.BytesIO()
        Image.new("RGB", (80, 50), color).save(output, "PNG")
        return SimpleUploadedFile("captura.png", output.getvalue(), content_type="image/png")

    def drive(self):
        return ImageStorageRoot.objects.create(user=self.alice.employee.user_account,
            subject="synthetic", client_id="synthetic", google_email="synthetic@bold.gt",
            folder_id="synthetic_private_root", folder_name="BOLD APP", active=True)

    def fake_store(self, message, prepared):
        root = ImageStorageRoot.objects.filter(active=True).first() or self.drive()
        self.uploaded = prepared["content"]
        return ChannelMedia.objects.create(message=message, root=root, drive_id="synthetic_private_file", **{key:value for key,value in prepared.items() if key != "content"})

    def upload(self, *, token=None, file=None, body="", **extra):
        return self.client.post(self.url + "messages/", {"body":body,"client_id":str(token or uuid.uuid4()), "file":file or self.picture(), **extra}, format="multipart")

    @patch("boldApp.mensajeria.channel_views.store_channel_media")
    def test_image_upload_uses_normalized_pixels_and_private_metadata_and_idempotent_retry(self, store):
        store.side_effect=self.fake_store
        token=uuid.uuid4()
        first=self.upload(token=token)
        self.assertEqual(first.status_code,201,first.data)
        message=first.data["message"]
        self.assertEqual((message["media"]["kind"],message["media"]["mime_type"]),("image","image/webp"))
        self.assertEqual((message["media"]["width"],message["media"]["height"]),(80,50))
        self.assertNotIn("drive_id",str(message))
        self.assertNotIn("synthetic_private",str(message))
        self.assertEqual(self.upload(token=token).status_code,200)
        self.assertEqual(store.call_count,1)
        self.assertEqual(ChannelMessage.objects.count(),1)
        self.assertEqual(ChannelMedia.objects.count(),1)
        self.assertEqual(MessageMedia.objects.count(),0)
        self.assertEqual(self.upload(token=token,file=self.picture("blue")).status_code,409)
        edit=self.client.patch(self.url+"messages/"+message["id"]+"/",{"body":"Descripción corregida","version":1},format="json")
        self.assertEqual(edit.status_code,200)
        self.assertEqual(self.upload(token=token).data["message"]["body"],"Descripción corregida")

    @patch("boldApp.mensajeria.channel_views.store_channel_media")
    def test_audio_and_thread_attachments_share_normal_bounded_contract(self, store):
        store.side_effect=self.fake_store
        parent=self.send().data["message"]
        for mime,content in (("audio/webm",b"\x1aE\xdf\xa3webm"+b"\0"*30),("audio/ogg",b"OggS\0OpusHead"+b"\0"*20),("audio/mp4",b"\0\0\0\x18ftypM4A "+b"\0"*20)):
            response=self.upload(file=SimpleUploadedFile("nota",content,content_type=mime),parent_id=parent["id"])
            self.assertEqual(response.status_code,201,response.data)
            self.assertEqual(response.data["message"]["media"]["kind"],"audio")
        self.assertEqual(len(self.client.get(self.url+"messages/?parent="+parent["id"]).data["results"]),3)

    @patch("boldApp.mensajeria.channel_views.store_channel_media")
    def test_download_rechecks_channel_read_and_pilot_and_never_accepts_a_different_parent(self, store):
        store.side_effect=self.fake_store
        message=self.upload().data["message"]
        url=self.url+"messages/"+message["id"]+"/media/"
        with patch("boldApp.workspace.image_storage.storage_user",return_value=object()), patch("boldApp.workspace.service.google",return_value=SimpleNamespace(content=self.uploaded)) as google:
            response=self.as_person(self.bob).get(url)
            self.assertEqual(response.status_code,200)
            self.assertEqual(response.content,self.uploaded)
            self.assertEqual(response["Cache-Control"],"private, no-store")
            self.assertEqual(response["X-Content-Type-Options"],"nosniff")
            self.assertIn("sandbox",response["Content-Security-Policy"])
            self.deny("slack.channel.read")
            self.assertEqual(self.as_person(self.bob).get(url).status_code,404)
            self.assertEqual(google.call_count,1,"denied downloads do not contact Drive")
        with override_settings(MESSAGING_PILOT_ENABLED=True,MESSAGING_PILOT_UNIT_IDS=[str(self.it.pk)]):
            self.assertEqual(self.as_person(self.owner).get(url).status_code,403)
        other=DepartmentChannel.objects.create(unit=self.it,name="Otro",creator=self.alice)
        self.assertEqual(self.client.get(self.root+str(other.pk)+"/messages/"+message["id"]+"/media/").status_code,404)

    @patch("boldApp.mensajeria.channel_views.store_channel_media")
    def test_changed_drive_bytes_fail_closed_without_serving_unverified_content(self, store):
        store.side_effect=self.fake_store
        message=self.upload().data["message"]
        with patch("boldApp.workspace.image_storage.storage_user",return_value=object()), patch("boldApp.workspace.service.google",return_value=SimpleNamespace(content=b"changed")):
            self.assertEqual(self.client.get(self.url+"messages/"+message["id"]+"/media/").status_code,400)

    @patch("boldApp.mensajeria.channel_views.store_channel_media")
    def test_invalid_and_oversize_uploads_do_not_create_messages_or_touch_drive(self, store):
        for mime,content in (("image/png",b"not image"),("image/svg+xml",b"<svg/>"),("audio/webm",b"<script/>")):
            self.assertEqual(self.upload(file=SimpleUploadedFile("bad",content,content_type=mime)).status_code,400)
        huge=SimpleUploadedFile("huge.webm",b"x"*(MAX_BYTES+1),content_type="audio/webm")
        self.assertEqual(self.upload(file=huge).status_code,400)
        self.assertEqual(ChannelMessage.objects.count(),0)
        store.assert_not_called()

    @patch("boldApp.mensajeria.channel_views.store_channel_media")
    def test_failure_rolls_back_message_media_and_activity_without_publishing(self, store):
        store.side_effect=RuntimeError("synthetic storage failure")
        with patch("boldApp.mensajeria.channel_views.publish_channel") as publish, self.assertRaises(RuntimeError):
            self.upload()
        self.assertEqual(ChannelMessage.objects.count(),0)
        self.assertEqual(ChannelMedia.objects.count(),0)
        self.assertEqual(DepartmentChannel.objects.get(pk=self.channel_id).activity_version,0)
        publish.assert_not_called()

    def test_missing_drive_destination_is_recoverable_without_creating_a_message(self):
        token = uuid.uuid4()
        with patch("boldApp.mensajeria.channel_views.publish_channel") as publish:
            rejected = self.upload(token=token)
        self.assertEqual(rejected.status_code, 400)
        self.assertIn("Configura el destino corporativo de Drive", str(rejected.data))
        self.assertEqual(ChannelMessage.objects.count(), 0)
        self.assertEqual(ChannelMedia.objects.count(), 0)
        self.assertEqual(DepartmentChannel.objects.get(pk=self.channel_id).activity_version, 0)
        publish.assert_not_called()
        # The same draft can be retried after the storage destination is ready.
        with patch("boldApp.mensajeria.channel_views.store_channel_media", side_effect=self.fake_store):
            retried = self.upload(token=token)
        self.assertEqual(retried.status_code, 201, retried.data)
        self.assertEqual(ChannelMessage.objects.count(), 1)
        self.assertEqual(ChannelMedia.objects.count(), 1)
        self.assertEqual(str(ChannelMessage.objects.get().client_id), str(token))

    def test_real_storage_contract_is_scoped_private_and_recovers_an_orphaned_upload(self):
        self.drive()
        remote={}
        writes=[]
        def google(_user, method, path, **kwargs):
            self.assertEqual(path,"/files")
            self.assertNotIn("permissions",path)
            if method=="GET":
                return {"files":[{"id":value}] if (value:=next((value for marker,value in remote.items() if marker in kwargs["params"]["q"]),None)) else []}
            self.assertEqual(method,"POST")
            metadata=json.loads(kwargs["files"]["metadata"][1])
            marker=metadata["appProperties"]["bold_slack_media"]
            self.assertEqual(metadata["parents"],["synthetic_channel_folder"])
            self.assertNotIn("permissions",metadata)
            remote[marker]="synthetic_remote_file"; writes.append(metadata)
            return {"id":remote[marker]}
        token=uuid.uuid4()
        with patch("boldApp.mensajeria.channel_media.storage_user",return_value=object()), patch("boldApp.mensajeria.channel_media.drive_folder",return_value="synthetic_channel_folder") as folder, patch("boldApp.mensajeria.channel_media.google",side_effect=google):
            with patch("boldApp.mensajeria.channel_views.publish_channel",side_effect=RuntimeError("synthetic rollback after upload")),self.assertRaises(RuntimeError):
                self.upload(token=token)
            self.assertEqual(ChannelMessage.objects.count(),0)
            self.assertEqual(len(writes),1)
            retry=self.upload(token=token)
            self.assertEqual(retry.status_code,201,retry.data)
            self.assertEqual(len(writes),1,"completed private upload is recovered, not copied again")
            path=folder.call_args.args[1]
            self.assertEqual([part[0].split(":")[0] for part in path],["slack","department","channel","employee"])
            self.assertEqual(ChannelMedia.objects.get().drive_id,"synthetic_remote_file")
