"""In-memory Drive transport for tests; real image persistence/ACLs still run."""
import uuid
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import patch

from .models import ImageStorageRoot


@contextmanager
def isolated_drive_storage(owner):
    ImageStorageRoot.objects.create(user=owner, subject="test-subject", client_id="test-client",
                                   folder_id="test-root", folder_name="Test images", active=True)
    blobs = {}

    def drive(user, method, path, **options):
        if method == "GET" and path == "/files":
            return {"files": []}
        if method == "POST" and path == "/files":
            identity = "test-" + uuid.uuid4().hex
            if "files" in options:
                blobs[identity] = options["files"]["file"][1]
            return {"id": identity}
        if method == "GET" and options.get("raw"):
            return SimpleNamespace(content=blobs[path.removeprefix("/files/")])
        if method == "PATCH":
            return {}
        raise AssertionError(f"Unexpected Drive request: {method} {path}")

    with patch("boldApp.workspace.image_storage.storage_user", return_value=owner), \
         patch("boldApp.workspace.image_views.storage_user", return_value=owner), \
         patch("boldApp.workspace.image_storage.google", side_effect=drive) as transport, \
         patch("boldApp.workspace.image_views.google", side_effect=drive):
        yield transport
