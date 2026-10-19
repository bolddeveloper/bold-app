"""Contextual workflows. Personal organization never changes project completion."""
from collections import Counter
import re
from uuid import UUID, uuid4

from django.db import transaction
from django.db.models import Q, F
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView
from boldApp.core.permissions import HasActiveAssignment
from boldApp.core.authorization import check_and_log
from .models import Pipeline, PersonalPipelineTask, Project, Task, TaskProject, TaskStatus
from .views import AssignmentScopedViewSetMixin


def default_stages():
    return [dict(id=str(uuid4()), name=name, description="", color=color, probability=probability, manual=False, kind=kind)
            for name, color, probability, kind in [("Pendiente", "#6b7280", 25, "open"), ("En curso", "#3b82f6", 50, "open"),
                ("En revisión", "#f59e0b", 75, "open"), ("Completada", "#16a34a", 100, "completed")]]


def ensure_project_pipeline(project):
    with transaction.atomic():
        Project.objects.select_for_update().get(pk=project.pk)
        pipeline = Pipeline.objects.filter(project=project, is_default=True).first()
        if pipeline:
            return pipeline
        pipeline = Pipeline.objects.filter(project=project).first()
        if pipeline:
            pipeline.is_default = True
            pipeline.save(update_fields=["is_default"])
            return pipeline
        return Pipeline.objects.create(project=project, name="General", is_default=True, stages=default_stages())


def personal_pipeline(employee):
    return Pipeline.objects.get_or_create(employee=employee, defaults={"name": "Personal", "is_default": True, "stages": default_stages()})[0]


def find_stage(pipeline, stage_id):
    stage = next((stage for stage in pipeline.stages if str(stage["id"]) == str(stage_id)), None)
    if stage is None:
        raise ValidationError({"stage": "La etapa no pertenece al pipeline seleccionado."})
    return stage


def matching_stage(pipeline, status):
    if status.is_final:
        stage = next((s for s in pipeline.stages if s["kind"] == "completed"), None)
        if not stage:
            raise ValidationError("Este pipeline no tiene Completada. Agrega esa etapa antes de completar sus tareas.")
        return stage
    if status.category == "failed":
        stage = next((s for s in pipeline.stages if s["kind"] == "failed"), None)
        if stage:
            return stage
    normal = [s for s in pipeline.stages if s["kind"] == "open"]
    return next((s for s in normal if s["name"].casefold() == status.name.casefold()),
                normal[min(1, len(normal) - 1)] if status.category == "in_progress" else normal[0])


def initialize_link(link):
    if not link.pipeline_id:
        link.pipeline = ensure_project_pipeline(link.project)
    if link.pipeline.project_id != link.project_id:
        raise ValidationError({"pipeline": "El pipeline no pertenece al proyecto de la tarea."})
    if not link.pipeline_stage:
        link.pipeline_stage = matching_stage(link.pipeline, link.task.status)["id"]
    find_stage(link.pipeline, link.pipeline_stage)


def aggregate_kind(task):
    links = list(task.task_projects.filter(project__deleted_at__isnull=True).select_related("pipeline"))
    kinds = [find_stage(link.pipeline, link.pipeline_stage)["kind"] for link in links if link.pipeline_id and link.pipeline_stage]
    if not kinds:
        return None
    if all(kind == "completed" for kind in kinds):
        return "completed"
    if all(kind in {"completed", "failed"} for kind in kinds):
        return "failed"
    if all(kind == "open" for kind in kinds) and all(str(link.pipeline_stage) == link.pipeline.stages[0]["id"] for link in links if link.pipeline_id):
        return "todo"
    return "in_progress"


def aggregate_status(task, kind):
    status = TaskStatus.objects.filter(unit=task.unit, category=kind, is_final=(kind == "completed")).first()
    if not status:
        name = {"completed": "Completada", "failed": "Fallida", "in_progress": "En curso", "todo": "Pendiente"}[kind]
        base_name = name
        suffix = 1
        while TaskStatus.objects.filter(unit=task.unit, name=name).exists():
            suffix += 1
            name = f"{base_name} ({suffix})"
        status = TaskStatus.objects.create(unit=task.unit, category=kind, name=name, position=100, is_final=(kind == "completed"))
    task.status = status
    task.completed_at = (task.completed_at or timezone.now()) if kind == "completed" else None


