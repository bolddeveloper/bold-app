import uuid
from unittest import skipUnless
from django.db import connection
from django.test import TransactionTestCase,override_settings
from boldApp.core.models import Permission
from boldApp.tareas.models import Task,TaskProject
from . import test_task_conversions as fixture
from . import test_channel_concurrency as concurrent
from .models import MessageTaskConversion


@skipUnless(connection.vendor=='postgresql','Requires isolated PostgreSQL row locks')
@override_settings(MESSAGING_PILOT_ENABLED=False,AUTH_ENCRYPTION_KEY='task-concurrency-test-only')
class TaskConversionConcurrencyTests(TransactionTestCase):
    root=fixture.TaskConversionTests.root
    identity=fixture.TaskConversionTests.identity
    as_person=fixture.TaskConversionTests.as_person
    blocks=fixture.TaskConversionTests.blocks
    direct=fixture.TaskConversionTests.direct
    channel_message=fixture.TaskConversionTests.channel_message
    create=fixture.TaskConversionTests.create
    parallel=concurrent.ChannelConcurrencyTests.parallel

    def setUp(self):
        for module,resource,action in [('slack',r,a) for r,a in [('channel','read'),('channel','create'),('channel','manage'),('channel','access'),('message','create'),('message','update'),('page','read'),('page','create'),('page','update'),('page','manage')]]+[
            ('tasks','task','read'),('tasks','task','create'),('tasks','project','read'),('tasks','project','manage')]:
            Permission.objects.get_or_create(code=f'{module}.{resource}.{action}',defaults={'module_code':module,'resource':resource,'action':action,'risk_level':'low'})
        fixture.TaskConversionTests.setUp(self)

    def test_same_pending_creation_commits_one_normal_task_and_one_link(self):
        results=self.parallel([lambda:self.create(self.as_person(self.alice)),lambda:self.create(self.as_person(self.alice))])
        self.assertEqual(sorted(code for code,_ in results),[200,201])
        self.assertEqual(len({data['task']['id'] for _,data in results}),1)
        self.assertEqual(Task.objects.count(),1);self.assertEqual(TaskProject.objects.count(),1);self.assertEqual(MessageTaskConversion.objects.count(),1)

    def test_different_intent_cannot_reuse_an_already_accepted_client_id(self):
        results=self.parallel([lambda:self.create(self.as_person(self.alice)),lambda:self.create(self.as_person(self.alice),title='Otro texto')])
        self.assertEqual(sorted(code for code,_ in results),[201,409]);self.assertEqual(Task.objects.count(),1)

    def test_deliberate_distinct_tasks_from_one_message_keep_both_references(self):
        results=self.parallel([lambda:self.create(self.as_person(self.alice)),lambda:self.create(self.as_person(self.alice),client_id=str(uuid.uuid4()))])
        self.assertEqual([code for code,_ in results],[201,201])
        self.assertEqual(Task.objects.count(),2);self.assertEqual(MessageTaskConversion.objects.count(),2)
