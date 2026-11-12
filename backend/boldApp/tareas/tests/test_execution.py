"""Behavioral acceptance of phases, existing completion paths and privacy."""
from copy import deepcopy
from datetime import timedelta
from uuid import uuid4
from unittest.mock import patch
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from boldApp.core.models import Employee, UserAccount, OrganizationalUnit, JobRole, Position, PositionAssignment, Permission, JobRolePermission
from boldApp.notificaciones.models import Notification
from boldApp.tareas.models import Task, TaskStatus, TaskPhase, TaskExecution, TaskTimelineEvent, TaskTracking, Project, TaskProject
from boldApp.tareas.execution_service import guard_task_completion


class TaskExecutionTests(TestCase):
    def setUp(self):
        self.it=OrganizationalUnit.objects.create(name='Execution IT',unit_type='department',sensitivity_level='low')
        self.design=OrganizationalUnit.objects.create(name='Execution Diseño',unit_type='department',sensitivity_level='low')
        self.owner=self.person('Coordinación',self.it)
        self.worker=self.person('Diseño',self.design)
        self.other=self.person('Otra persona',self.design)
        self.account_owner=self.person('Propietario',self.it,owner=True)
        self.pending=TaskStatus.objects.filter(unit=self.it,is_final=False).first()
        self.final=TaskStatus.objects.filter(unit=self.it,is_final=True).first()
        self.task=Task.objects.create(unit=self.it,status=self.pending,title='Remodelar página',priority='Media',
            created_by_assignment=self.owner,assignee_assignment=self.owner)
        self.url=f'/api/v2/task-execution/{self.task.pk}/'
        self.client=self.as_person(self.owner)
        self.phases=[self.phase('Revisión',self.owner),self.phase('Diseño',self.worker),self.phase('Publicación',self.owner)]
        self.phases[1]['prerequisites']=[self.phases[0]['id']]
        self.phases[2]['prerequisites']=[self.phases[1]['id']]

    def person(self,name,unit,owner=False):
        role=JobRole.objects.create(title=name)
        employee=Employee.objects.create(full_name=name)
        UserAccount.objects.create_user(employee=employee,email=str(uuid4())+'@bold.gt',is_superuser=owner)
        assignment=PositionAssignment.objects.create(employee=employee,position=Position.objects.create(unit=unit,job_role=role))
        for code in ['tasks.task.read','tasks.task.update','tasks.task.create','tasks.task.delete','tasks.project.manage','tasks.project.read']:
            JobRolePermission.objects.create(job_role=role,permission=Permission.objects.get(code=code),effect='allow',scope_type='own_unit')
        return assignment

    def as_person(self,assignment):
        client=APIClient();client.force_authenticate(assignment.employee.user_account)
        client.credentials(HTTP_X_ASSIGNMENT_ID=str(assignment.pk));return client

    def phase(self,name,lead,**extra):
        return {'id':str(uuid4()),'name':name,'unit':str(lead.position.unit_id),'lead':str(lead.pk),'responsible':[str(lead.pk)],**extra}

    def define(self,phases=None,version=0,**extra):
        return self.client.put(self.url,{'version':version,'operation_id':str(uuid4()),'phases':phases if phases is not None else self.phases,**extra},format='json')

    def act(self,phase,action,*,client=None,reason='',**extra):
        version=TaskExecution.objects.get(task=self.task).version
        return (client or self.client).post(self.url,{'version':version,'operation_id':str(uuid4()),'phase_id':phase['id'],'action':action,'reason':reason,**extra},format='json')

    def finish(self,phase,client=None):
        self.assertEqual(self.act(phase,'start',client=client).status_code,200)
        response=self.act(phase,'complete',client=client);self.assertEqual(response.status_code,200,response.data)
        return response

    def test_sequential_handoff_and_cross_department_read_are_scoped(self):
        self.assertEqual(self.as_person(self.worker).get(self.url).status_code,404)
        with self.captureOnCommitCallbacks(execute=True):
            result=self.define()
        self.assertEqual(result.status_code,200,result.data)
        self.assertEqual([p['status'] for p in result.data['phases']],['available','pending','pending'])
        worker=self.as_person(self.worker)
        self.assertEqual(worker.get(self.url).status_code,200)
        self.assertEqual(self.as_person(self.other).get(self.url).status_code,404)
        self.assertEqual(self.act(self.phases[1],'start',client=worker).status_code,400)
        with self.captureOnCommitCallbacks(execute=True):
            self.finish(self.phases[0])
        self.assertTrue(Notification.objects.filter(recipient_assignment=self.worker,type='tasks.phase.available').exists())
        self.assertEqual(self.act(self.phases[2],'start',client=worker).status_code,403)
        self.assertEqual(worker.delete(f'/api/v2/tasks/{self.task.pk}/').status_code,403)
        task_dto=worker.get(f'/api/v2/tasks/{self.task.pk}/')
        self.assertEqual(task_dto.status_code,200)
        self.assertTrue(task_dto.data['phase_participant'])
        self.assertEqual(worker.patch(f'/api/v2/tasks/{self.task.pk}/',{'title':'No me corresponde'},format='json').status_code,403)
        self.finish(self.phases[1],worker)
        result=self.finish(self.phases[2])
        self.assertTrue(result.data['can_finish'])

    def test_completion_cannot_bypass_phases_through_legacy_api_or_pipeline(self):
        self.assertEqual(self.define().status_code,200)
        response=self.client.patch(f'/api/v2/tasks/{self.task.pk}/',{'status':str(self.final.pk)},format='json')
        self.assertEqual(response.status_code,400,response.data)
        self.task.refresh_from_db();self.assertFalse(self.task.status.is_final)
        project=Project.objects.create(name='Execution project',unit=self.it,owner_assignment=self.owner,created_by_assignment=self.owner,status='active')
        link=TaskProject.objects.create(task=self.task,project=project,position=0,added_by_assignment=self.owner)
        final=next(s for s in link.pipeline.stages if s['kind']=='completed')
        response=self.client.put(f'/api/v2/pipelines/{link.pipeline_id}/tasks/{self.task.pk}/',{'stage':final['id']},format='json')
        self.assertEqual(response.status_code,400,response.data)
        link.refresh_from_db();self.assertNotEqual(str(link.pipeline_stage),final['id'])

    def test_plain_tasks_still_complete_and_cannot_forge_completion_timestamp(self):
        before=timezone.now()
        result=self.client.patch(f'/api/v2/tasks/{self.task.pk}/',{'status':str(self.final.pk),'completed_at':'2000-01-01T00:00:00Z'},format='json')
        self.assertEqual(result.status_code,200,result.data)
        self.task.refresh_from_db();self.assertGreaterEqual(self.task.completed_at,before)
        self.assertEqual(self.task.timeline_events.filter(kind='task.completed').count(),1)
        timestamp=self.task.completed_at;self.task.save();self.task.refresh_from_db()
        self.assertEqual(self.task.completed_at,timestamp)
        self.assertTrue(TaskTracking.objects.get(task=self.task).complete_history)

    def test_editing_legacy_completed_task_does_not_invent_a_missing_completion_time(self):
        self.task.status=self.final;self.task.save()
        Task.objects.filter(pk=self.task.pk).update(completed_at=None)
        self.task.refresh_from_db();self.task.title='Título corregido';self.task.save()
        self.task.refresh_from_db();self.assertIsNone(self.task.completed_at)

    def test_status_catalog_cannot_finalize_tasks_by_reinterpreting_a_used_state(self):
        self.define()
        self.pending.is_final=True
        from rest_framework.exceptions import ValidationError
        with self.assertRaises(ValidationError):self.pending.save()
        self.pending.refresh_from_db();self.assertFalse(self.pending.is_final)

    def test_cycles_and_unknown_dependency_rollback_the_entire_command(self):
        phases=deepcopy(self.phases);phases[0]['prerequisites']=[phases[-1]['id']]
        self.assertEqual(self.define(phases).status_code,400)
        self.assertFalse(TaskExecution.objects.filter(task=self.task).exists())
        phases[0]['prerequisites']=[str(uuid4())]
        self.assertEqual(self.define(phases).status_code,400)
        self.assertFalse(TaskPhase.objects.exists())

    def test_running_process_cannot_drop_pending_required_work_to_bypass_completion(self):
        self.assertEqual(self.define().status_code,200)
        self.finish(self.phases[0])
        version=TaskExecution.objects.get(task=self.task).version
        result=self.define([self.phases[0]],version=version)
        self.assertEqual(result.status_code,400,result.data)
        self.assertEqual(TaskPhase.objects.filter(execution_id=self.task.pk,archived_at__isnull=True).count(),3)
        self.assertEqual(self.client.patch(f'/api/v2/tasks/{self.task.pk}/',{'status':str(self.final.pk)},format='json').status_code,400)
        owner=self.as_person(self.account_owner)
        for phase in self.phases[1:]:self.assertEqual(self.act(phase,'skip',client=owner,reason='Cambio de alcance autorizado').status_code,200)
        self.assertTrue(self.client.get(self.url).data['can_finish'])

    def test_new_responsible_receives_ready_notice_without_notifying_existing_people_again(self):
        phase=self.phase('Trabajo preparado',self.owner)
        with self.captureOnCommitCallbacks(execute=True):self.assertEqual(self.define([phase]).status_code,200)
        before=Notification.objects.filter(recipient_assignment=self.owner,type='tasks.phase.available').count()
        phase['responsible'].append(str(self.worker.pk))
        with self.captureOnCommitCallbacks(execute=True):self.assertEqual(self.define([phase],version=1).status_code,200)
        self.assertEqual(Notification.objects.filter(recipient_assignment=self.worker,type='tasks.phase.available').count(),1)
        self.assertEqual(Notification.objects.filter(recipient_assignment=self.owner,type='tasks.phase.available').count(),before)

    def test_removing_a_phase_participant_invalidates_the_former_department_and_read_access(self):
        phase=self.phase('Paso de Diseño',self.worker)
        self.assertEqual(self.define([phase]).status_code,200)
        self.assertEqual(self.as_person(self.worker).get(self.url).status_code,200)
        replacement={**phase,'unit':str(self.it.pk),'lead':str(self.owner.pk),'responsible':[str(self.owner.pk)]}
        with patch('boldApp.tareas.webhook_events.dispatch_resource_invalidation') as invalidate:
            with self.captureOnCommitCallbacks(execute=True):self.assertEqual(self.define([replacement],version=1).status_code,200)
        event=[call for call in invalidate.call_args_list if call.args[1]=='task.execution.changed'][-1]
        self.assertIn(self.design.pk,event.args[0])
        self.assertEqual(self.as_person(self.worker).get(self.url).status_code,404)

    def test_reopened_phase_does_not_prevent_personal_section_or_order_edits(self):
        phase=self.phases[0];self.assertEqual(self.define([phase]).status_code,200);self.finish(phase)
        project=Project.objects.create(name='Entrega con etapas',unit=self.it,status='active',owner_assignment=self.owner,created_by_assignment=self.owner)
        link=TaskProject.objects.create(task=self.task,project=project,position=0,added_by_assignment=self.owner)
        link.pipeline_stage=next(row['id'] for row in link.pipeline.stages if row['kind']=='completed')
        link.save(update_fields=['pipeline_stage']);self.task.refresh_from_db();self.assertTrue(self.task.status.is_final)
        self.assertEqual(self.act(phase,'reopen',reason='Revisar dependencia').status_code,200)
        updated=self.client.patch(f'/api/v2/task-projects/{link.pk}/',{'position':'2'},format='json')
        self.assertEqual(updated.status_code,200,updated.data)
        self.task.refresh_from_db();self.assertFalse(self.task.status.is_final)
        self.assertIsNone(self.task.completed_at)

    def test_parallel_join_waits_for_all_prerequisites_and_only_one_task_is_counted(self):
        phases=[self.phase('Código',self.owner),self.phase('Arte',self.worker),self.phase('Publicar',self.owner)]
        phases[2]['prerequisites']=[p['id'] for p in phases[:2]]
        self.assertEqual(self.define(phases).status_code,200)
        self.finish(phases[0]);self.assertEqual(self.act(phases[2],'start').status_code,400)
        self.finish(phases[1],self.as_person(self.worker));self.assertEqual(self.act(phases[2],'start').status_code,200)
        self.assertEqual(Task.objects.count(),1)

    def test_reopen_preserves_completed_successors_but_requires_review(self):
        self.define()
        for phase in self.phases:self.finish(phase)
        self.client.patch(f'/api/v2/tasks/{self.task.pk}/',{'status':str(self.final.pk)},format='json')
        reopened=self.act(self.phases[0],'reopen',reason='Ajuste de requisitos')
        self.assertEqual(reopened.status_code,200,reopened.data)
        self.task.refresh_from_db();self.assertFalse(self.task.status.is_final)
        phases=reopened.data['phases']
        self.assertEqual(phases[1]['status'],'completed');self.assertTrue(phases[1]['review_required'])
        self.assertTrue(phases[2]['review_required'])
        self.finish(self.phases[0])
        self.assertEqual(self.act(self.phases[2],'review',reason='Comprobado').status_code,400)
        self.assertEqual(self.act(self.phases[1],'review',reason='Diseños vigentes').status_code,200)
        final=self.act(self.phases[2],'review',reason='Publicación comprobada')
        self.assertTrue(final.data['can_finish'])

    def test_explicit_denials_win_over_responsibility_and_owner_override_needs_reason(self):
        self.define();self.finish(self.phases[0])
        JobRolePermission.objects.create(job_role=self.worker.position.job_role,permission=Permission.objects.get(code='tasks.execution.advance'),effect='deny',scope_type='global')
        self.assertEqual(self.act(self.phases[1],'start',client=self.as_person(self.worker)).status_code,403)
        self.assertEqual(self.act(self.phases[1],'skip',reason='Atajo').status_code,403)
        owner=self.as_person(self.account_owner)
        self.assertEqual(self.act(self.phases[1],'skip',client=owner).status_code,403)
        self.assertEqual(self.act(self.phases[1],'skip',client=owner,reason='Cambio de alcance aprobado').status_code,200)
        self.assertEqual(TaskTimelineEvent.objects.get(kind='phase.exception').reason,'Cambio de alcance aprobado')

    def test_block_resume_tracks_intervals_without_resetting_first_start(self):
        self.define();self.act(self.phases[0],'start')
        phase=TaskPhase.objects.get(pk=self.phases[0]['id']);started=phase.started_at
        self.assertEqual(self.act(self.phases[0],'block').status_code,400)
        self.assertEqual(self.act(self.phases[0],'block',reason='Esperando credenciales').status_code,200)
        self.assertEqual(self.act(self.phases[0],'resume').status_code,200)
        phase.refresh_from_db();self.assertEqual(phase.started_at,started)
        self.assertEqual(phase.events.filter(after__status='blocked').count(),1)

    def test_retries_are_idempotent_and_stale_updates_do_not_replace_colleague_work(self):
        self.define();payload={'version':1,'operation_id':str(uuid4()),'phase_id':self.phases[0]['id'],'action':'start'}
        self.assertEqual(self.client.post(self.url,payload,format='json').status_code,200)
        before=TaskTimelineEvent.objects.count()
        self.assertEqual(self.client.post(self.url,payload,format='json').status_code,200)
        self.assertEqual(TaskTimelineEvent.objects.count(),before)
        payload['action']='block';self.assertEqual(self.client.post(self.url,payload,format='json').status_code,409)
        self.assertEqual(self.define(version=1).status_code,409)

    def test_snapshots_keep_department_and_responsible_at_time_of_work(self):
        self.define();self.finish(self.phases[0])
        old=TaskTimelineEvent.objects.filter(kind='phase.transition',phase_id=self.phases[0]['id'],after__status='completed').get()
        self.it.name='Nombre nuevo';self.it.save()
        old.refresh_from_db();self.assertEqual(old.responsibility_snapshot[0]['unit_name'],'Execution IT')
        self.assertEqual(old.responsibility_snapshot[0]['assignment_id'],str(self.owner.pk))
        self.assertEqual(self.client.get(self.url+'timeline/').status_code,200)

    def test_templates_share_definition_without_task_history_or_access(self):
        url='/api/v2/task-execution/templates/'
        result=self.client.post(url,{'name':'Publicar sitio','definition':self.phases,'shared_with':[str(self.worker.pk)]},format='json')
        self.assertEqual(result.status_code,200,result.data)
        worker=self.as_person(self.worker)
        self.assertEqual(len(worker.get(url).data['results']),1)
        self.assertEqual(worker.get(self.url).status_code,404)
        self.assertEqual(len(self.as_person(self.other).get(url).data['results']),0)
        self.assertEqual(worker.post(url,{'id':result.data['id'],'version':result.data['version'],'archive':True},format='json').status_code,404)
