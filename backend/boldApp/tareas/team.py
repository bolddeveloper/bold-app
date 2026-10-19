"""Opt-in company directory and read-only, person-owned task publications."""
from datetime import date, datetime, time, timedelta
from types import SimpleNamespace
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.core.cache import cache
from django.db import transaction
from django.db.models import Q
from django.utils.cache import patch_cache_control
from rest_framework import serializers
from rest_framework.exceptions import APIException, NotFound
from rest_framework.response import Response
from rest_framework.views import APIView

from boldApp.core.models import OrganizationalUnit, PositionAssignment
from boldApp.core.permissions import HasActiveAssignment
from .models import PersonalPipelineTask, Pipeline, Task, TeamProfile, TeamTaskShare
from .views import AssignmentScopedViewSetMixin


class TeamView(APIView):
    permission_classes = [HasActiveAssignment]

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        patch_cache_control(response, private=True, no_store=True)
        return response


def active_assignments():
    return PositionAssignment.objects.filter(is_active=True, released_at__isnull=True,
        employee__is_active=True, employee__user_account__is_active=True).select_related(
        "employee__user_account", "position__unit")


def eligible(assignment):
    return Task.objects.filter(Q(created_by_assignment=assignment) | Q(assignee_assignment=assignment)
        | Q(followers__assignment=assignment), deleted_at__isnull=True).distinct()


def readable(assignment, candidates):
    view = AssignmentScopedViewSetMixin()
    view.request = SimpleNamespace(assignment=assignment, user=assignment.employee.user_account, session={})
    return view.visible_tasks(candidates)


def shared_tasks(employee_id):
    """Recheck the publisher's participation and resource access on every read."""
    rows, roots, sections = {}, {}, []
    assignments = active_assignments().filter(employee_id=employee_id)
    for assignment in assignments:
        shared_ids = TeamTaskShare.objects.filter(employee_id=employee_id, source_assignment=assignment).values("task_id")
        published = list(readable(assignment, eligible(assignment).filter(pk__in=shared_ids)).select_related("status", "assignee_assignment__employee", "created_by_assignment__employee").prefetch_related("followers__assignment__employee"))
        for task in published:
            roots[str(task.pk)] = None
        frontier = published
        seen = set()
        while frontier:
            ids = [task.pk for task in frontier if task.pk not in seen]
            if not ids:
                break
            seen.update(ids)
            rows.update((str(task.pk), task) for task in frontier)
            frontier = list(readable(assignment, Task.objects.filter(parent_task_id__in=ids, deleted_at__isnull=True).exclude(pk__in=seen)).select_related("status", "assignee_assignment__employee", "created_by_assignment__employee").prefetch_related("followers__assignment__employee"))
    if roots:
        from .pipelines import personal_pipeline
        pipeline = personal_pipeline(assignment.employee)
        placements = {str(task): str(stage) for task, stage in PersonalPipelineTask.objects.filter(pipeline=pipeline, task_id__in=roots).values_list("task_id", "stage_id")}
        stage_ids = {stage["id"] for stage in pipeline.stages}
        roots = {identity: placements[identity] if placements.get(identity) in stage_ids else pipeline.stages[0]["id"] for identity in roots}
        used = set(roots.values())
        sections = [{"id": stage["id"], "label": stage["name"], "color": stage["color"], "probability": stage["probability"]} for stage in pipeline.stages if stage["id"] in used]
    return rows, roots, sections


def can_read_shared_task(request, task_id):
    """Narrow media grant. Never use this grant for comments or mutations."""
    if not getattr(request, "assignment", None):
        return False
    ancestors, cursor = [], str(task_id)
    while cursor and cursor not in ancestors:
        task = Task.objects.filter(pk=cursor, deleted_at__isnull=True).values("parent_task_id").first()
        if task is None:
            break
        ancestors.append(cursor)
        cursor = str(task["parent_task_id"]) if task["parent_task_id"] else None
    owners = TeamTaskShare.objects.filter(task_id__in=ancestors).values_list("employee_id", flat=True).distinct()
    return any(str(task_id) in shared_tasks(owner)[0] for owner in owners)