def sync_task(task):
    kind = aggregate_kind(task)
    if kind:
        aggregate_status(task, kind)
        task._pipeline_sync = True
        try:
            task.save(update_fields=["status", "completed_at", "updated_at"])
        finally:
            task._pipeline_sync = False


def legacy_status_change(task):
    """Keep existing task/bridge clients valid without bypassing contextual completion."""
    if getattr(task, "_pipeline_sync", False):
        return
    previous = getattr(task, "_previous_status_id", None)
    if previous is None or previous == task.status_id:
        return
    links = list(task.task_projects.filter(project__deleted_at__isnull=True).select_related("pipeline", "project"))
    for link in links:
        if not link.pipeline_id:
            initialize_link(link)
            TaskProject.objects.filter(pk=link.pk).update(pipeline=link.pipeline, pipeline_stage=link.pipeline_stage)
    if not links:
        if task.status.is_final:
            pipeline = personal_pipeline(task.created_by_assignment.employee)
            matching_stage(pipeline, task.status)
        return
    project_id = getattr(task, "_pipeline_project_id", None)
    targets = [link for link in links if str(link.project_id) == str(project_id)] if project_id else links if len(links) == 1 else []
    if not targets:
        if task.status.is_final and aggregate_kind(task) == "completed":
            return
        raise ValidationError("Selecciona el pipeline de proyecto. Para completar esta tarea, debe estar en Completada en todos sus pipelines.")
    for link in targets:
        stage = matching_stage(link.pipeline, task.status)
        TaskProject.objects.filter(pk=link.pk).update(pipeline_stage=stage["id"])
    aggregate_status(task, aggregate_kind(task))


def validate_stages(rows):
    if not isinstance(rows, list) or not 1 <= len(rows) <= 100:
        raise ValidationError({"stages": "Incluye entre 1 y 100 etapas."})
    result, ids, names, terminals, previous = [], set(), set(), set(), -1
    for row in rows:
        if not isinstance(row, dict):
            raise ValidationError({"stages": "Cada etapa debe ser un objeto."})
        try:
            key = str(UUID(str(row.get("id") or uuid4())))
            value = row.get("probability", 0)
            probability = int(value)
            if isinstance(value, float) and value != probability:
                raise ValueError()
        except (ValueError, TypeError):
            raise ValidationError({"stages": "Identificador o porcentaje inválido."})
        kind = row.get("kind", "open")
        name = str(row.get("name", "")).strip()
        color = str(row.get("color", "#6b7280"))
        description = str(row.get("description", "")).strip()
        if kind not in {"open", "completed", "failed"} or not name or len(name) > 80 or len(description) > 1000 or not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
            raise ValidationError({"stages": "Revisa nombre, descripción, color y tipo de cada etapa."})
        if kind in {"completed", "failed"}:
            name = "Completada" if kind == "completed" else "Fallida"
        if key in ids or name.casefold() in names:
            raise ValidationError({"stages": "No repitas nombres ni identificadores dentro del pipeline."})
        if kind == "open":
            if terminals or not 0 <= probability <= 99 or probability < previous:
                raise ValidationError({"stages": "Los porcentajes normales deben ir de menor a mayor (0–99), antes de las etapas finales."})
            previous = probability
        else:
            if kind in terminals or kind == "completed" and "failed" in terminals:
                raise ValidationError({"stages": "Completada y Fallida no se repiten y deben quedar al final, en ese orden."})
            terminals.add(kind)
            probability = 100 if kind == "completed" else 0
            name = "Completada" if kind == "completed" else "Fallida"
        ids.add(key); names.add(name.casefold())
        result.append(dict(id=key, name=name, description=description, color=color, probability=probability, kind=kind, manual=bool(row.get("manual", False))))
    if not any(s["kind"] == "open" for s in result):
        raise ValidationError({"stages": "Conserva al menos una etapa normal."})
    return result


