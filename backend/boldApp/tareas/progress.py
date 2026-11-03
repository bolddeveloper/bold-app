from collections import defaultdict

from .models import PersonalPipelineTask, TaskProject


def pipeline_progress(task_ids, visible_projects, employee_id):
    result = defaultdict(list)
    def pack(pipeline, stage_id, project):
        stage = next((row for row in pipeline.stages if row["id"] == str(stage_id)), None)
        return {"project": str(project) if project else None, "label": stage["name"], "percent": stage["probability"]} if stage else None
    for link in TaskProject.objects.filter(task_id__in=task_ids, project__in=visible_projects, pipeline__isnull=False).select_related("pipeline"):
        value = pack(link.pipeline, link.pipeline_stage, link.project_id)
        if value:
            result[str(link.task_id)].append(value)
    for link in PersonalPipelineTask.objects.filter(task_id__in=task_ids, pipeline__employee_id=employee_id).select_related("pipeline"):
        value = pack(link.pipeline, link.stage_id, None)
        if value:
            result[str(link.task_id)].append(value)
    return result
