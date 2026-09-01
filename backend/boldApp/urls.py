from rest_framework.routers import DefaultRouter

from .views import (
    ActivityLogViewSet,
    AttachmentViewSet,
    CommentViewSet,
    NotificationViewSet,
    ProjectMemberViewSet,
    ProjectViewSet,
    SectionViewSet,
    TagViewSet,
    TaskDependencyViewSet,
    TaskFollowerViewSet,
    TaskProjectViewSet,
    TaskStatusViewSet,
    TaskTagViewSet,
    TaskViewSet,
    UserViewSet,
    WorkspaceMemberViewSet,
    WorkspaceViewSet,
)


# Define el router de DRF con los 17 endpoints del modulo de tareas.
router = DefaultRouter()
router.register(r"users", UserViewSet, basename="user")
router.register(r"workspaces", WorkspaceViewSet, basename="workspace")
router.register(r"workspace-members", WorkspaceMemberViewSet, basename="workspace-member")
router.register(r"projects", ProjectViewSet, basename="project")
router.register(r"project-members", ProjectMemberViewSet, basename="project-member")
router.register(r"sections", SectionViewSet, basename="section")
router.register(r"task-statuses", TaskStatusViewSet, basename="task-status")
router.register(r"tasks", TaskViewSet, basename="task")
router.register(r"task-projects", TaskProjectViewSet, basename="task-project")
router.register(r"task-dependencies", TaskDependencyViewSet, basename="task-dependency")
router.register(r"comments", CommentViewSet, basename="comment")
router.register(r"attachments", AttachmentViewSet, basename="attachment")
router.register(r"task-followers", TaskFollowerViewSet, basename="task-follower")
router.register(r"activity-logs", ActivityLogViewSet, basename="activity-log")
router.register(r"tags", TagViewSet, basename="tag")
router.register(r"task-tags", TaskTagViewSet, basename="task-tag")
router.register(r"notifications", NotificationViewSet, basename="notification")


urlpatterns = router.urls