class PipelineView(AssignmentScopedViewSetMixin, APIView):
    permission_classes = [HasActiveAssignment]

    def project(self, pk):
        try:
            pk = UUID(str(pk))
        except (ValueError, TypeError):
            raise ValidationError({"project": "Selecciona un proyecto válido."})
        project = self.visible_projects().filter(pk=pk).first()
        if not project:
            raise NotFound("Proyecto no disponible.")
        return project

    def require_project_management(self, project):
        assignment = self.request.assignment
        result = check_and_log(assignment=assignment, permission_code="tasks.project.manage", target_unit=project.unit,
                               resource_id=project.pk, request=self.request)
        if result.allowed:
            return
        # Responsibility is structural; explicit denials and MFA remain authoritative.
        responsible = project.owner_assignment_id == assignment.pk
        department_lead = assignment.position.direct_reports.filter(unit_id=project.unit_id).exists()
        if result.reason_code == "default_deny" and (responsible or department_lead):
            return
        raise PermissionDenied(result.reason)

    def pipeline(self, pk, write=False):
        pipeline = Pipeline.objects.filter(pk=pk).select_related("project", "employee").first()
        if not pipeline:
            raise NotFound()
        if pipeline.project_id:
            self.project(pipeline.project_id)
            if write:
                self.require_project_management(pipeline.project)
        elif pipeline.employee_id != self.request.assignment.employee_id:
            raise NotFound()
        return pipeline

    def tasks(self, pipeline):
        candidates = Task.objects.filter(parent_task__isnull=True)
        if pipeline.project_id:
            candidates = candidates.filter(task_projects__pipeline=pipeline, task_projects__project__deleted_at__isnull=True)
        if not pipeline.project_id or self.request.query_params.get("mine") == "1":
            assignment = self.request.assignment
            candidates = candidates.filter(Q(created_by_assignment=assignment) | Q(assignee_assignment=assignment) | Q(followers__assignment=assignment))
        return self.visible_tasks(candidates).distinct()

    def pack(self, pipeline):
        if pipeline.project_id:
            counts = Counter(str(stage) for stage in pipeline.project_tasks.filter(task__deleted_at__isnull=True).values_list("pipeline_stage", flat=True))
            try:
                self.require_project_management(pipeline.project)
                manage = True
            except PermissionDenied:
                manage = False
        else:
            ids = list(self.tasks(pipeline).values_list("pk", flat=True))
            counts = Counter(str(stage) for stage in pipeline.personal_tasks.filter(task_id__in=ids).values_list("stage_id", flat=True))
            assigned = sum(counts.values())
            counts[pipeline.stages[0]["id"]] += len(ids) - assigned
            manage = True
        return dict(id=str(pipeline.pk), name=pipeline.name, project=str(pipeline.project_id) if pipeline.project_id else None,
                    is_default=pipeline.is_default, version=pipeline.version, can_manage=manage,
                    stages=[{**stage, "task_count": counts[stage["id"]]} for stage in pipeline.stages])

    def get(self, request, pipeline_id=None):
        if pipeline_id:
            return Response(self.pack(self.pipeline(pipeline_id)))
        project_id = request.query_params.get("project")
        if project_id:
            project = self.project(project_id)
            ensure_project_pipeline(project)
            rows = Pipeline.objects.filter(project=project).select_related("project")
        else:
            rows = [personal_pipeline(request.assignment.employee)]
        return Response({"items": [self.pack(pipeline) for pipeline in rows]})

    @transaction.atomic
    def post(self, request):
        project = self.project(request.data.get("project"))
        self.require_project_management(project)
        ensure_project_pipeline(project)
        name = str(request.data.get("name", "")).strip()
        if not name or len(name) > 80:
            raise ValidationError({"name": "Indica un nombre de hasta 80 caracteres."})
        stages = validate_stages(request.data.get("stages", default_stages()))
        Project.objects.select_for_update().get(pk=project.pk)
        make_default = bool(request.data.get("is_default"))
        if make_default:
            Pipeline.objects.filter(project=project, is_default=True).update(is_default=False, version=F("version") + 1)
        pipeline = Pipeline.objects.create(project=project, name=name, stages=stages, is_default=make_default)
        return Response(self.pack(pipeline), status=201)

    @transaction.atomic
    def put(self, request, pipeline_id):
        allowed = self.pipeline(pipeline_id, write=True)
        if allowed.project_id:
            Project.objects.select_for_update().get(pk=allowed.project_id)
        pipeline = Pipeline.objects.select_for_update().select_related("project").get(pk=pipeline_id)
        if request.data.get("version") != pipeline.version:
            raise ValidationError("El pipeline cambió. Actualiza antes de guardar para conservar los cambios de otras personas.")
        stages = validate_stages(request.data.get("stages"))
        name = str(request.data.get("name", "")).strip()
        if not name or len(name) > 80:
            raise ValidationError({"name": "Indica un nombre de hasta 80 caracteres."})
        remaining = {s["id"] for s in stages}
        transfers = request.data.get("transfers", {})
        if not isinstance(transfers, dict):
            raise ValidationError({"transfers": "Indica la etapa de destino de cada traslado."})
        old_ids = {s["id"] for s in pipeline.stages}
        for old in old_ids - remaining:
            project_rows = pipeline.project_tasks.filter(pipeline_stage=old, task__deleted_at__isnull=True)
            personal_rows = pipeline.personal_tasks.filter(stage_id=old, task__deleted_at__isnull=True)
            virtual = list(self.tasks(pipeline).exclude(personal_pipeline_tasks__pipeline=pipeline)) if not pipeline.project_id and old == pipeline.stages[0]["id"] else []
            if virtual:
                target = transfers.get(old)
                if target not in remaining:
                    raise ValidationError("Traslada las tareas de la etapa personal inicial antes de eliminarla.")
                PersonalPipelineTask.objects.bulk_create([PersonalPipelineTask(pipeline=pipeline, task=task, stage_id=target) for task in virtual])

            if project_rows.exists() or personal_rows.exists():
                target = transfers.get(old)
                if target not in remaining:
                    raise ValidationError("Traslada las tareas de las etapas eliminadas antes de guardar.")
                project_rows.update(pipeline_stage=target)
                personal_rows.update(stage_id=target)
            pipeline.project_tasks.filter(pipeline_stage=old, task__deleted_at__isnull=False).update(pipeline_stage=stages[0]["id"])
            pipeline.personal_tasks.filter(stage_id=old, task__deleted_at__isnull=False).update(stage_id=stages[0]["id"])
        pipeline.name = name; pipeline.stages = stages; pipeline.version += 1
        if request.data.get("is_default") and pipeline.project_id:
            Project.objects.select_for_update().get(pk=pipeline.project_id)
            Pipeline.objects.filter(project_id=pipeline.project_id, is_default=True).exclude(pk=pipeline.pk).update(is_default=False, version=F("version") + 1)
            pipeline.is_default = True
        pipeline.save()
        for task in Task.objects.filter(task_projects__pipeline=pipeline).distinct():
            sync_task(task)
        return Response(self.pack(pipeline))

    @transaction.atomic
    def delete(self, request, pipeline_id):
        pipeline = self.pipeline(pipeline_id, write=True)
        if not pipeline.project_id:
            raise ValidationError("El pipeline personal no se puede eliminar.")
        Project.objects.select_for_update().get(pk=pipeline.project_id)
        other = Pipeline.objects.filter(project_id=pipeline.project_id).exclude(pk=pipeline.pk)
        if not other.exists():
            raise ValidationError("Conserva al menos un pipeline en el proyecto.")
        target_id = request.data.get("target_pipeline")
        if target_id:
            try:
                target_id = UUID(str(target_id))
            except (ValueError, TypeError):
                raise ValidationError({"target_pipeline": "Selecciona un pipeline de destino válido."})
        target = other.filter(pk=target_id).first() if target_id else None
        if pipeline.project_tasks.filter(task__deleted_at__isnull=True).exists():
            if target is None:
                raise ValidationError("Selecciona el pipeline y etapa de destino para trasladar sus tareas.")
            stage = find_stage(target, request.data.get("target_stage"))
            pipeline.project_tasks.update(pipeline=target, pipeline_stage=stage["id"])
        if pipeline.project_tasks.exists():
            target = target or other.first()
            pipeline.project_tasks.update(pipeline=target, pipeline_stage=target.stages[0]["id"])
        was_default = pipeline.is_default
        pipeline.delete()
        if was_default:
            replacement = target or other.first()
            replacement.is_default = True; replacement.save(update_fields=["is_default"])
        if target:
            for task in Task.objects.filter(task_projects__pipeline=target).distinct():
                sync_task(task)
        return Response(status=204)