def task_data(task, section="unsectioned", detail=False):
    result = {
        "id": str(task.pk), "title": task.title, "description": task.description or "",
        "priority": task.priority, "start_date": task.start_date, "due_date": task.due_date,
        "completed_at": task.completed_at, "created_at": task.created_at,
        "status": str(task.status_id), "status_name": task.status.name,
        "status_category": task.status.category, "status_is_final": task.status.is_final,
        "status_color": task.status.color_hex,
        "assignee_assignment": str(task.assignee_assignment_id) if task.assignee_assignment_id else None,
        "assignee_name": task.assignee_assignment.employee.full_name if task.assignee_assignment_id else "Sin asignar",
        "created_by_name": task.created_by_assignment.employee.full_name,
        "parent_task": str(task.parent_task_id) if task.parent_task_id else None, "section": section,
        "collaborators": list(dict.fromkeys(follower.assignment.employee.full_name for follower in task.followers.all())),
    }
    if detail:
        result.update(recurrence=task.recurrence, tags=list(task.task_tags.values_list("tag__name", flat=True)),
            attachments=list(task.attachments.filter(deleted_at__isnull=True).values("id", "file_name", "file_url", "mime_type", "size_bytes")),
            voice_notes=[{key: value for key, value in note.items() if key != "data_url"} for note in task.voice_notes])
    return result


class PublicationInput(serializers.Serializer):
    task_ids = serializers.ListField(child=serializers.UUIDField(), max_length=1000, allow_empty=False)
    visible = serializers.BooleanField()


class CalendarPreference(serializers.Serializer):
    share_calendar = serializers.BooleanField()


class TeamSelfView(TeamView):

    def get(self, request):
        employee = request.assignment.employee
        profile = TeamProfile.objects.filter(employee=employee).first()
        rows, roots, _ = shared_tasks(employee.pk)
        return Response({"employee_id": str(employee.pk), "share_calendar": bool(profile and profile.share_calendar),
            "task_ids": list(roots), "inherited_ids": [identity for identity in rows if identity not in roots]})

    @transaction.atomic
    def put(self, request):
        data = PublicationInput(data=request.data)
        data.is_valid(raise_exception=True)
        # Serialize publication changes for all assignments of this person.
        type(request.assignment.employee).objects.select_for_update().get(pk=request.assignment.employee_id)
        ids = set(data.validated_data["task_ids"])
        if data.validated_data["visible"]:
            allowed = set(readable(request.assignment, eligible(request.assignment).filter(pk__in=ids)).values_list("id", flat=True))
            if ids != allowed:
                raise serializers.ValidationError("Solo puedes compartir tareas accesibles que creaste, tienes asignadas o en las que colaboras.")
            for identity in ids:
                TeamTaskShare.objects.update_or_create(employee=request.assignment.employee, task_id=identity,
                    defaults={"source_assignment": request.assignment})
        else:
            TeamTaskShare.objects.filter(employee=request.assignment.employee, task_id__in=ids).delete()
        return self.get(request)

    def patch(self, request):
        data = CalendarPreference(data=request.data)
        data.is_valid(raise_exception=True)
        TeamProfile.objects.update_or_create(employee=request.assignment.employee, defaults=data.validated_data)
        return self.get(request)


class TeamDirectoryView(TeamView):

    def get(self, request):
        departments = {str(unit.pk): {"id": str(unit.pk), "name": unit.name, "people": {}}
            for unit in OrganizationalUnit.objects.all()}
        for assignment in active_assignments():
            departments[str(assignment.position.unit_id)]["people"][str(assignment.employee_id)] = {
                "id": str(assignment.employee_id), "name": assignment.employee.full_name}
        return Response({"departments": [{**unit, "people": sorted(unit["people"].values(), key=lambda item: item["name"].casefold())}
            for unit in departments.values()]})


