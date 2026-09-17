from django.db.models import Count, Q
from django.utils import timezone

from boldApp.administrativo.models import ResponsibilityTransfer
from boldApp.administrativo.registry import administrative_modules

from .models import ActivityLog, Project, ProjectMember, Task, TaskFollower


class TasksAdministrativeProvider:
    code = "tasks"
    title = "Tareas"

    def dashboard(self, request):
        today = timezone.localdate()
        tasks = Task.objects.select_related("unit", "status")
        projects = Project.objects.filter(deleted_at__isnull=True)
        by_unit = list(
            tasks.values("unit_id", "unit__name")
            .annotate(total=Count("id"), completed=Count("id", filter=Q(status__is_final=True)), overdue=Count("id", filter=Q(due_date__lt=today, status__is_final=False)))
            .order_by("unit__name")
        )
        return {
            "code": self.code,
            "title": self.title,
            "metrics": {
                "tasks_total": tasks.count(),
                "tasks_completed": tasks.filter(status__is_final=True).count(),
                "tasks_overdue": tasks.filter(due_date__lt=today, status__is_final=False).count(),
                "projects_active": projects.filter(is_archived=False, status__iexact="active").count(),
            },
            "by_unit": [
                {"unit_id": str(row["unit_id"]), "unit_name": row["unit__name"], "total": row["total"], "completed": row["completed"], "overdue": row["overdue"]}
                for row in by_unit
            ],
        }

    def activity(self, request, limit=10):
        rows = ActivityLog.objects.select_related("task", "actor_assignment__employee", "task__unit")[:limit]
        return [
            {
                "id": str(row.id),
                "module_code": self.code,
                "event_type": row.action,
                "actor": row.actor_assignment.employee.full_name,
                "unit": row.task.unit.name,
                "target_type": "task",
                "target_id": str(row.task_id),
                "label": row.task.title,
                "occurred_at": row.created_at,
            }
            for row in rows
        ]

    def audit_events(self, request, limit=500):
        rows = ActivityLog.objects.select_related("task", "task__unit", "actor_assignment__employee")[:limit]
        return [
            {
                "id": str(row.id),
                "module_code": self.code,
                "event_type": f"task.{row.action}",
                "actor_email": getattr(getattr(row.actor_assignment.employee, "user_account", None), "email", ""),
                "target_type": "task",
                "target_id": str(row.task_id),
                "outcome": "success",
                "changes": {"field": row.field_name, "before": row.old_value, "after": row.new_value},
                "metadata": {**(row.metadata_json or {}), "title": row.task.title, "unit": row.task.unit.name},
                "ip_address": None,
                "correlation_id": None,
                "occurred_at": row.created_at,
            }
            for row in rows
        ]

    def offboarding_preview(self, employee):
        assignments = employee.position_assignments.filter(is_active=True, released_at__isnull=True)
        assignment_ids = list(assignments.values_list("id", flat=True))
        resources = []
        for task in Task.objects.filter(assignee_assignment_id__in=assignment_ids).select_related("assignee_assignment", "unit"):
            resources.append({"module": self.code, "resource_type": "task", "resource_id": str(task.id), "label": task.title, "unit_id": str(task.unit_id), "unit_name": task.unit.name, "source_assignment": str(task.assignee_assignment_id), "required": False})
        for project in Project.objects.filter(owner_assignment_id__in=assignment_ids, deleted_at__isnull=True).select_related("owner_assignment", "unit"):
            resources.append({"module": self.code, "resource_type": "project_owner", "resource_id": str(project.id), "label": project.name, "unit_id": str(project.unit_id), "unit_name": project.unit.name, "source_assignment": str(project.owner_assignment_id), "required": True})
        for membership in ProjectMember.objects.filter(assignment_id__in=assignment_ids, status="active").select_related("project", "assignment", "project__unit"):
            resources.append({"module": self.code, "resource_type": "project_membership", "resource_id": str(membership.project_id), "label": membership.project.name, "unit_id": str(membership.project.unit_id), "unit_name": membership.project.unit.name, "source_assignment": str(membership.assignment_id), "required": False})
        return {"module": self.code, "title": self.title, "resources": resources}

    def transfer_offboarding(self, case, employee, mapping, default_target, allow_unassigned):
        assignments = employee.position_assignments.filter(is_active=True, released_at__isnull=True)
        assignment_ids = list(assignments.values_list("id", flat=True))
        completed = []

        def target_for(resource_type, resource_id):
            return mapping.get((self.code, resource_type, str(resource_id))) or default_target

        for task in Task.objects.select_for_update().filter(assignee_assignment_id__in=assignment_ids).select_related("assignee_assignment"):
            source = task.assignee_assignment
            target = target_for("task", task.id)
            if target and target.position.unit_id != task.unit_id:
                raise ValueError(f"La tarea {task.id} requiere un destino de la misma unidad.")
            if not target and not allow_unassigned:
                raise ValueError(f"La tarea {task.id} todavía no tiene destino.")
            task.assignee_assignment = target
            task.save(update_fields=["assignee_assignment", "updated_at"])
            completed.append(ResponsibilityTransfer.objects.create(offboarding_case=case, source_assignment=source, target_assignment=target, source_module=self.code, resource_type="task", resource_id=task.id, status=ResponsibilityTransfer.STATUS_COMPLETED, transferred_at=timezone.now()))

        for project in Project.objects.select_for_update().filter(owner_assignment_id__in=assignment_ids, deleted_at__isnull=True).select_related("owner_assignment"):
            source = project.owner_assignment
            target = target_for("project_owner", project.id)
            if not target or target.position.unit_id != project.unit_id:
                raise ValueError(f"El proyecto {project.id} requiere un propietario activo de la misma unidad.")
            project.owner_assignment = target
            project.save(update_fields=["owner_assignment", "updated_at"])
            completed.append(ResponsibilityTransfer.objects.create(offboarding_case=case, source_assignment=source, target_assignment=target, source_module=self.code, resource_type="project_owner", resource_id=project.id, status=ResponsibilityTransfer.STATUS_COMPLETED, transferred_at=timezone.now()))

        for membership in ProjectMember.objects.select_for_update().filter(assignment_id__in=assignment_ids, status="active").select_related("assignment", "project"):
            source = membership.assignment
            target = target_for("project_membership", membership.project_id)
            if target:
                ProjectMember.objects.update_or_create(
                    project=membership.project,
                    assignment=target,
                    defaults={"member_role": membership.member_role, "status": "active", "removed_at": None, "added_by_assignment": target},
                )
            membership.status = "removed"
            membership.removed_at = timezone.now()
            membership.save(update_fields=["status", "removed_at"])
            completed.append(ResponsibilityTransfer.objects.create(offboarding_case=case, source_assignment=source, target_assignment=target, source_module=self.code, resource_type="project_membership", resource_id=membership.project_id, status=ResponsibilityTransfer.STATUS_COMPLETED if target else ResponsibilityTransfer.STATUS_SKIPPED, transferred_at=timezone.now()))

        for follower in TaskFollower.objects.filter(assignment_id__in=assignment_ids).select_related("assignment", "task"):
            target = target_for("task_follower", follower.task_id)
            if target:
                TaskFollower.objects.get_or_create(task=follower.task, assignment=target, defaults={"notification_level": follower.notification_level, "added_by_assignment": target})
            follower.delete()
        return completed


administrative_modules.register(TasksAdministrativeProvider())