class PipelineBoardView(PipelineView):
    def get(self, request, pipeline_id):
        from .serializers import TaskSerializer
        pipeline = self.pipeline(pipeline_id)
        tasks = list(self.tasks(pipeline).select_related("status", "assignee_assignment__employee", "created_by_assignment__employee").order_by("created_at"))
        ids = [task.pk for task in tasks]
        if pipeline.project_id:
            placements = {str(task): str(stage) for task, stage in pipeline.project_tasks.filter(task_id__in=ids).values_list("task_id", "pipeline_stage")}
        else:
            placements = {str(task): str(stage) for task, stage in pipeline.personal_tasks.filter(task_id__in=ids).values_list("task_id", "stage_id")}
        rows = TaskSerializer(tasks, many=True, context={"request": request}).data
        for row in rows:
            row["pipeline_read_only"] = False
        return Response({"pipeline": self.pack(pipeline), "tasks": rows,
                         "placements": {str(task.pk): placements.get(str(task.pk), pipeline.stages[0]["id"]) for task in tasks}})


def assign_stage(view, pipeline, task, stage_id):
    stage = find_stage(pipeline, stage_id)
    if pipeline.project_id:
        view.require_permission("tasks.task.update", task.unit, task.pk)
        link = TaskProject.objects.filter(task=task, project_id=pipeline.project_id).first()
        if not link:
            raise ValidationError("La tarea no está vinculada a este proyecto.")
        link.pipeline = pipeline; link.pipeline_stage = stage["id"]
        link.save(update_fields=["pipeline", "pipeline_stage"])
    else:
        assignment = view.request.assignment
        if not Task.objects.filter(pk=task.pk).filter(Q(created_by_assignment=assignment) | Q(assignee_assignment=assignment) | Q(followers__assignment=assignment)).exists():
            raise PermissionDenied("Solo puedes organizar tus propias tareas.")
        PersonalPipelineTask.objects.update_or_create(pipeline=pipeline, task=task, defaults={"stage_id": stage["id"]})
    return stage


