from datetime import timedelta
from uuid import uuid4
from django.test import TestCase,override_settings
from django.utils import timezone
from boldApp.autenticacion.models import AuthSession
from boldApp.core.serializers import AssignmentDirectorySerializer
from boldApp.tareas.report_realtime import report_assignment_allowed
from . import test_execution as base


class ReportsPilotTests(TestCase):
    person=base.TaskExecutionTests.person
    phase=base.TaskExecutionTests.phase
    as_person=base.TaskExecutionTests.as_person

    def setUp(self):
        base.TaskExecutionTests.setUp(self)
        self.pilot=override_settings(REPORTS_PILOT_ENABLED=True,REPORTS_PILOT_UNIT_IDS=(str(self.it.pk),))
        self.pilot.enable();self.addCleanup(self.pilot.disable)

    def test_apis_fail_closed_outside_it_including_owner_and_writes(self):
        outsider=self.person('Propietario fuera de IT',self.design,owner=True)
        for assignment in (self.worker,outsider):
            client=self.as_person(assignment)
            for path in ('catalog/','','filter-choices/','meeting-links/?event_id='+str(uuid4())):
                response=client.get('/api/v2/reports/'+path)
                self.assertEqual(response.status_code,403,(path,response.data))
            for path,payload in [('preview/',{'definition':{'metric':'tasks.total'}}),('',{'name':'No guardar','definition':{'metric':'tasks.total'}}),('meeting-links/',{})]:
                self.assertEqual(client.post('/api/v2/reports/'+path,payload,format='json').status_code,403)
        self.assertEqual(self.client.get('/api/v2/reports/catalog/').status_code,200)

    def test_exact_department_identity_and_empty_allowlist(self):
        self.design.name='Equipo de IT';self.design.save()
        self.assertEqual(self.as_person(self.worker).get('/api/v2/reports/').status_code,403)
        with override_settings(REPORTS_PILOT_UNIT_IDS=()):
            self.assertEqual(self.client.get('/api/v2/reports/').status_code,403)
        with override_settings(REPORTS_PILOT_ENABLED=False):
            self.assertEqual(self.as_person(self.worker).get('/api/v2/reports/').status_code,200)

    def test_directory_and_socket_agree_with_api_rollout(self):
        for assignment,allowed in ((self.owner,True),(self.worker,False)):
            self.assertEqual(AssignmentDirectorySerializer(assignment).data['reports_enabled'],allowed)
            user=assignment.employee.user_account
            session=AuthSession.objects.create(user_account=user,token_hash=uuid4().hex,credentials_version=user.credentials_version,expires_at=timezone.now()+timedelta(hours=1))
            self.assertEqual(report_assignment_allowed(assignment.pk,session.pk),allowed)
