import io
import uuid
from unittest.mock import patch

from django.db import IntegrityError, transaction
from django.test import TestCase, override_settings
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image

from . import test_channels as base
from .channel_events import channel_event
from .models import DepartmentChannel, ChannelMessage, ChannelMedia, ChannelSubscription
from boldApp.workspace.models import ImageStorageRoot


@override_settings(MESSAGING_PILOT_ENABLED=False)
class IndependentChannelTests(TestCase):
    root = base.DepartmentChannelTests.root
    setUp = base.DepartmentChannelTests.setUp
    identity = base.DepartmentChannelTests.identity
    as_person = base.DepartmentChannelTests.as_person
    deny = base.DepartmentChannelTests.deny

    def create(self, name="Independiente", **extra):
        return self.client.post(self.root, {"name": name, **extra}, format="json")

    def test_omitted_or_null_department_creates_an_independent_channel(self):
        for name, extra in (("Omitido", {}), ("Explícito", {"unit_id": None})):
            response = self.create(name, **extra)
            self.assertEqual(response.status_code, 201, response.data)
            self.assertIsNone(response.data["department"])
            channel = DepartmentChannel.objects.get(pk=response.data["id"])
            self.assertIsNone(channel.unit_id)
            self.assertEqual(channel.creator_id, self.alice.pk)
            detail = self.client.get(self.root + response.data["id"] + "/")
            self.assertEqual(detail.status_code, 200)
            self.assertTrue(detail.data["can_manage"])

    def test_names_are_unique_inside_the_independent_namespace(self):
        self.assertEqual(self.create("Equipo").status_code, 201)
        self.assertEqual(self.as_person(self.bob).post(self.root, {"name": "equipo", "unit_id": None}, format="json").status_code, 409)
        with self.assertRaises(IntegrityError), transaction.atomic():
            DepartmentChannel.objects.create(name="EQUIPO", creator=self.bob)
        self.assertEqual(self.client.post(self.root, {"name": "Equipo", "unit_id": str(self.it.pk)}, format="json").status_code, 201)
        self.assertEqual(self.as_person(self.bob).post(self.root, {"name": "Equipo", "unit_id": str(self.marketing.pk)}, format="json").status_code, 201)

    def test_filter_and_creation_capability_include_independent_channels(self):
        created = self.create().data
        response = self.client.get(self.root + "?unit=independent")
        self.assertEqual([row["id"] for row in response.data["results"]], [created["id"]])
        self.assertEqual([row["id"] for row in self.client.get(self.root + "?unit=" + str(self.it.pk)).data["results"]], [self.channel_id])
        capabilities = self.client.get("/api/v2/messaging/departments/")
        self.assertTrue(capabilities.data["can_create_independent"])
        self.deny("slack.channel.create", scope="own_unit")
        self.assertFalse(self.client.get("/api/v2/messaging/departments/").data["can_create_independent"])
        self.assertEqual(self.create("Rechazado").status_code, 403)
        self.assertFalse(DepartmentChannel.objects.filter(name="Rechazado").exists())

    def test_messages_threads_following_and_edits_keep_the_authors_real_department(self):
        channel = self.create().data
        url = self.root + channel["id"] + "/"
        peer = self.as_person(self.bob)
        self.assertEqual(peer.put(url + "following/", {"following": True}, format="json").status_code, 200)
        sent = peer.post(url + "messages/", {"body": "Contexto", "client_id": str(uuid.uuid4())}, format="json")
        self.assertEqual(sent.status_code, 201, sent.data)
        message = sent.data["message"]
        self.assertEqual(message["department"]["name"], "Marketing")
        self.assertEqual(peer.patch(url + "messages/" + message["id"] + "/", {"body": "Corregido", "version": 1}, format="json").status_code, 200)
        reply = self.client.post(url + "messages/", {"body": "Respuesta", "client_id": str(uuid.uuid4()), "parent_id": message["id"]}, format="json")
        self.assertEqual(reply.status_code, 201)
        self.assertIsNone(self.client.get(url + "messages/").data["channel"]["department"])
        self.assertEqual(len(peer.get(url + "messages/?parent=" + message["id"]).data["results"]), 1)
        event = channel_event(self.alice.pk, {"channel_id": channel["id"], "kind": "message.created"})
        self.assertIsNotNone(event)
        self.assertEqual(peer.post(url + "read/", {"message_id": reply.data["message"]["id"]}, format="json").status_code, 200)
        self.assertTrue(ChannelSubscription.objects.get(channel_id=channel["id"], employee=self.bob.employee).following)

    def test_independent_channels_do_not_bypass_read_deny_or_it_pilot(self):
        channel = self.create().data
        url = self.root + channel["id"] + "/"
        self.deny("slack.channel.read", scope="own_unit")
        self.assertFalse(self.client.get("/api/v2/messaging/departments/").data["can_create_independent"])
        self.assertEqual(self.client.get(url).status_code, 404)
        self.assertEqual(self.client.get(url + "messages/").status_code, 404)
        self.assertNotIn(channel["id"], [row["id"] for row in self.client.get(self.root).data["results"]])
        self.assertIsNone(channel_event(self.alice.pk, {"channel_id": channel["id"], "kind": "message.created"}))
        with override_settings(MESSAGING_PILOT_ENABLED=True, MESSAGING_PILOT_UNIT_IDS=[str(self.it.pk)]):
            self.assertEqual(self.as_person(self.owner).get(url).status_code, 403)
            self.assertEqual(self.as_person(self.bob).post(self.root, {"name": "Fuera"}, format="json").status_code, 403)

    def test_archived_independent_channel_preserves_its_name_and_history(self):
        channel = self.create().data
        url = self.root + channel["id"] + "/"
        result = self.client.patch(url, {"archived": True, "version": 1}, format="json")
        self.assertEqual(result.status_code, 200)
        self.assertEqual(self.create().status_code, 409)
        self.assertNotIn(channel["id"], [row["id"] for row in self.client.get(self.root).data["results"]])
        self.assertIn(channel["id"], [row["id"] for row in self.client.get(self.root + "?archived=true").data["results"]])

    @patch("boldApp.mensajeria.channel_media.google")
    @patch("boldApp.mensajeria.channel_media.storage_user")
    @patch("boldApp.mensajeria.channel_media.drive_folder")
    def test_drive_uses_the_independent_group_without_a_fictitious_department(self, folder, storage, google):
        channel = self.create().data
        ImageStorageRoot.objects.create(user=self.alice.employee.user_account, subject="synthetic", client_id="synthetic",
            google_email="synthetic@bold.gt", folder_id="private_root", folder_name="BOLD APP", active=True)
        folder.return_value = "private_channel_folder"
        storage.return_value = object()
        google.side_effect = [{"files": []}, {"id": "private_remote_file"}]
        image = io.BytesIO()
        Image.new("RGB", (20, 20), "red").save(image, "PNG")
        response = self.client.post(self.root + channel["id"] + "/messages/", {"body": "", "client_id": str(uuid.uuid4()),
            "file": SimpleUploadedFile("test.png", image.getvalue(), content_type="image/png")}, format="multipart")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(folder.call_args.args[1][1], ("independent", "Canales independientes"))
        self.assertEqual(ChannelMedia.objects.count(), 1)
        self.assertEqual(ChannelMessage.objects.filter(channel_id=channel["id"]).count(), 1)
        self.assertNotIn("private_remote_file", str(response.data))