class TeamBoardView(TeamView):

    def get(self, request, employee_id, task_id=None):
        assignment = active_assignments().filter(employee_id=employee_id).first()
        if assignment is None:
            raise NotFound("Esta persona ya no está activa.")
        rows, roots, sections = shared_tasks(employee_id)
        stage_map = {stage["id"]: stage for stage in sections}
        def shared_data(task, stage_id, detail=False):
            result = task_data(task, stage_id, detail=detail)
            stage = stage_map.get(stage_id)
            if stage:
                result.update(stage=stage_id, stage_name=stage["label"], stage_color=stage["color"], stage_probability=stage["probability"])
            return result
        if task_id:
            task = rows.get(str(task_id))
            if task is None:
                raise NotFound("Esta tarea ya no está compartida.")
            descendants, frontier = [], [str(task_id)]
            while frontier:
                children = [identity for identity, item in rows.items() if str(item.parent_task_id) in frontier and identity not in descendants and identity != str(task_id)]
                descendants.extend(children)
                frontier = children
            result = shared_data(task, roots.get(str(task_id)), detail=True)
            result["subtasks"] = [shared_data(rows[identity], roots.get(str(task_id)), detail=True) for identity in descendants]
            return Response(result)
        return Response({"person": {"id": str(employee_id), "name": assignment.employee.full_name}, "board_name": Pipeline.objects.filter(employee_id=employee_id).values_list("name", flat=True).first() or "Personal", "grouping": "stages", "stages": sections, "sections": sections,
            "tasks": [shared_data(task, roots[identity]) for identity, task in rows.items() if identity in roots and str(task.parent_task_id) not in rows]})


class TeamVoiceView(TeamView):

    def get(self, request, employee_id, task_id):
        from .voice_notes import audio_response
        task = shared_tasks(employee_id)[0].get(str(task_id))
        if task is None:
            raise NotFound()
        return audio_response(task.voice_notes, request.query_params.get("note", ""))


class TeamMeetingsView(TeamView):

    def get(self, request, employee_id):
        from boldApp.calendario.models import CalendarDraft
        from boldApp.calendario.presence import meeting_window
        from boldApp.calendario.service import event_path, google_request
        from boldApp.workspace.models import GoogleConnection
        assignment = active_assignments().filter(employee_id=employee_id).first()
        if assignment is None:
            raise NotFound()
        if not TeamProfile.objects.filter(employee_id=employee_id, share_calendar=True).exists():
            return Response({"state": "hidden", "meetings": []})
        connection = GoogleConnection.objects.filter(user=assignment.employee.user_account).first()
        if not connection:
            return Response({"state": "disconnected", "meetings": []})
        try:
            day = date.fromisoformat(request.query_params.get("date", ""))
            zone = ZoneInfo(connection.time_zone)
        except (ValueError, ZoneInfoNotFoundError):
            raise serializers.ValidationError("Selecciona una fecha válida.")
        start = datetime.combine(day, time.min, tzinfo=zone)
        end = datetime.combine(day + timedelta(days=1), time.min, tzinfo=zone)
        key = f"team-meetings:{employee_id}:{day}:{connection.updated_at.isoformat()}"
        meetings = cache.get(key)
        if meetings is None:
            drafts = set(CalendarDraft.objects.filter(owner=assignment.employee.user_account).values_list("event_id", flat=True))
            meetings, page = [], None
            try:
                for _ in range(30):
                    params = {"timeMin": start.isoformat(), "timeMax": end.isoformat(), "singleEvents": "true", "maxResults": 250, "orderBy": "startTime"}
                    if page:
                        params["pageToken"] = page
                    result = google_request(assignment.employee.user_account, "GET", event_path(), params=params)
                    for event in result.get("items", []):
                        if event.get("id") not in drafts and meeting_window(event):
                            meetings.append({"id": event["id"], "title": "Ocupado" if event.get("visibility") in ("private", "confidential") else event.get("summary") or "Reunión",
                                "start": event["start"]["dateTime"], "end": event["end"]["dateTime"]})
                    page = result.get("nextPageToken")
                    if not page:
                        break
                if page:
                    return Response({"state": "unavailable", "meetings": []})
            except APIException:
                return Response({"state": "disconnected", "meetings": []})
            cache.set(key, meetings, 60)
        if not TeamProfile.objects.filter(employee_id=employee_id, share_calendar=True).exists():
            return Response({"state": "hidden", "meetings": []})
        return Response({"state": "shared", "time_zone": connection.time_zone, "meetings": meetings})
