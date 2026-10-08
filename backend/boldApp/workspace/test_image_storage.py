import base64
import uuid
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase, TestCase
from rest_framework.exceptions import ValidationError
from rest_framework.test import APIClient

from boldApp.core.models import Employee, UserAccount
from .image_storage import decode_image, image_id, ImageHTML, folders_for, store_instance_images, can_read, can_read_document
from .models import ImageBinding, ImageStorageRoot, StoredImage, ImageDocument


class ImageStorageUnitTests(SimpleTestCase):
    def test_only_image_bytes_are_accepted(self):
        image = "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\npixels").decode()
        self.assertEqual(decode_image(image)[0], "image/png")
        for value in ("https://example.com/a.png", "data:image/svg+xml;base64,PHN2Zz4=", "data:image/png;base64,aHRtbA=="):
            with self.assertRaises(ValidationError):
                decode_image(value)

    def test_image_references_allow_assignment_but_not_arbitrary_paths(self):
        identity = uuid.uuid4()
        self.assertEqual(image_id(f"/api/v2/media/images/{identity}/?assignment={uuid.uuid4()}"), identity)
        self.assertIsNone(image_id("https://example.com/image.png"))
        self.assertIsNone(image_id("http://[invalid"))

    @patch("boldApp.workspace.image_storage.persist_image", return_value="/api/v2/media/images/00000000-0000-0000-0000-000000000001/")
    def test_rich_text_replaces_only_image_source_and_preserves_formatting(self, persist):
        parser = ImageHTML("task", "description", "request")
        parser.feed('<!--bold-rich-text--><p><b>Título</b>&amp;<img src="data:image/png;base64,AAAA" onerror="bad()"></p>')
        result = "".join(parser.output)
        self.assertIn("<b>Título</b>&amp;", result)
        self.assertNotIn("data:image", result)
        self.assertNotIn("onerror", result)
        persist.assert_called_once_with("data:image/png;base64,AAAA", "task", "description", "request")

    def test_changing_text_does_not_attempt_to_migrate_an_unchanged_avatar(self):
        user = SimpleNamespace(pk=uuid.uuid4(), _meta=SimpleNamespace(model_name="useraccount"))
        store_instance_images(user, fields=["biography"])


class ImageStorageReadTests(TestCase):
    def setUp(self):
        self.owner = UserAccount.objects.create_user(email="images@bold.gt", employee=Employee.objects.create(full_name="Images"))
        self.other = UserAccount.objects.create_user(email="other-images@bold.gt", employee=Employee.objects.create(full_name="Other"))
        self.root = ImageStorageRoot.objects.create(user=self.owner, subject="google-subject", client_id="client", google_email="images@bold.gt", folder_id="folder", folder_name="Images", active=True)
        self.image = StoredImage.objects.create(root=self.root, drive_id="image", mime_type="image/png", size_bytes=10)
        self.client = APIClient()
        self.client.force_authenticate(self.other)

    @patch("boldApp.workspace.image_views.google")
    def test_unbound_images_never_fetch_drive(self, google):
        response = self.client.get(f"/api/v2/media/images/{self.image.pk}/")
        self.assertEqual(response.status_code, 404)
        google.assert_not_called()

    @patch("boldApp.workspace.image_views.google")
    def test_removed_profile_image_is_not_readable(self, google):
        ImageBinding.objects.create(image=self.image, resource_kind="profile", resource_id=self.owner.pk, field="avatar_url")
        response = self.client.get(f"/api/v2/media/images/{self.image.pk}/")
        self.assertEqual(response.status_code, 404)
        google.assert_not_called()


class AdditionalImageContextsTests(SimpleTestCase):
    def test_timeline_images_use_project_timeline_folder(self):
        project = SimpleNamespace(pk=uuid.uuid4(), name="Proyecto")
        comment = SimpleNamespace(_meta=SimpleNamespace(model_name="comment"), pk=uuid.uuid4(), task="unused", image_section="timeline", image_project_id=project.pk)
        with patch("boldApp.tareas.models.Project.objects.get", return_value=project):
            path = folders_for(comment, "body")
        self.assertEqual(path[-1], ("timeline", "Cronograma"))
        self.assertIn((f"project:{project.pk}", project.name), path)

    @patch("boldApp.core.permissions.HasActiveAssignment.has_permission", return_value=True)
    def test_internal_suggestion_images_require_manage_permission(self, assignment):
        suggestion = SimpleNamespace(pk=uuid.uuid4(), id=uuid.uuid4(), unit="unit", deleted_at=None)
        with patch("boldApp.sugerencias.views.SuggestionViewSet.get_queryset") as queryset, patch("boldApp.sugerencias.views.SuggestionViewSet._can", return_value=False):
            queryset.return_value.filter.return_value.exists.return_value = True
            self.assertFalse(can_read(SimpleNamespace(), "suggestion", suggestion, "internal_note"))
            self.assertTrue(can_read(SimpleNamespace(), "suggestion", suggestion, "message"))

    def test_workspace_images_are_private_to_owner(self):
        document = SimpleNamespace(kind="workspace", owner_id=uuid.uuid4())
        self.assertFalse(can_read_document(SimpleNamespace(user=SimpleNamespace(pk=uuid.uuid4())), document))


    @patch("boldApp.calendario.service.google_request", return_value={"description": "/api/v2/media/images/00000000-0000-0000-0000-000000000002/"})
    @patch("boldApp.workspace.models.GoogleConnection.objects.filter")
    def test_calendar_requires_requested_image_still_in_event(self, connections, google):
        connections.return_value.first.return_value = SimpleNamespace(subject="subject")
        document = SimpleNamespace(kind="calendar", external_id="event")
        image = SimpleNamespace(pk="00000000-0000-0000-0000-000000000001")
        self.assertFalse(can_read_document(SimpleNamespace(user="user"), document, image))


class TaskImageSaveOrderTests(SimpleTestCase):
    def test_upload_precedes_task_save_and_does_not_open_a_transaction(self):
        from django.db import connection
        from boldApp.tareas.models import Task
        from boldApp.tareas.serializers import TaskSerializer
        task = Task(title="Imagen", description="Anterior", image_origin_set=True)
        serializer = TaskSerializer(instance=task, context={"request": SimpleNamespace()})
        serializer._validated_data = {"description": '<!--bold-rich-text--><img src="data:image/png;base64,AAAA">'}
        order = []
        def upload(draft, request, **options):
            self.assertFalse(connection.in_atomic_block)
            self.assertFalse(options["write"])
            draft.description = "canonical-image"
            order.append("upload")
        def save(**kwargs):
            self.assertEqual(serializer.validated_data["description"], "canonical-image")
            order.append("save")
            return task
        with patch("boldApp.tareas.serializers.store_instance_images", side_effect=upload), patch("boldApp.workspace.image_storage.DriveImagesMixin.save", side_effect=save):
            self.assertIs(serializer.save(), task)
        self.assertEqual(order, ["upload", "save"])
