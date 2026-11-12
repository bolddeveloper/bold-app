"""Real row-lock acceptance, explicitly limited to an isolated local test DB."""
from concurrent.futures import ThreadPoolExecutor
from importlib import import_module
from threading import Barrier
from types import SimpleNamespace
from unittest import SkipTest
from uuid import uuid4
from django.apps import apps
from django.db import connection, connections, close_old_connections
from django.test import TransactionTestCase
from boldApp.tareas.models import Task, TaskPhase, TaskExecution, TaskTimelineEvent
from . import test_execution as base


class ExecutionConcurrencyTests(TransactionTestCase):
    person=base.TaskExecutionTests.person
    as_person=base.TaskExecutionTests.as_person
    phase=base.TaskExecutionTests.phase
    define=base.TaskExecutionTests.define
    act=base.TaskExecutionTests.act
    finish=base.TaskExecutionTests.finish

    def setUp(self):
        if connection.vendor!='postgresql' or connection.settings_dict['NAME']!='test_bold_reports_validation':
            raise SkipTest('Requires the isolated localhost reports PostgreSQL test database.')
        # TransactionTestCase flushes data migrations between cases. Restore
        # only their permission catalog, without granting test users new rights.
        from django.core.management import call_command
        import io
        call_command('seed_demo_data',stdout=io.StringIO())
        editor=SimpleNamespace(connection=connection)
        import_module('boldApp.tareas.migrations.0018_taskexecution_tasktracking_executiontemplate_and_more').initialize_tracking_and_permissions(apps,editor)
        import_module('boldApp.tareas.migrations.0019_savedreport_meetingworklink').reporting_permissions(apps,editor)
        base.TaskExecutionTests.setUp(self)
        self.assertEqual(self.define([self.phases[0]]).status_code,200)

    def race(self,first,second):
        gate=Barrier(2)
        def invoke(command):
            close_old_connections()
            try:
                with connection.cursor() as cursor:cursor.execute("SET lock_timeout = '5s'")
                gate.wait(timeout=5)
                return command(self.as_person(self.owner))
            finally:connections.close_all()
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures=[pool.submit(invoke,command) for command in (first,second)]
            return [future.result(timeout=15) for future in futures]

    def start_payload(self):
        return {'version':1,'operation_id':str(uuid4()),'phase_id':self.phases[0]['id'],'action':'start'}

    def test_two_different_commands_cannot_overwrite_one_version(self):
        payloads=[self.start_payload(),self.start_payload()]
        results=self.race(*(lambda client,payload=payload:client.post(self.url,payload,format='json') for payload in payloads))
        self.assertEqual(sorted(row.status_code for row in results),[200,409])
        self.assertEqual(TaskExecution.objects.get(task=self.task).version,2)
        self.assertEqual(TaskTimelineEvent.objects.filter(phase_id=self.phases[0]['id'],kind='phase.transition',after__status='in_progress').count(),1)

    def test_simultaneous_retry_applies_once_and_returns_success_twice(self):
        payload=self.start_payload()
        operation=lambda client:client.post(self.url,payload,format='json')
        results=self.race(operation,operation)
        self.assertEqual([row.status_code for row in results],[200,200])
        self.assertEqual(TaskExecution.objects.get(task=self.task).version,2)

    def test_reopening_and_legacy_completion_cannot_leave_a_finished_task_with_open_phases(self):
        self.finish(self.phases[0]);version=TaskExecution.objects.get(task=self.task).version
        def reopen(client):return client.post(self.url,{'version':version,'operation_id':str(uuid4()),'phase_id':self.phases[0]['id'],'action':'reopen','reason':'Revisar el trabajo'},format='json')
        def complete(client):return client.patch(f'/api/v2/tasks/{self.task.pk}/',{'status':str(self.final.pk)},format='json')
        results=self.race(reopen,complete)
        self.assertEqual(results[0].status_code,200,results[0].data)
        self.assertIn(results[1].status_code,[200,400])
        self.task.refresh_from_db();self.assertFalse(self.task.status.is_final)
        self.assertIsNone(self.task.completed_at)
        self.assertEqual(TaskPhase.objects.get(pk=self.phases[0]['id']).status,'available')
        sequence=list(TaskTimelineEvent.objects.filter(task=self.task).values_list('sequence',flat=True))
        self.assertEqual(len(sequence),len(set(sequence)))

    def test_report_version_allows_only_one_simultaneous_replacement(self):
        key=str(uuid4());payload={'id':key,'version':0,'name':'Informe original','definition':{'metric':'tasks.total'}}
        self.assertEqual(self.client.post('/api/v2/reports/',payload,format='json').status_code,200)
        def rename(name):return lambda client:client.post('/api/v2/reports/',{**payload,'version':1,'name':name},format='json')
        results=self.race(rename('Primera revisión'),rename('Segunda revisión'))
        self.assertEqual(sorted(row.status_code for row in results),[200,409])
