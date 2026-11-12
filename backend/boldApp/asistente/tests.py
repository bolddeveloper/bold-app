from datetime import timedelta
from uuid import uuid4
from unittest.mock import patch
from django.test import TestCase,override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from boldApp.autenticacion.models import AuthSession
from boldApp.core.models import JobRolePermission,Permission
from boldApp.tareas.models import Task,TaskTimelineEvent
from boldApp.tareas.tests import test_execution as base
from .models import AssistantRequest,ActionReceipt,InferenceAttempt
from . import service,gate


class AssistantTests(TestCase):
    person=base.TaskExecutionTests.person
    phase=base.TaskExecutionTests.phase
    as_person=base.TaskExecutionTests.as_person
    def setUp(self):
        base.TaskExecutionTests.setUp(self)
        self.settings_override=override_settings(BOLD_ASSISTANT_ENABLED=True,BOLD_ASSISTANT_PILOT_UNIT_IDS=(str(self.it.pk),),AUTH_MFA_REQUIRED=False)
        self.settings_override.enable();self.addCleanup(self.settings_override.disable)
        self.client,self.session=self.client_for(self.owner)
        self.queries=[{'capability':'statuses.list','arguments':{'unit':str(self.it.pk)}}]
        self.modules=['tasks']

    def client_for(self,assignment):
        user=assignment.employee.user_account
        session=AuthSession.objects.create(user_account=user,token_hash=uuid4().hex,credentials_version=user.credentials_version,expires_at=timezone.now()+timedelta(hours=1))
        client=APIClient();client.force_authenticate(user,token=session)
        client.credentials(HTTP_X_ASSIGNMENT_ID=str(assignment.pk))
        return client,session

    def create(self,text='Crea dos tareas'):
        response=self.client.post('/api/v2/assistant/requests/',{'text':text,'client_id':str(uuid4())},format='json')
        self.assertEqual(response.status_code,202,response.data)
        return response.data['id']

    def output(self,steps=None,answer=''):
        return {'summary':'Prepararé las tareas solicitadas.','modules':self.modules,'queries':self.queries,'steps':steps or [],'answer':answer,'clarification':''}

    def get(self,pk):return self.client.get(f'/api/v2/assistant/requests/{pk}/').data

    def action(self,pk,action,**data):
        response=self.client.post(f'/api/v2/assistant/requests/{pk}/{action}/',{'version':self.get(pk)['version'],**data},format='json')
        return response

    def reveal(self,*args,**kwargs):
        import sys
        raise AssertionError("Preparation failed") from sys.exception()

    def prepared(self,steps):
        pk=self.create()
        with patch('boldApp.asistente.planner.generate',return_value=(self.output(),{})):
            self.assertTrue(service.infer(pk))
        self.assertEqual(self.action(pk,'prepare').status_code,202)
        with patch('boldApp.asistente.planner.generate',return_value=(self.output(steps),{'input_tokens':12,'output_tokens':8})), patch('boldApp.asistente.service.fail',side_effect=self.reveal):
            self.assertTrue(service.infer(pk))
        return pk

    def step(self,key='one',title='Asistente: nueva tarea'):
        return {'id':key,'capability':'tasks.create','target':'','arguments':{'title':title,'unit':str(self.it.pk),'status':str(self.pending.pk),'priority':'Media'},'depends_on':[]}

    def approve(self,pk,key=None):
        data=self.get(pk)
        return self.action(pk,'execute',digest=data['proposal']['digest'],execution_id=str(key or uuid4()))

    def test_two_approvals_and_multiple_tasks_run_once(self):
        before=Task.objects.count();pk=self.prepared([self.step(),self.step('two','Asistente: otra tarea')])
        self.assertEqual(Task.objects.count(),before)
        key=uuid4();self.assertEqual(self.approve(pk,key).status_code,202)
        self.assertTrue(service.perform(pk));self.assertFalse(service.perform(pk))
        self.assertEqual(Task.objects.count(),before+2)
        self.assertEqual(self.approve(pk,key).status_code,202)
        self.assertEqual(self.get(pk)['state'],'completed')
        self.assertEqual(len(self.get(pk)['receipts']),2)

    def test_private_requests_and_pilot_are_not_owner_bypassable(self):
        pk=self.create()
        other,_=self.client_for(self.account_owner)
        self.assertEqual(other.get(f'/api/v2/assistant/requests/{pk}/').status_code,404)
        outside,_=self.client_for(self.worker)
        self.assertEqual(outside.get('/api/v2/assistant/requests/').status_code,401)

    def test_no_business_read_before_scope_approval(self):
        pk=self.create()
        with patch('boldApp.asistente.service.read',side_effect=AssertionError('premature read')) as read:
            with patch('boldApp.asistente.planner.generate',return_value=(self.output(),{})):
                self.assertTrue(service.infer(pk))
            read.assert_not_called()
        self.assertEqual(self.get(pk)['state'],'awaiting_scope')

    def test_revoked_session_cannot_execute_queued_actions(self):
        pk=self.prepared([self.step()]);self.approve(pk)
        self.session.revoked_at=timezone.now();self.session.save()
        self.assertFalse(service.perform(pk))
        self.assertFalse(Task.objects.filter(title='Asistente: nueva tarea').exists())

    def test_explicit_execution_deny_wins(self):
        pk=self.prepared([self.step()])
        JobRolePermission.objects.create(job_role=self.owner.position.job_role,permission=Permission.objects.get(code='assistant.request.execute'),effect='deny',scope_type='own_unit')
        self.assertEqual(self.approve(pk).status_code,403)

    def test_edits_invalidate_older_proposals_and_keep_other_steps(self):
        pk=self.prepared([self.step(),self.step('two','Conservar')]);old=self.get(pk)
        steps=old['proposal']['steps'];steps[0]['arguments']['title']='Revisada'
        response=self.client.patch(f'/api/v2/assistant/requests/{pk}/',{'version':old['version'],'steps':steps},format='json')
        self.assertEqual(response.status_code,202,response.data)
        self.assertEqual(response.data['proposal']['steps'][1]['arguments']['title'],'Conservar')
        response=self.client.post(f'/api/v2/assistant/requests/{pk}/execute/',{'version':old['version'],'digest':old['proposal']['digest'],'execution_id':str(uuid4())},format='json')
        self.assertEqual(response.status_code,409)

    def test_local_batch_rolls_back_if_one_action_is_denied(self):
        bad=self.step('two');bad['arguments']['unit']=str(self.design.pk);bad['arguments']['status']=str(self.task.status_id)
        pk=self.prepared([self.step(),bad]);self.approve(pk)
        before=Task.objects.count();self.assertFalse(service.perform(pk))
        self.assertEqual(Task.objects.count(),before)

    def test_simulation_has_no_tasks_history_or_google_writes(self):
        pk=self.prepared([self.step()]);before=(Task.objects.count(),TaskTimelineEvent.objects.count())
        with patch('boldApp.asistente.capabilities.write',side_effect=AssertionError('write in simulation')):
            response=self.action(pk,'simulate')
        self.assertEqual(response.status_code,200,response.data)
        self.assertTrue(response.data['simulated'])
        self.assertEqual(response.data['after']['tasks'],1)
        self.assertEqual((Task.objects.count(),TaskTimelineEvent.objects.count()),before)

    def test_actions_and_proposal_scope_are_allowlisted(self):
        from .capabilities import validate_steps
        for cap in ('tasks.delete','google.delete','permissions.grant','shell','mcp.write'):
            step=self.step();step['capability']=cap
            with self.assertRaises(Exception):validate_steps([step],['tasks','calendars'])

    def test_active_request_creation_is_idempotent_and_bounded(self):
        key=str(uuid4());body={'text':'Una solicitud','client_id':key}
        a=self.client.post('/api/v2/assistant/requests/',body,format='json');b=self.client.post('/api/v2/assistant/requests/',body,format='json')
        self.assertEqual(a.data['id'],b.data['id'])
        response=self.client.post('/api/v2/assistant/requests/',{**body,'client_id':str(uuid4())},format='json')
        self.assertEqual(response.status_code,400)

    def test_gate_allows_only_one_inference_and_unknown_tokens_stay_unknown(self):
        owner=gate.acquire();self.assertIsNone(gate.acquire());gate.release(owner)
        pk=self.create()
        with patch('boldApp.asistente.planner.generate',return_value=(self.output(),{})):
            self.assertTrue(service.infer(pk))
        self.assertIsNone(InferenceAttempt.objects.get(request_id=pk).input_tokens)
        response=self.client.get('/api/v2/assistant/activity/')
        self.assertEqual(response.status_code,200)
        self.assertIsNone(response.data['usage']['input_tokens'])

    def test_approvals_are_never_exported_to_mcp(self):
        from boldApp.mcp.catalog import operations
        self.assertFalse(any(op.path.startswith('/api/v2/assistant/') for op in operations().values()))

    def test_required_phases_still_block_task_completion_by_the_assistant(self):
        body={'version':0,'operation_id':str(uuid4()),'phases':[self.phase('Trabajo obligatorio',self.owner)]}
        self.assertEqual(self.client.put(self.url,body,format='json').status_code,200)
        self.queries=[{'capability':'tasks.get','arguments':{'id':str(self.task.pk)}}]
        step={'id':'finish','capability':'tasks.update','target':str(self.task.pk),'arguments':{'status':str(self.final.pk)},'depends_on':[]}
        pk=self.prepared([step]);self.approve(pk)
        self.assertFalse(service.perform(pk));self.task.refresh_from_db()
        self.assertFalse(self.task.status.is_final)

    def test_changed_sources_need_new_review_and_do_not_overwrite_a_colleague(self):
        self.queries=[{'capability':'tasks.get','arguments':{'id':str(self.task.pk)}}]
        step={'id':'edit','capability':'tasks.update','target':str(self.task.pk),'arguments':{'title':'No sustituir'},'depends_on':[]}
        pk=self.prepared([step]);old=self.get(pk);self.task.title='Cambio del colega';self.task.save()
        response=self.client.post(f'/api/v2/assistant/requests/{pk}/execute/',{'version':old['version'],'digest':old['proposal']['digest'],'execution_id':str(uuid4())},format='json')
        self.assertEqual(response.status_code,400)
        self.task.refresh_from_db();self.assertEqual(self.task.title,'Cambio del colega')

    def test_revoking_source_read_hides_answers_previews_and_receipts(self):
        self.queries=[{'capability':'tasks.get','arguments':{'id':str(self.task.pk)}}]
        step={'id':'edit','capability':'tasks.update','target':str(self.task.pk),'arguments':{'title':'Dato privado'},'depends_on':[]}
        pk=self.prepared([step])
        JobRolePermission.objects.filter(job_role=self.owner.position.job_role,permission__code='tasks.task.read',scope_type='own_unit').update(effect='deny')
        data=self.get(pk)
        self.assertFalse(data['sources_available']);self.assertIsNone(data['proposal']);self.assertEqual(data['receipts'],[])
        self.assertNotIn('Dato privado',str(data))

    def test_google_timeout_keeps_local_results_and_reconciliation_never_resends(self):
        self.modules=['tasks','calendars']
        google={'id':'meeting','capability':'google.create','target':'','arguments':{'summary':'Reunión de prueba','start':{'dateTime':'2026-11-20T10:00:00-06:00'},'end':{'dateTime':'2026-11-20T11:00:00-06:00'}},'depends_on':['one']}
        pk=self.prepared([self.step(),google]);self.approve(pk)
        with patch('boldApp.asistente.google.google_request',side_effect=OSError('connection ended')) as provider:
            self.assertFalse(service.perform(pk));self.assertFalse(service.perform(pk));self.assertEqual(provider.call_count,1)
        self.assertEqual(self.get(pk)['state'],'uncertain')
        self.assertEqual(Task.objects.filter(title='Asistente: nueva tarea').count(),1)
        job=service.load(pk)
        from .google import event_id
        result={'id':event_id(job,google),'extendedProperties':{'private':{'boldAssistantOperation':str(job.execution_id)}}}
        with patch('boldApp.asistente.reconcile.google_request',return_value=result) as provider:
            response=self.action(pk,'reconcile')
            self.assertEqual(response.status_code,200,response.data)
            self.assertEqual(provider.call_args.args[1],'GET')
        self.assertEqual(self.get(pk)['state'],'completed')

    def test_daily_limit_counts_attempts_and_does_not_call_the_model_again(self):
        old=self.create();AssistantRequest.objects.filter(pk=old).update(state='failed')
        InferenceAttempt.objects.create(request_id=old,kind='intent',model='test',state='failed')
        pk=self.create()
        with override_settings(BOLD_SUPPORT_DAILY_LIMIT=1):
            with patch('boldApp.asistente.planner.generate') as model:
                self.assertFalse(service.infer(pk));model.assert_not_called()
        self.assertEqual(self.get(pk)['state'],'failed')

    def test_post_execution_refinement_cannot_erase_the_receipt_and_rerun_actions(self):
        pk=self.prepared([self.step()]);self.approve(pk);self.assertTrue(service.perform(pk))
        response=self.client.patch(f'/api/v2/assistant/requests/{pk}/',{'version':1,'text':'Repetir'},format='json')
        self.assertEqual(response.status_code,400)
        self.assertEqual(self.get(pk)['state'],'completed')

    def test_team_activity_requires_a_supervisory_permission(self):
        response=self.client.get('/api/v2/assistant/activity/?scope=team')
        self.assertEqual(response.status_code,403)

    def test_cookie_approval_enforces_csrf(self):
        from django.conf import settings
        from boldApp.autenticacion.services import token_hash
        raw='synthetic-assistant-session-for-csrf-test'
        self.session.token_hash=token_hash(raw);self.session.save()
        client=APIClient(enforce_csrf_checks=True);client.cookies[settings.AUTH_SESSION_COOKIE_NAME]=raw
        client.credentials(HTTP_X_ASSIGNMENT_ID=str(self.owner.pk))
        response=client.post('/api/v2/assistant/requests/',{'text':'Una tarea','client_id':str(uuid4())},format='json')
        self.assertEqual(response.status_code,403)

    def test_project_task_and_stage_dependencies_use_native_defaults_and_versions(self):
        self.modules=['tasks','projects','execution']
        task=self.step('task','Cadena completa');task['arguments']['project']='$project'
        phase={'id':'review','name':'Revisión','unit':str(self.it.pk),'lead':str(self.owner.pk),'responsible':[str(self.owner.pk)],'required':True,'prerequisites':[]}
        steps=[{'id':'project','capability':'projects.create','target':'','arguments':{'name':'Proyecto del asistente'},'depends_on':[]},task,
            {'id':'define','capability':'execution.define','target':'$task','arguments':{'phases':[phase]},'depends_on':['task']},
            {'id':'start','capability':'execution.advance','target':'$task','arguments':{'phase_id':'review','action':'start'},'depends_on':['define']},
            {'id':'complete','capability':'execution.advance','target':'$task','arguments':{'phase_id':'review','action':'complete'},'depends_on':['start']},
            {'id':'finish','capability':'tasks.update','target':'$task','arguments':{'status':str(self.final.pk)},'depends_on':['complete']}]
        pk=self.prepared(steps);self.assertEqual(self.approve(pk).status_code,202)
        def reveal(*args,**kwargs):
            import sys
            raise AssertionError('Native workflow failed') from sys.exception()
        with patch('boldApp.asistente.service.fail',side_effect=reveal):self.assertTrue(service.perform(pk))
        task=Task.objects.get(title='Cadena completa')
        self.assertTrue(task.status.is_final)
        self.assertEqual(task.execution.version,3)

    def test_integer_task_project_links_move_without_bypassing_task_or_project_access(self):
        from boldApp.tareas.models import Project,TaskProject,Section
        project=Project.objects.create(unit=self.it,owner_assignment=self.owner,created_by_assignment=self.owner,name='Proyecto existente',status='Activo')
        section=Section.objects.create(project=project,name='Destino',position=1)
        link=TaskProject.objects.create(task=self.task,project=project,position=0,added_by_assignment=self.owner)
        self.queries=[{'capability':'tasks.links','arguments':{'task':str(self.task.pk)}}]
        step={'id':'move','capability':'tasks.organize','target':str(link.pk),'arguments':{'section':str(section.pk)},'depends_on':[]}
        pk=self.prepared([step]);self.approve(pk);self.assertTrue(service.perform(pk))
        link.refresh_from_db();self.assertEqual(link.section_id,section.pk)

    def test_local_target_changed_while_waiting_for_google_is_not_overwritten(self):
        self.modules=['tasks','calendars']
        self.queries.append({'capability':'tasks.get','arguments':{'id':str(self.task.pk)}})
        google={'id':'meeting','capability':'google.create','target':'','arguments':{'summary':'Reunión','start':{'dateTime':'2026-11-20T10:00:00-06:00'},'end':{'dateTime':'2026-11-20T11:00:00-06:00'}},'depends_on':['one']}
        edit={'id':'edit','capability':'tasks.update','target':str(self.task.pk),'arguments':{'title':'No sobrescribir'},'depends_on':['meeting']}
        pk=self.prepared([self.step(),google,edit]);self.approve(pk)
        def external(*args,**kwargs):
            self.task.title='Cambio durante Google';self.task.save()
            return {'id':kwargs['body']['id'],'summary':'Reunión','etag':'new','start':kwargs['body']['start'],'end':kwargs['body']['end']}
        with patch('boldApp.asistente.google.google_request',side_effect=external):self.assertFalse(service.perform(pk))
        self.task.refresh_from_db();self.assertEqual(self.task.title,'Cambio durante Google')
        self.assertEqual(self.get(pk)['state'],'partial')

    def test_receipts_reopen_actual_records_and_recheck_current_permissions(self):
        pk=self.prepared([self.step()]);self.approve(pk);self.assertTrue(service.perform(pk))
        url=f'/api/v2/assistant/requests/{pk}/records/one/'
        response=self.client.get(url)
        self.assertEqual(response.status_code,200,response.data)
        self.assertEqual(response.data['record']['title'],'Asistente: nueva tarea')
        other,_=self.client_for(self.account_owner)
        self.assertEqual(other.get(url).status_code,404)
        JobRolePermission.objects.filter(job_role=self.owner.position.job_role,permission__code='tasks.task.read',scope_type='own_unit').update(effect='deny')
        self.assertIn(self.client.get(url).status_code,(403,404))

    def test_local_calendar_creation_uses_existing_membership_and_receipt(self):
        from boldApp.calendario.models import AppCalendar,AppCalendarEvent,CalendarDraft
        self.modules=['calendars'];calendar=AppCalendar.objects.create(name='Agenda de prueba',owner=self.session.user_account)
        self.queries=[{'capability':'calendars.list','arguments':{}}]
        event={'id':'meeting','capability':'events.create','target':str(calendar.pk),'arguments':{'summary':'Revisión interna','start':{'dateTime':'2026-11-20T10:00:00-06:00'},'end':{'dateTime':'2026-11-20T11:00:00-06:00'}},'depends_on':[]}
        pk=self.prepared([event]);self.assertEqual(self.get(pk)['state'],'awaiting_approval')
        self.assertEqual(self.action(pk,'simulate').status_code,200)
        self.assertEqual(AppCalendarEvent.objects.count(),0);self.assertEqual(CalendarDraft.objects.count(),0)
        self.assertEqual(self.approve(pk).status_code,202);self.assertTrue(service.perform(pk))
        response=self.client.get(f'/api/v2/assistant/requests/{pk}/records/meeting/')
        self.assertEqual(response.status_code,200,response.data)
        self.assertEqual(response.data['record']['summary'],'Revisión interna')

    def test_report_query_and_saved_definition_have_private_revalidated_evidence(self):
        from boldApp.tareas.models import SavedReport
        self.modules=['reports'];today=timezone.now().date().isoformat()
        definition={'metric':'tasks.total','from':today,'to':today,'timezone':'UTC','scope':'accessible'}
        self.queries=[{'capability':'reports.query','arguments':definition}]
        step={'id':'report','capability':'reports.save','target':'','arguments':{'name':'Tareas consultadas','definition':definition,'shared_with':[str(self.worker.pk)]},'depends_on':[]}
        pk=self.prepared([step]);data=self.get(pk)
        self.assertEqual(data['state'],'awaiting_approval',data)
        self.assertEqual(data['proposal']['reports'][0]['data']['summary']['value'],1)
        url=f'/api/v2/assistant/requests/{pk}/evidence/0/'
        self.assertEqual(self.client.get(url).status_code,200)
        other,_=self.client_for(self.account_owner);self.assertEqual(other.get(url).status_code,404)
        self.assertEqual(SavedReport.objects.count(),0);self.approve(pk);self.assertTrue(service.perform(pk))
        row=SavedReport.objects.get(name='Tareas consultadas');self.assertTrue(row.shared_with.filter(pk=self.worker.pk).exists())
        self.assertEqual(self.client.get(f'/api/v2/assistant/requests/{pk}/records/report/').status_code,200)
        JobRolePermission.objects.create(job_role=self.owner.position.job_role,permission=Permission.objects.get(code='reports.analytics.run'),effect='deny',scope_type='own_unit')
        self.assertEqual(self.client.get(url).status_code,403)
        self.assertIsNone(self.get(pk)['proposal'])

    def test_read_dependencies_ask_instead_of_selecting_an_ambiguous_name(self):
        self.modules=['tasks','reports']
        self.queries=[{'capability':'people.search','arguments':{'q':''}},
            {'capability':'reports.query','arguments':{'metric':'tasks.total','filters':{'assignments':[{'$source':0,'field':'id'}]}}}]
        pk=self.create()
        with patch('boldApp.asistente.planner.generate',return_value=(self.output(),{})):self.assertTrue(service.infer(pk))
        self.action(pk,'prepare')
        with patch('boldApp.asistente.planner.generate') as model:
            self.assertFalse(service.infer(pk));model.assert_not_called()
        data=self.get(pk);self.assertEqual(data['state'],'awaiting_scope');self.assertIn('coincidencia única',data['clarification'])
        self.assertEqual(InferenceAttempt.objects.filter(request_id=pk).count(),1)

    def test_empty_read_set_does_not_expand_a_report_to_everyone(self):
        from .references import resolve,AmbiguousReference
        with self.assertRaises(AmbiguousReference):resolve({'$source':0,'field':'ids'},[{'data':{'results':[]}}],[])
        with self.assertRaises(AmbiguousReference):resolve({'$source':0},[{'data':{'partial':True,'results':[{'id':'one'}]}}],[])
        self.assertEqual(resolve({'$source':0},[{'data':{'results':[{'id':'one'}]}}],[]),'one')

    def test_model_cannot_add_an_unapproved_target_read(self):
        self.queries=[{'capability':'statuses.list','arguments':{}}]
        step={'id':'edit','capability':'tasks.update','target':str(self.task.pk),'arguments':{'title':'Fuera del alcance'},'depends_on':[]}
        pk=self.create()
        with patch('boldApp.asistente.planner.generate',return_value=(self.output(),{})):service.infer(pk)
        self.action(pk,'prepare')
        original=service.read
        def scoped(job,query):
            self.assertNotEqual(query['capability'],'tasks.get','Unapproved target was read')
            return original(job,query)
        with patch('boldApp.asistente.planner.generate',return_value=(self.output([step]),{})),patch('boldApp.asistente.service.read',side_effect=scoped):
            self.assertFalse(service.infer(pk))
        self.assertEqual(self.get(pk)['state'],'failed')

    def test_google_reads_and_simulation_never_store_presence_or_create_drafts(self):
        from boldApp.calendario.models import CalendarDraft
        self.modules=['calendars'];self.queries=[{'capability':'google.events','arguments':{'start':'2026-11-20T00:00:00-06:00','end':'2026-11-21T00:00:00-06:00'}}]
        with patch('boldApp.asistente.google.google_request',return_value={'items':[]}) as provider,patch('boldApp.calendario.presence.store_windows',side_effect=AssertionError('presence write')):
            pk=self.prepared([])
            self.assertEqual(self.get(pk)['state'],'completed')
            self.assertEqual(self.action(pk,'simulate').status_code,200)
            self.assertTrue(all(call.args[1]=='GET' for call in provider.call_args_list))
        self.assertEqual(CalendarDraft.objects.count(),0)

    def test_google_updates_have_etag_precondition(self):
        self.modules=['calendars'];self.queries=[{'capability':'google.event','arguments':{'id':'google-event'}}]
        event={'id':'google-event','summary':'Anterior','etag':'revision-1','start':{'dateTime':'2026-11-20T10:00:00-06:00'},'end':{'dateTime':'2026-11-20T11:00:00-06:00'}}
        step={'id':'meeting','capability':'google.update','target':'google-event','arguments':{'summary':'Revisada'},'depends_on':[]}
        def provider(user,method,path,**kwargs):
            if method=='PATCH':
                self.assertEqual(kwargs['extra_headers'],{'If-Match':'revision-1'})
                event.update(kwargs['body']);event['etag']='revision-2'
            return dict(event)
        with patch('boldApp.calendario.views.google_request',side_effect=provider),patch('boldApp.asistente.google.google_request',side_effect=provider):
            pk=self.prepared([step]);self.approve(pk);self.assertTrue(service.perform(pk));self.assertEqual(event['summary'],'Revisada')
        self.assertEqual(ActionReceipt.objects.get(request_id=pk).state,'completed')

    def test_assignment_removed_after_approval_stops_execution(self):
        pk=self.prepared([self.step()]);self.approve(pk)
        self.owner.is_active=False;self.owner.save(update_fields=['is_active'])
        self.assertFalse(service.perform(pk))
        self.assertFalse(Task.objects.filter(title='Asistente: nueva tarea').exists())

    def test_google_changed_after_approval_is_rejected_without_sending_a_write(self):
        self.modules=['calendars'];self.queries=[{'capability':'google.event','arguments':{'id':'google-event'}}]
        event={'id':'google-event','summary':'Anterior','etag':'revision-1','start':{'dateTime':'2026-11-20T10:00:00-06:00'},'end':{'dateTime':'2026-11-20T11:00:00-06:00'}}
        step={'id':'meeting','capability':'google.update','target':'google-event','arguments':{'summary':'Revisada'},'depends_on':[]}
        with patch('boldApp.calendario.views.google_request',return_value=event):
            pk=self.prepared([step]);self.approve(pk)
            with patch('boldApp.asistente.google._event_for_write',return_value={**event,'etag':'colleague-revision'}),patch('boldApp.asistente.google.google_request') as provider:
                self.assertFalse(service.perform(pk));provider.assert_not_called()
            self.assertEqual(self.get(pk)['state'],'failed')
        receipt=ActionReceipt.objects.get(request_id=pk)
        self.assertEqual(receipt.state,'failed');self.assertIn('evento cambió',receipt.error)
