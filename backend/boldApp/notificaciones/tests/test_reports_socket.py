from asgiref.sync import async_to_sync
from channels.db import database_sync_to_async
from channels.layers import get_channel_layer
from channels.testing import WebsocketCommunicator
from django.test import TransactionTestCase, RequestFactory, override_settings
from boldApp.autenticacion.services import create_session, issue_ws_ticket
from boldApp.core.models import Employee, UserAccount, OrganizationalUnit, JobRole, Position, PositionAssignment, Permission, JobRolePermission
from config.asgi import application
from .socket_helpers import receive_event


@override_settings(SECURE_SSL_REDIRECT=False)
class ReportsSocketTests(TransactionTestCase):
    def setUp(self):
        unit=OrganizationalUnit.objects.create(name='Reports socket',unit_type='department',sensitivity_level='low')
        employee=Employee.objects.create(full_name='Reports reader')
        self.account=UserAccount.objects.create_user(employee=employee,email='reports-socket@bold.gt')
        self.role=JobRole.objects.create(title='Reports reader')
        self.assignment=PositionAssignment.objects.create(employee=employee,position=Position.objects.create(unit=unit,job_role=self.role))
        _,self.session=create_session(self.account,RequestFactory().get('/',REMOTE_ADDR='127.0.0.1'))
        self.permission,_=Permission.objects.get_or_create(code='reports.analytics.run',defaults={'module_code':'reports','resource':'analytics','action':'run','risk_level':'low'})

    def socket(self):
        ticket=issue_ws_ticket(self.account,self.session,self.assignment.pk,None,'notifications')
        return WebsocketCommunicator(application,f'/ws/notifications/?ticket={ticket}',headers=[(b'origin',b'http://localhost:5173')])

    def test_subscription_is_opt_in_body_free_revocable_and_can_be_removed(self):
        socket=self.socket()
        async def scenario():
            self.assertTrue((await socket.connect())[0]);await receive_event(socket,'control.ready')
            layer=get_channel_layer()
            self.assertFalse(layer.groups.get('reports_watch'))
            await socket.send_json_to({'type':'reports.watch','enabled':True})
            self.assertTrue((await receive_event(socket,'reports.subscription'))['payload']['enabled'])
            await layer.group_send('reports_watch',{'type':'report.changed','scope':'work','recipients':None,'task_name':'PRIVATE'})
            event=await receive_event(socket,'reports.changed')
            self.assertEqual(event['payload'],{'scope':'work','allowed':True})
            await socket.send_json_to({'type':'reports.watch','enabled':False})
            self.assertFalse((await receive_event(socket,'reports.subscription'))['payload']['enabled'])
            self.assertFalse(layer.groups.get('reports_watch'))
            await socket.send_json_to({'type':'reports.watch','enabled':True});await receive_event(socket,'reports.subscription')
            await database_sync_to_async(JobRolePermission.objects.create)(job_role=self.role,permission=self.permission,effect='deny',scope_type='own_unit')
            await layer.group_send('reports_watch',{'type':'report.changed','scope':'work','recipients':None})
            self.assertFalse((await receive_event(socket,'reports.changed'))['payload']['allowed'])
            self.assertFalse(layer.groups.get('reports_watch'))
            await socket.disconnect()
        async_to_sync(scenario)()

    def test_definition_hint_only_reaches_its_selected_recipient(self):
        socket=self.socket()
        async def scenario():
            await socket.connect();await receive_event(socket,'control.ready')
            await socket.send_json_to({'type':'reports.watch','enabled':True});await receive_event(socket,'reports.subscription')
            layer=get_channel_layer()
            await layer.group_send('reports_watch',{'type':'report.changed','scope':'definitions','recipients':['another-assignment']})
            # A sentinel behind the excluded hint proves ordering without sleeps
            # or receive_nothing (which cancels some communicator instances).
            await layer.group_send('reports_watch',{'type':'report.changed','scope':'work','recipients':None})
            self.assertEqual((await receive_event(socket,'reports.changed'))['payload']['scope'],'work')
            await socket.disconnect();self.assertFalse(layer.groups.get('reports_watch'))
        async_to_sync(scenario)()