class PipelineTaskView(PipelineView):
    @transaction.atomic
    def put(self, request, pipeline_id, task_id):
        self.pipeline(pipeline_id)
        pipeline = Pipeline.objects.select_for_update().select_related("project").get(pk=pipeline_id)
        task = self.visible_tasks().select_for_update().filter(pk=task_id).first()
        if not task:
            raise NotFound()
        stage = assign_stage(self, pipeline, task, request.data.get("stage"))
        return Response({"task": str(task.pk), "pipeline": str(pipeline.pk), "stage": stage["id"]})


class TaskPipelinesView(PipelineView):
    def get(self, request, task_id):
        task = self.visible_tasks().filter(pk=task_id).first()
        if not task:
            raise NotFound()
        assignment = request.assignment
        personal = None
        project_managed = task.task_projects.filter(project__deleted_at__isnull=True).exists()
        if not project_managed and Task.objects.filter(pk=task.pk).filter(Q(created_by_assignment=assignment) | Q(assignee_assignment=assignment) | Q(followers__assignment=assignment)).exists():
            pipeline = personal_pipeline(assignment.employee)
            row = pipeline.personal_tasks.filter(task=task).first()
            personal = {"pipeline": self.pack(pipeline), "stage": str(row.stage_id) if row else pipeline.stages[0]["id"]}
        projects = []
        readable_projects = self.visible_projects().values("pk")
        for link in task.task_projects.filter(project_id__in=readable_projects).select_related("pipeline", "project"):
            if not link.pipeline_id:
                initialize_link(link); link.save(update_fields=["pipeline", "pipeline_stage"])
            projects.append({"project": str(link.project_id), "project_name": link.project.name, "pipeline": self.pack(link.pipeline), "stage": str(link.pipeline_stage)})
        return Response({"personal": personal, "projects": projects, "project_managed": project_managed})
