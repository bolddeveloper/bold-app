import io
from copy import deepcopy
from uuid import uuid4
from django.core.management import call_command
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from boldApp.core.models import PositionAssignment, JobRolePermission, Permission
from boldApp.tareas.models import Project, Task, TaskProject, TaskStatus, Pipeline, PersonalPipelineTask
from boldApp.tareas.pipelines import default_stages, ensure_project_pipeline, personal_pipeline


@override_settings(SECURE_SSL_REDIRECT=False)
class PipelineTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("seed_demo_data", verbosity=0, stdout=io.StringIO())
        cls.owner = PositionAssignment.objects.select_related("employee__user_account", "position__unit").get(employee__user_account__email="ana@bold.gt", is_active=True)
        cls.reader = PositionAssignment.objects.select_related("employee__user_account", "position__unit").get(employee__user_account__email="carla@bold.gt", is_active=True)
        JobRolePermission.objects.update_or_create(job_role=cls.owner.position.job_role, permission=Permission.objects.get(code="tasks.project.manage"), scope_type="own_unit", defaults={"effect":"allow"})
        cls.status = TaskStatus.objects.filter(unit=cls.owner.position.unit, category="todo").first()

    def setUp(self):
        self.client = APIClient()
        self.login(self.owner)
        self.project = self.make_project("Pipeline project")
        self.pipeline = ensure_project_pipeline(self.project)
        self.task = Task.objects.create(unit=self.owner.position.unit, status=self.status, title="Pipeline task", priority="medium", created_by_assignment=self.owner, assignee_assignment=self.owner)
        self.link = TaskProject.objects.create(task=self.task, project=self.project, position=0, added_by_assignment=self.owner)

    def login(self, assignment):
        self.client.force_authenticate(assignment.employee.user_account)
        self.client.credentials(HTTP_X_ASSIGNMENT_ID=str(assignment.pk))

    def make_project(self, name):
        return Project.objects.create(unit=self.owner.position.unit, name=name, status="active", owner_assignment=self.owner, created_by_assignment=self.owner)

    def test_moving_link_to_another_project_uses_its_pipeline(self):
        project = self.make_project("Destination")
        pipeline = ensure_project_pipeline(project)
        response = self.client.patch(f"/api/v2/task-projects/{self.link.pk}/", {"project":str(project.pk),"section":None}, format="json")
        self.assertEqual(response.status_code,200,response.data)
        self.link.refresh_from_db()
        self.assertEqual(self.link.pipeline_id,pipeline.pk)
        self.assertEqual(str(self.link.pipeline_stage),pipeline.stages[0]["id"])

    def move(self, pipeline, stage, task=None):
        return self.client.put(f"/api/v2/pipelines/{pipeline.pk}/tasks/{(task or self.task).pk}/", {"stage": stage["id"]}, format="json")

    def test_move_returns_confirmed_completion_for_the_checkbox(self):
        result = self.move(self.pipeline, self.stage(self.pipeline, "completed"))
        self.assertEqual(result.status_code, 200, result.data)
        self.task.refresh_from_db()
        self.assertTrue(result.data["status_is_final"])
        self.assertEqual(result.data["status"], str(self.task.status_id))
        self.assertEqual(result.data["status_name"], self.task.status.name)
        result = self.move(self.pipeline, self.pipeline.stages[0])
        self.assertFalse(result.data["status_is_final"])

    def stage(self, pipeline, kind):
        return next(stage for stage in pipeline.stages if stage["kind"] == kind)

    def update(self, pipeline, stages, **extra):
        return self.client.put(f"/api/v2/pipelines/{pipeline.pk}/", {"name":pipeline.name,"version":pipeline.version,"stages":stages,**extra}, format="json")

    def test_personal_pipeline_is_unique_and_independent(self):
        result = self.client.get("/api/v2/pipelines/")
        self.assertEqual(result.status_code,200,result.data)
        pipeline = personal_pipeline(self.owner.employee)
        self.assertEqual(result.data["items"][0]["id"],str(pipeline.pk))
        personal_task = Task.objects.create(unit=self.owner.position.unit, status=self.status, title="Personal task", priority="medium", created_by_assignment=self.owner, assignee_assignment=self.owner)
        self.assertEqual(self.move(pipeline,self.stage(pipeline,"completed"),personal_task).status_code,200)
        personal_task.refresh_from_db();self.link.refresh_from_db()
        self.assertFalse(personal_task.status.is_final)
        self.assertEqual(str(self.link.pipeline_stage),self.pipeline.stages[0]["id"])
        board = self.client.get(f"/api/v2/pipelines/{pipeline.pk}/board/")
        self.assertEqual(board.data["placements"][str(personal_task.pk)],self.stage(pipeline,"completed")["id"])

    def test_project_completion_waits_for_every_project(self):
        other = self.make_project("Second pipeline project")
        link = TaskProject.objects.create(task=self.task,project=other,position=0,added_by_assignment=self.owner)
        second = ensure_project_pipeline(other)
        self.assertEqual(self.move(self.pipeline,self.stage(self.pipeline,"completed")).status_code,200)
        self.task.refresh_from_db();link.refresh_from_db()
        self.assertFalse(self.task.status.is_final)
        self.assertEqual(str(link.pipeline_stage),second.stages[0]["id"])
        self.assertEqual(self.move(second,self.stage(second,"completed")).status_code,200)
        self.task.refresh_from_db();self.assertTrue(self.task.status.is_final);self.assertIsNotNone(self.task.completed_at)
        self.move(second,second.stages[0]);self.task.refresh_from_db();self.assertFalse(self.task.status.is_final);self.assertIsNone(self.task.completed_at)

    def test_multiple_pipelines_one_assignment_per_project(self):
        result = self.client.post("/api/v2/pipelines/",{"project":str(self.project.pk),"name":"Alternative","stages":default_stages()},format="json")
        self.assertEqual(result.status_code,201,result.data)
        target = Pipeline.objects.get(pk=result.data["id"])
        self.assertEqual(self.move(target,target.stages[1]).status_code,200)
        self.link.refresh_from_db();self.assertEqual(self.link.pipeline_id,target.pk)
        self.assertEqual(TaskProject.objects.filter(task=self.task,project=self.project).count(),1)
        self.assertEqual(self.client.get(f"/api/v2/pipelines/{self.pipeline.pk}/board/").data["tasks"],[])

    def test_missing_completed_is_allowed_but_blocks_legacy_completion(self):
        stages = [stage for stage in self.pipeline.stages if stage["kind"]!="completed"]
        result = self.update(self.pipeline,stages)
        self.assertEqual(result.status_code,200,result.data)
        final = TaskStatus.objects.filter(unit=self.owner.position.unit,is_final=True).first()
        result = self.client.patch(f"/api/v2/tasks/{self.task.pk}/",{"status":str(final.pk)},format="json")
        self.assertEqual(result.status_code,400,result.data)
        self.task.refresh_from_db();self.assertFalse(self.task.status.is_final)

    def test_failed_is_closed_but_never_completed(self):
        stages = self.pipeline.stages + [dict(id=str(uuid4()),name="Fallida",description="",color="#dc2626",kind="failed",probability=0,manual=False)]
        self.assertEqual(self.update(self.pipeline,stages).status_code,200)
        self.pipeline.refresh_from_db()
        self.assertEqual(self.move(self.pipeline,self.stage(self.pipeline,"failed")).status_code,200)
        self.task.refresh_from_db();self.assertEqual(self.task.status.category,"failed");self.assertFalse(self.task.status.is_final)

    def test_foreign_stage_and_unrelated_task_are_rejected(self):
        other = self.make_project("Other")
        foreign = ensure_project_pipeline(other)
        self.assertEqual(self.move(self.pipeline,foreign.stages[0]).status_code,400)
        self.assertEqual(self.move(foreign,foreign.stages[0]).status_code,400)
        self.login(self.reader)
        self.assertIn(self.client.get(f"/api/v2/pipelines/{self.pipeline.pk}/").status_code,[403,404])
        self.assertIn(self.move(self.pipeline,self.pipeline.stages[0]).status_code,[403,404])
        personal = personal_pipeline(self.owner.employee)
        self.assertEqual(self.client.get(f"/api/v2/pipelines/{personal.pk}/").status_code,404)

    def test_stage_and_pipeline_removals_require_transfer(self):
        stages = self.pipeline.stages[1:]
        self.assertEqual(self.update(self.pipeline,stages).status_code,400)
        self.assertEqual(self.update(self.pipeline,stages,transfers={self.pipeline.stages[0]["id"]:stages[0]["id"]}).status_code,200)
        self.link.refresh_from_db();self.assertEqual(str(self.link.pipeline_stage),stages[0]["id"])
        self.assertEqual(self.client.delete(f"/api/v2/pipelines/{self.pipeline.pk}/").status_code,400)
        target = Pipeline.objects.create(project=self.project,name="Target",stages=default_stages())
        self.assertEqual(self.client.delete(f"/api/v2/pipelines/{self.pipeline.pk}/").status_code,400)
        result = self.client.delete(f"/api/v2/pipelines/{self.pipeline.pk}/",{"target_pipeline":str(target.pk),"target_stage":target.stages[0]["id"]},format="json")
        self.assertEqual(result.status_code,204,result.data)
        self.task.refresh_from_db();self.link.refresh_from_db();target.refresh_from_db()
        self.assertEqual(self.link.pipeline_id,target.pk);self.assertTrue(target.is_default)

    def test_invalid_probabilities_and_stale_editor_are_rejected(self):
        stages=deepcopy(self.pipeline.stages);stages[1]["probability"]=1
        self.assertEqual(self.update(self.pipeline,stages).status_code,400)
        self.assertEqual(self.update(self.pipeline,self.pipeline.stages,version=0).status_code,400)
        self.assertEqual(self.update(self.pipeline,self.pipeline.stages).status_code,200)
        self.assertEqual(self.update(self.pipeline,self.pipeline.stages).status_code,400)

    def test_creation_uses_selected_pipeline_atomically(self):
        target = Pipeline.objects.create(project=self.project,name="Explicit",stages=default_stages())
        result=self.client.post("/api/v2/tasks/",{"unit":str(self.owner.position.unit_id),"status":str(self.status.pk),"title":"Created in pipeline","priority":"medium","project":str(self.project.pk),"pipeline":str(target.pk),"pipeline_stage":target.stages[1]["id"]},format="json")
        self.assertEqual(result.status_code,201,result.data)
        link=TaskProject.objects.get(task_id=result.data["id"])
        self.assertEqual(link.pipeline_id,target.pk);self.assertEqual(str(link.pipeline_stage),target.stages[1]["id"])

    def test_personal_pipeline_cannot_be_deleted(self):
        pipeline=personal_pipeline(self.owner.employee)
        self.assertEqual(self.client.delete(f"/api/v2/pipelines/{pipeline.pk}/").status_code,400)

    def test_personal_initial_stage_requires_transfer_for_implicit_tasks(self):
        pipeline = personal_pipeline(self.owner.employee)
        stages = pipeline.stages[1:]
        self.assertEqual(self.update(pipeline, stages).status_code, 400)
        response = self.update(pipeline, stages, transfers={pipeline.stages[0]["id"]: stages[0]["id"]})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(str(PersonalPipelineTask.objects.get(pipeline=pipeline, task=self.task).stage_id), stages[0]["id"])

    def test_new_default_invalidates_previous_editor(self):
        response = self.client.post("/api/v2/pipelines/", {"project": str(self.project.pk), "name": "Default", "is_default": True, "stages": default_stages()}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertTrue(response.data["is_default"])
        self.assertEqual(self.update(self.pipeline, self.pipeline.stages).status_code, 400)
        self.pipeline.refresh_from_db()
        self.assertFalse(self.pipeline.is_default)

    def test_deleted_tasks_do_not_block_pipeline_removal(self):
        from django.utils import timezone
        self.task.deleted_at = timezone.now()
        self.task.save(update_fields=["deleted_at"])
        target = Pipeline.objects.create(project=self.project, name="Keep", stages=default_stages())
        response = self.client.delete(f"/api/v2/pipelines/{self.pipeline.pk}/")
        self.assertEqual(response.status_code, 204, response.data)
        self.link.refresh_from_db()
        self.assertEqual(self.link.pipeline_id, target.pk)
        self.assertTrue(Task._base_manager.filter(pk=self.task.pk).exists())

    def test_project_responsible_can_manage_without_broad_department_permission(self):
        JobRolePermission.objects.filter(job_role=self.owner.position.job_role, permission__code="tasks.project.manage").delete()
        response = self.client.post("/api/v2/pipelines/", {"project":str(self.project.pk), "name":"Owner flow"}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertTrue(response.data["can_manage"])

    def test_explicit_denial_still_applies_to_project_responsible(self):
        JobRolePermission.objects.filter(job_role=self.owner.position.job_role, permission__code="tasks.project.manage").update(effect="deny")
        response = self.client.post("/api/v2/pipelines/", {"project":str(self.project.pk), "name":"Denied"}, format="json")
        self.assertEqual(response.status_code, 403, response.data)

    def test_department_reporting_lead_can_manage_accessible_project(self):
        from boldApp.core.models import Position
        JobRolePermission.objects.filter(job_role=self.owner.position.job_role, permission__code="tasks.project.manage").delete()
        self.project.owner_assignment = self.reader
        self.project.save(update_fields=["owner_assignment"])
        Position.objects.create(unit=self.project.unit, job_role=self.reader.position.job_role, reports_to_position=self.owner.position)
        response = self.client.post("/api/v2/pipelines/", {"project":str(self.project.pk), "name":"Department flow"}, format="json")
        self.assertEqual(response.status_code, 201, response.data)

    def test_personal_board_can_organize_project_task_without_reassigning_it(self):
        personal = personal_pipeline(self.owner.employee)
        response = self.move(personal, personal.stages[1])
        self.assertEqual(response.status_code, 200, response.data)
        self.link.refresh_from_db();self.task.refresh_from_db()
        self.assertEqual(self.link.pipeline_id, self.pipeline.pk)
        self.assertEqual(str(self.link.pipeline_stage), self.pipeline.stages[0]["id"])
        self.assertFalse(self.task.status.is_final)
        response = self.client.patch(f"/api/v2/tasks/{self.task.pk}/", {"pipeline":str(personal.pk),"pipeline_stage":personal.stages[1]["id"]}, format="json")
        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(str(PersonalPipelineTask.objects.get(task=self.task).stage_id),personal.stages[1]["id"])
        context = self.client.get(f"/api/v2/task-pipelines/{self.task.pk}/")
        self.assertIsNone(context.data["personal"])
        self.assertTrue(context.data["project_managed"])
        self.assertEqual(context.data["projects"][0]["project"], str(self.project.pk))
        board = self.client.get(f"/api/v2/pipelines/{personal.pk}/board/")
        item = next(row for row in board.data["tasks"] if str(row["id"]) == str(self.task.pk))
        self.assertFalse(item["pipeline_read_only"])
        self.assertEqual(board.data["placements"][str(self.task.pk)], personal.stages[1]["id"])
        self.assertEqual(self.move(personal,self.stage(personal,"completed")).status_code,200)
        self.task.refresh_from_db();self.link.refresh_from_db()
        self.assertFalse(self.task.status.is_final)
        self.assertEqual(str(self.link.pipeline_stage),self.pipeline.stages[0]["id"])
        self.assertEqual(self.move(self.pipeline,self.pipeline.stages[1]).status_code, 200)

    def test_unlinked_personal_task_keeps_its_personal_context(self):
        task = Task.objects.create(unit=self.owner.position.unit, status=self.status, title="No project", priority="medium", created_by_assignment=self.owner, assignee_assignment=self.owner)
        context = self.client.get(f"/api/v2/task-pipelines/{task.pk}/")
        self.assertFalse(context.data["project_managed"])
        self.assertIsNotNone(context.data["personal"])
        pipeline = personal_pipeline(self.owner.employee)
        self.assertEqual(self.move(pipeline,pipeline.stages[1],task).status_code, 200)

    def test_personal_pipeline_without_project_can_be_edited_and_moved(self):
        pipeline = personal_pipeline(self.owner.employee)
        self.assertIsNone(pipeline.project_id)
        response = self.client.put(f"/api/v2/pipelines/{pipeline.pk}/", {"name": "Personal actualizado", "version": pipeline.version, "stages": pipeline.stages}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        response = self.move(pipeline, pipeline.stages[1])
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(str(PersonalPipelineTask.objects.get(pipeline=pipeline, task=self.task).stage_id), pipeline.stages[1]["id"])
