# Re-exporta todos los modelos del paquete para que Django los descubra
# correctamente al ejecutar makemigrations y para simplificar los imports
# en admin.py y serializers.py (from boldApp.models import Task, ...).

from .collaboration import ActivityLog, Attachment, Comment, TaskFollower
from .notifications import Notification
from .projects import Project, ProjectMember, Section, TaskStatus
from .tags import Tag, TaskTag
from .tasks import Task, TaskDependency, TaskProject
from .users import User
from .workspaces import Workspace, WorkspaceMember


__all__ = [
    "ActivityLog",
    "Attachment",
    "Comment",
    "Notification",
    "Project",
    "ProjectMember",
    "Section",
    "Tag",
    "Task",
    "TaskDependency",
    "TaskFollower",
    "TaskProject",
    "TaskStatus",
    "TaskTag",
    "User",
    "Workspace",
    "WorkspaceMember",
]
