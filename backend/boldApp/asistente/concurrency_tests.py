"""Row-lock acceptance. Never run against an application or production DB."""
from concurrent.futures import ThreadPoolExecutor
from importlib import import_module
from threading import Barrier
from types import SimpleNamespace
from unittest import SkipTest
from uuid import uuid4
from django.apps import apps
from django.core.management import call_command
from django.db import connection,connections,close_old_connections
from django.test import TransactionTestCase
from .tests import AssistantTests as Fixture
from .models import AssistantRequest,ActionReceipt
from . import service,gate
from boldApp.tareas.models import Task


class AssistantConcurrencyTests(TransactionTestCase):
    person=Fixture.person
    phase=Fixture.phase
    as_person=Fixture.as_person
    client_for=Fixture.client_for
    create=Fixture.create
    output=Fixture.output
    step=Fixture.step
    get=Fixture.get
    action=Fixture.action
    prepared=Fixture.prepared
    reveal=Fixture.reveal
    approve=Fixture.approve

    def setUp(self):
        if connection.vendor!='postgresql' or connection.settings_dict['NAME']!='test_bold_reports_validation':
            raise SkipTest('Requires the isolated localhost reports PostgreSQL test database.')
        import io
        call_command('seed_demo_data',stdout=io.StringIO())
        editor=SimpleNamespace(connection=connection)
        for module,function in [('boldApp.tareas.migrations.0018_taskexecution_tasktracking_executiontemplate_and_more','initialize_tracking_and_permissions'),
                ('boldApp.tareas.migrations.0019_savedreport_meetingworklink','reporting_permissions'),
                ('boldApp.asistente.migrations.0002_permissions','initialize')]:
            getattr(import_module(module),function)(apps,editor)
        Fixture.setUp(self)

    def race(self,command):
        barrier=Barrier(2)
        def invoke():
            close_old_connections()
            try:
                with connection.cursor() as cursor:cursor.execute("SET lock_timeout = '8s'")
                barrier.wait(timeout=5)
                return command()
            finally:connections.close_all()
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures=[pool.submit(invoke) for _ in range(2)]
            return [future.result(timeout=30) for future in futures]

    def client(self):
        from rest_framework.test import APIClient
        from boldApp.autenticacion.models import AuthSession
        session=AuthSession.objects.select_related('user_account').get(pk=self.session.pk)
        client=APIClient();client.force_authenticate(session.user_account,token=session)
        client.credentials(HTTP_X_ASSIGNMENT_ID=str(self.owner.pk));return client

    def test_concurrent_approvals_and_workers_create_each_task_once(self):
        pk=self.prepared([self.step()]);data=self.get(pk)
        body={'version':data['version'],'digest':data['proposal']['digest'],'execution_id':str(uuid4())}
        # Fixture.setUp owns self.client, use a separate constructor in threads.
        def approve():return self.thread_client().post(f'/api/v2/assistant/requests/{pk}/execute/',body,format='json').status_code
        self.assertEqual(self.race(approve),[202,202])
        self.assertEqual(sorted(self.race(lambda:service.perform(pk))),[False,True])
        self.assertEqual(Task.objects.filter(title='Asistente: nueva tarea').count(),1)
        self.assertEqual(ActionReceipt.objects.filter(request_id=pk,state='completed').count(),1)

    def test_only_one_active_request_is_admitted_per_account(self):
        def create():return self.thread_client().post('/api/v2/assistant/requests/',{'text':'Una tarea','client_id':str(uuid4())},format='json').status_code
        self.assertEqual(sorted(self.race(create)),[202,400])
        self.assertEqual(AssistantRequest.objects.filter(account=self.session.user_account).count(),1)

    def test_global_inference_lease_is_shared_by_all_workers(self):
        owners=self.race(gate.acquire)
        self.assertEqual(sum(owner is not None for owner in owners),1)
        owner=next(owner for owner in owners if owner)
        self.assertTrue(gate.renew(owner));self.assertFalse(gate.renew(uuid4()))
        gate.release(owner);self.assertIsNotNone(gate.acquire())

    thread_client=client
