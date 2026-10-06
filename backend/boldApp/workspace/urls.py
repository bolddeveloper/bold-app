from django.urls import path
from .oauth import ConnectionView, StartView, CallbackView
from .views import FilesView, FileView, CopyView, UploadView, DownloadView, DrivesView, PermissionsView, PermissionView, MoveView, AboutView, PreviewView
from .editors import EditorView
from .office import OfficeView
from .published import PublishedViewView

urlpatterns = [
    path("connection/", ConnectionView.as_view()),
    path("oauth/start/", StartView.as_view()),
    path("oauth/callback/", CallbackView.as_view()),
    path("files/", FilesView.as_view()),
    path("upload/", UploadView.as_view()),
    path("drives/", DrivesView.as_view()),
    path("about/", AboutView.as_view()),
    path("files/<str:identity>/", FileView.as_view()),
    path("files/<str:identity>/published-view/", PublishedViewView.as_view()),
    path("files/<str:identity>/open-office/", OfficeView.as_view()),
    path("files/<str:identity>/editor/", EditorView.as_view()),
    path("files/<str:identity>/copy/", CopyView.as_view()),
    path("files/<str:identity>/download/", DownloadView.as_view()),
    path("files/<str:identity>/permissions/", PermissionsView.as_view()),
    path("files/<str:identity>/permissions/<str:permission>/", PermissionView.as_view()),
    path("files/<str:identity>/move/", MoveView.as_view()),
    path("files/<str:identity>/preview/", PreviewView.as_view()),
]
