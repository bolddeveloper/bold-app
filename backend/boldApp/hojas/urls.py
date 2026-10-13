from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import DirectoryView, FileViewSet, FolderViewSet, LibraryView

router = DefaultRouter()
router.register("files", FileViewSet, basename="sheet-file")
router.register("folders", FolderViewSet, basename="sheet-folder")
urlpatterns = [path("library/", LibraryView.as_view()), path("directory/", DirectoryView.as_view()), path("", include(router.urls))]
