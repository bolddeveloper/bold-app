from datetime import timedelta
from uuid import uuid4
from django.test import TestCase
from django.utils import timezone
from boldApp.core.models import JobRolePermission, Permission
from boldApp.tareas.models import Task, Project, TaskProject, TaskPhase, TaskTimelineEvent
from boldApp.calendario.models import AppCalendar, AppCalendarEvent, CalendarMember
from . import test_execution as base


class ReportsApiTests(TestCase):
    setUp=base.TaskExecutionTests.setUp
    person=base.TaskExecutionTests.person
    as_person=base.TaskExecutionTests.as_person
    phase=base.TaskExecutionTests.phase
    define=base.TaskExecutionTests.define
    act=base.TaskExecutionTests.act
    finish=base.TaskExecutionTests.finish

    def query(self,definition=None,client=None,**extra):
        today=timezone.now().date().isoformat()
        definition={'from':today,'to':today,'timezone':'UTC',**(definition or {})}
        return (client or self.client).post('/api/v2/reports/preview/',{'definition':definition,**extra},format='json')

    def complete(self,task=None):
        task=task or self.task;task.status=self.final;task.save();task.refresh_from_db()
        return task

    def test_completion_is_grouped_by_real_delivery_not_future_due_date(self):
        self.task.due_date=timezone.now().date()+timedelta(days=20);self.task.save()
        self.complete()
        response=self.query({'metric':'tasks.completed','group_by':'day'})
        self.assertEqual(response.status_code,200,response.data)
        self.assertEqual(response.data['summary']['value'],1)
        self.assertEqual(response.data['groups'][0]['key'],timezone.now().date().isoformat())
        self.assertEqual(response.data['coverage']['historical_unknown'],0)

    def test_missing_deadline_is_unknown_not_an_on_time_or_late_delivery(self):
        self.complete()
        response=self.query({'metric':'tasks.on_time'})
        self.assertEqual(response.status_code,200,response.data)
        self.assertIsNone(response.data['summary']['value'])
        self.assertEqual(response.data['summary']['unknown'],1)
        self.assertEqual(response.data['summary']['sample_size'],0)

    def test_reassignment_and_deadline_edits_do_not_rewrite_completed_work(self):
        self.task.due_date=timezone.now().date()+timedelta(days=1);self.task.save();self.complete()
        self.task.assignee_assignment=self.worker;self.task.due_date=timezone.now().date()-timedelta(days=10);self.task.save()
        response=self.query({'metric':'tasks.completed','filters':{'assignments':[str(self.owner.pk)]}})
        self.assertEqual(response.status_code,200,response.data)
        self.assertEqual(response.data['summary']['value'],1)
        ontime=self.query({'metric':'tasks.on_time'})
        self.assertEqual(ontime.data['summary']['value'],100)

    def test_shared_report_does_not_share_underlying_private_tasks_or_editing(self):
        self.complete();key=str(uuid4());today=timezone.now().date().isoformat()
        saved=self.client.post('/api/v2/reports/',{'id':key,'version':0,'name':'Entregas',
            'definition':{'metric':'tasks.completed','from':today,'to':today,'timezone':'UTC'},
            'shared_with':[str(self.worker.pk)]},format='json')
        self.assertEqual(saved.status_code,200,saved.data)
        worker=self.as_person(self.worker)
        self.assertEqual(len(worker.get('/api/v2/reports/?collection=shared').data['results']),1)
        result=worker.post('/api/v2/reports/preview/',{'id':key},format='json')
        self.assertEqual(result.status_code,200,result.data)
        self.assertEqual(result.data['summary']['value'],0)
        self.assertEqual(result.data['details'],[])
        self.assertEqual(worker.post('/api/v2/reports/',{'id':key,'version':1,'archive':True},format='json').status_code,404)
        self.assertEqual(self.as_person(self.other).post('/api/v2/reports/preview/',{'id':key},format='json').status_code,404)

    def test_report_versions_and_revoked_sharing_are_effective_on_the_next_request(self):
        data={'id':str(uuid4()),'version':0,'name':'Plan semanal','definition':{'metric':'tasks.total'},'shared_with':[str(self.worker.pk)]}
        created=self.client.post('/api/v2/reports/',data,format='json');self.assertEqual(created.status_code,200,created.data)
        self.assertEqual(self.client.post('/api/v2/reports/',data,format='json').status_code,409)
        data.update(version=1,shared_with=[])
        self.assertEqual(self.client.post('/api/v2/reports/',data,format='json').status_code,200)
        self.assertEqual(self.as_person(self.worker).post('/api/v2/reports/preview/',{'id':data['id']},format='json').status_code,404)

    def test_team_analytics_needs_org_authority_and_still_requires_task_visibility(self):
        self.assertEqual(self.query({'metric':'tasks.total','group_by':'employee','scope':'team'}).status_code,403)
        self.worker.position.reports_to_position=self.owner.position;self.worker.position.save()
        other=Task.objects.create(unit=self.design,status=self.pending,title='Privada de Diseño',priority='Media',
            created_by_assignment=self.worker,assignee_assignment=self.worker)
        response=self.query({'metric':'tasks.total','scope':'team','group_by':'employee'})
        self.assertEqual(response.status_code,200,response.data)
        self.assertEqual(response.data['summary']['value'],0)
        JobRolePermission.objects.filter(job_role=self.owner.position.job_role,permission__code='tasks.task.read').update(scope_type='global')
        response=self.query({'metric':'tasks.total','scope':'team','group_by':'employee'})
        self.assertEqual(response.data['summary']['value'],1)
        self.assertEqual(response.data['groups'][0]['label'],'Diseño')
        JobRolePermission.objects.create(job_role=self.owner.position.job_role,permission=Permission.objects.get(code='reports.team.read'),scope_type='global',effect='deny')
        self.assertEqual(self.query({'scope':'team'}).status_code,403)

    def test_project_summary_deduplicates_tasks_shared_by_two_projects(self):
        projects=[Project.objects.create(name=name,unit=self.it,status='active',owner_assignment=self.owner,
            created_by_assignment=self.owner) for name in ('Uno','Dos')]
        for project in projects:TaskProject.objects.create(task=self.task,project=project,position=0,added_by_assignment=self.owner)
        # Completing every project pipeline is the existing public task contract.
        from boldApp.tareas.pipelines import aggregate_status
        for link in self.task.task_projects.select_related('pipeline'):
            completed=next(s for s in link.pipeline.stages if s['kind']=='completed')
            link.pipeline_stage=completed['id'];link.save()
        pending=Task.objects.create(unit=self.it,status=self.pending,title='Pendiente',priority='Media',
            created_by_assignment=self.owner,assignee_assignment=self.owner)
        TaskProject.objects.create(task=pending,project=projects[0],position=1,added_by_assignment=self.owner)
        result=self.query({'metric':'projects.progress','group_by':'project'})
        self.assertEqual(result.status_code,200,result.data)
        self.assertEqual(result.data['summary']['distinct_tasks'],2)
        self.assertEqual(result.data['summary']['value'],50)
        self.assertEqual(sorted(g['value'] for g in result.data['groups']),[50,100])
        for grouping in ['none','department']:
            grouped=self.query({'metric':'projects.progress','group_by':grouping})
            self.assertEqual(grouped.data['summary']['value'],50)
            self.assertEqual(grouped.data['groups'][0]['value'],50)

    def test_meeting_duration_is_programmed_and_calendar_access_is_not_inherited(self):
        now=timezone.now();calendar=AppCalendar.objects.create(name='Agenda privada',owner=self.owner.employee.user_account)
        event=AppCalendarEvent.objects.create(calendar=calendar,start_at=now,end_at=now+timedelta(minutes=45),data={'summary':'Revisión'})
        worker=self.as_person(self.worker)
        self.assertEqual(self.query({'metric':'meetings.total'},client=worker).data['summary']['value'],0)
        CalendarMember.objects.create(calendar=calendar,user=self.worker.employee.user_account,role='reader')
        result=self.query({'metric':'meetings.scheduled_hours'},client=worker)
        self.assertEqual(result.status_code,200,result.data)
        self.assertEqual(result.data['summary']['value'],0.75)
        self.assertIn('no acredita asistencia',result.data['formula'])

    def test_meetings_crossing_midnight_allocate_duration_to_each_local_day(self):
        today=timezone.now().replace(hour=0,minute=0,second=0,microsecond=0)
        calendar=AppCalendar.objects.create(name='Turno nocturno',owner=self.owner.employee.user_account)
        AppCalendarEvent.objects.create(calendar=calendar,start_at=today-timedelta(minutes=30),end_at=today+timedelta(minutes=30),data={'summary':'Revisión nocturna'})
        result=self.query({'metric':'meetings.scheduled_hours','group_by':'day','from':(today-timedelta(days=1)).date().isoformat()})
        self.assertEqual(result.status_code,200,result.data)
        self.assertEqual(result.data['summary']['value'],1)
        self.assertEqual(result.data['summary']['distinct_meetings'],1)
        self.assertEqual([row['value'] for row in result.data['groups']],[0.5,0.5])
        current=self.query({'metric':'meetings.total','group_by':'day'})
        self.assertEqual(current.data['summary']['value'],1)
        self.assertEqual(current.data['groups'][0]['key'],today.date().isoformat())

    def test_normal_employee_can_create_report_but_explicit_deny_still_wins(self):
        self.assertEqual(self.client.get('/api/v2/reports/catalog/').status_code,200)
        JobRolePermission.objects.create(job_role=self.owner.position.job_role,permission=Permission.objects.get(code='reports.analytics.run'),scope_type='own_unit',effect='deny')
        self.assertEqual(self.query().status_code,403)

    def test_illegal_filters_and_unbounded_periods_do_not_execute_queries(self):
        for definition in ({'sql':'select *'}, {'metric':'employee.score'},
                           {'from':'2000-01-01','to':'2030-01-01'}, {'metric':'meetings.total','scope':'team'}):
            result=self.query(definition)
            self.assertEqual(result.status_code,400,result.data)

    def test_phase_project_groups_and_shared_responsibility_keep_unique_totals(self):
        project=Project.objects.create(name='Proyecto conjunto',unit=self.it,status='active',owner_assignment=self.owner,created_by_assignment=self.owner)
        TaskProject.objects.create(task=self.task,project=project,position=0,added_by_assignment=self.owner)
        phase=self.phase('Paso compartido',self.owner,responsible=[str(self.owner.pk),str(self.worker.pk)])
        self.assertEqual(self.define([phase]).status_code,200)
        self.finish(phase)
        # Explicit analytic authority does not grant access to other tasks.
        JobRolePermission.objects.create(job_role=self.owner.position.job_role,permission=Permission.objects.get(code='reports.team.read'),scope_type='global',effect='allow')
        result=self.query({'metric':'phases.completed','group_by':'employee'})
        self.assertEqual(result.status_code,200,result.data)
        self.assertEqual(result.data['summary']['value'],1)
        self.assertEqual({row['label'] for row in result.data['groups']},{'Coordinación','Diseño'})
        self.assertTrue(all(row['value']==1 for row in result.data['groups']))
        grouped=self.query({'metric':'phases.completed','group_by':'project'})
        self.assertEqual(grouped.data['groups'][0]['label'],project.name)
        mine=self.query({'metric':'phases.completed','scope':'self'},client=self.as_person(self.worker))
        self.assertEqual(mine.data['summary']['value'],1)
        TaskPhase.objects.filter(pk=phase['id']).update(lead=self.worker,unit=self.design,archived_at=timezone.now())
        historic=self.query({'metric':'phases.completed','filters':{'units':[str(self.it.pk)]}})
        self.assertEqual(historic.data['summary']['value'],1)

    def test_filter_choices_never_disclose_an_unreadable_task_or_its_phase(self):
        self.assertEqual(self.define().status_code,200)
        result=self.as_person(self.other).get('/api/v2/reports/filter-choices/')
        self.assertEqual(result.status_code,200,result.data)
        self.assertNotIn(str(self.task.pk),[row['id'] for row in result.data['tasks']])
        self.assertNotIn('Revisión',result.data['phases'])
        visible=self.client.get('/api/v2/reports/filter-choices/?q=Remodelar')
        self.assertEqual(visible.status_code,200,visible.data)
        self.assertIn(str(self.task.pk),[row['id'] for row in visible.data['tasks']])

    def test_meeting_links_keep_calendar_and_task_authorization_separate(self):
        now=timezone.now();calendar=AppCalendar.objects.create(name='Agenda de trabajo',owner=self.owner.employee.user_account)
        event=AppCalendarEvent.objects.create(calendar=calendar,start_at=now,end_at=now+timedelta(hours=1),data={'summary':'Acuerdos'})
        url='/api/v2/reports/meeting-links/';payload={'event_id':str(event.pk),'task_id':str(self.task.pk)}
        self.assertEqual(self.as_person(self.worker).post(url,payload,format='json').status_code,404)
        response=self.client.post(url,payload,format='json');self.assertEqual(response.status_code,200,response.data)
        self.assertEqual(self.query({'metric':'meetings.total','filters':{'tasks':[str(self.task.pk)]}}).data['summary']['value'],1)
        self.assertEqual(self.client.get(url,{'event_id':str(event.pk)}).data['results'][0]['task_id'],str(self.task.pk))
        self.assertEqual(self.client.delete(url,payload,format='json').status_code,204)
        self.assertEqual(self.query({'metric':'meetings.total','filters':{'tasks':[str(self.task.pk)]}}).data['summary']['value'],0)

    def test_progress_source_rows_are_percentages_and_csv_escapes_formula_titles(self):
        self.complete();result=self.query({'metric':'tasks.progress'})
        self.assertEqual(result.data['summary']['value'],100)
        self.assertEqual(result.data['details'][0]['value'],100)
        self.task.title='=1+1';self.task.save(update_fields=['title'])
        download=self.query({'metric':'tasks.total'},download=True)
        self.assertEqual(download.status_code,200)
        self.assertIn("'=1+1",download.content.decode('utf-8'))
        self.assertIn('no-store',download['Cache-Control'])

    def test_bounded_report_counts_are_not_totals_from_the_first_detail_page(self):
        from django.db import connection
        from django.test.utils import CaptureQueriesContext
        with CaptureQueriesContext(connection) as small:
            self.assertEqual(self.query({'metric':'tasks.total'}).data['summary']['value'],1)
        Task.objects.bulk_create([Task(unit=self.it,status=self.pending,title=f'Caso sintético {index}',priority='Media',
            created_by_assignment=self.owner,assignee_assignment=self.owner) for index in range(1000)])
        with CaptureQueriesContext(connection) as larger:
            result=self.query({'metric':'tasks.total'})
        self.assertEqual(result.status_code,200,result.data)
        self.assertEqual(result.data['summary']['value'],1001)
        self.assertEqual(result.data['detail_count'],1001)
        self.assertEqual(len(result.data['details']),50)
        self.assertEqual(result.data['details_next'],50)
        self.assertLessEqual(len(larger),len(small)+3,'Resource authorization and rendering must not add one query per task.')
        second=self.query({'metric':'tasks.total'},offset=50,detail_snapshot=result.data['detail_snapshot'])
        self.assertEqual(second.status_code,200,second.data)
        self.assertFalse({row['id'] for row in result.data['details']}&{row['id'] for row in second.data['details']})
        Task.objects.create(unit=self.it,status=self.pending,title='Nuevo mientras se pagina',priority='Media',created_by_assignment=self.owner,assignee_assignment=self.owner)
        self.assertEqual(self.query({'metric':'tasks.total'},offset=50,detail_snapshot=result.data['detail_snapshot']).status_code,409)

    def test_phase_cohorts_preserve_full_cycle_while_activity_clips_only_its_window(self):
        phase=self.phases[0];self.assertEqual(self.define([phase]).status_code,200)
        self.act(phase,'start');self.act(phase,'block',reason='Dependencia externa');self.act(phase,'resume');self.act(phase,'complete')
        start=(timezone.now()-timedelta(days=5)).replace(hour=0,minute=0,second=0,microsecond=0)
        starts=0
        for event in TaskTimelineEvent.objects.filter(phase_id=phase['id']).order_by('sequence'):
            state=event.after.get('status');hour={'pending':0,'available':0,'blocked':2,'completed':49}.get(state,0)
            if state=='in_progress':starts+=1;hour=1 if starts==1 else 48
            TaskTimelineEvent.objects.filter(pk=event.pk).update(occurred_at=start+timedelta(hours=hour))
        TaskPhase.objects.filter(pk=phase['id']).update(created_at=start,started_at=start+timedelta(hours=1),completed_at=start+timedelta(hours=49))
        cohort={'from':start.date().isoformat(),'to':start.date().isoformat(),'date_basis':'created'}
        self.assertEqual(self.query({'metric':'phases.completed',**cohort}).data['summary']['value'],1)
        self.assertEqual(self.query({'metric':'phases.cycle_hours',**cohort}).data['summary']['value'],48)
        self.assertEqual(self.query({'metric':'phases.active_hours',**cohort}).data['summary']['value'],2)
        completed_day=(start+timedelta(hours=49)).date().isoformat()
        self.assertEqual(self.query({'metric':'phases.active_hours','date_basis':'completed','from':completed_day,'to':completed_day}).data['summary']['value'],2)
        middle=(start+timedelta(days=1)).date().isoformat()
        self.assertEqual(self.query({'metric':'phases.blocked_hours','date_basis':'activity','from':middle,'to':middle}).data['summary']['value'],24)
