from .pipelines import PipelineView, PipelineBoardView, PipelineTaskView, TaskPipelinesView
from django.urls import path
from .workspace_sharing import WorkspaceSharingView
from .workspace_library import WorkspaceLibraryView
from .personal_board import PersonalBoardView
from .team import TeamSelfView, TeamDirectoryView, TeamBoardView, TeamMeetingsView, TeamVoiceView
from rest_framework.routers import DefaultRouter

from .views import (
    ActivityLogViewSet,
    AttachmentViewSet,
    CommentViewSet,
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
    WebhookDeliveryViewSet,
    WebhookEndpointViewSet,
)


router = DefaultRouter()
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
router.register(r"webhook-endpoints", WebhookEndpointViewSet, basename="webhook-endpoint")
router.register(r"webhook-deliveries", WebhookDeliveryViewSet, basename="webhook-delivery")

urlpatterns = [
    path("workspace-library/", WorkspaceLibraryView.as_view()),
    path("task-pipelines/<uuid:task_id>/", TaskPipelinesView.as_view()),
    path("pipelines/", PipelineView.as_view()),
    path("pipelines/<uuid:pipeline_id>/", PipelineView.as_view()),
    path("pipelines/<uuid:pipeline_id>/board/", PipelineBoardView.as_view()),
    path("pipelines/<uuid:pipeline_id>/tasks/<uuid:task_id>/", PipelineTaskView.as_view()),
    path("my-team/self/", TeamSelfView.as_view()),
    path("my-team/directory/", TeamDirectoryView.as_view()),
    path("my-team/<uuid:employee_id>/board/", TeamBoardView.as_view()),
    path("my-team/<uuid:employee_id>/tasks/<uuid:task_id>/", TeamBoardView.as_view()),
    path("my-team/<uuid:employee_id>/tasks/<uuid:task_id>/voice-note/", TeamVoiceView.as_view()),
    path("my-team/<uuid:employee_id>/meetings/", TeamMeetingsView.as_view()),
    path("workspace-sharing/", WorkspaceSharingView.as_view()), path("personal-board/", PersonalBoardView.as_view())
] + router.urls
