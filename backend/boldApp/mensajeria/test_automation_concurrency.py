"""Only real PostgreSQL may certify automations' cross-worker row locks."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest import skipUnless
from django.db import connection, connections, close_old_connections
from django.test import TransactionTestCase, override_settings
from . import test_automations as base
from .automations import execute
from .models import AutomationRun, ChannelMessage


@skipUnless(connection.vendor == 'postgresql', 'Requires isolated PostgreSQL row locks')
@override_settings(MESSAGING_PILOT_ENABLED=False, MESSAGING_AUTOMATIONS_ENABLED=True)
class AutomationConcurrencyTests(TransactionTestCase):
    root = base.AutomationTests.root
    identity = base.AutomationTests.identity
    as_person = base.AutomationTests.as_person
    deny = base.AutomationTests.deny
    create = base.AutomationTests.create
    action = base.AutomationTests.action
    activate = base.AutomationTests.activate
    change_status = base.AutomationTests.change_status

    def setUp(self):
        # TransactionTestCase flushes data-migration catalog rows after each test.
        # Recreate the real permission definitions, not a permissive resolver.
        from boldApp.core.models import Permission
        for code in ('slack.channel.read', 'slack.channel.create', 'slack.channel.manage', 'slack.channel.access',
                'slack.message.create', 'slack.message.update', 'slack.automation.read', 'slack.automation.manage',
                'slack.page.read', 'slack.page.create', 'slack.template.read', 'tasks.task.read', 'tasks.project.read'):
            module, resource, action = code.split('.')
            Permission.objects.get_or_create(code=code, defaults={'module_code':module, 'resource':resource,
                'action':action, 'risk_level':'low', 'is_active':True})
        base.AutomationTests.setUp(self)

    def parallel(self, first, second):
        barrier = Barrier(2)
        def run(action):
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                return action()
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(run, action) for action in (first, second)]
            return [future.result(timeout=45) for future in futures]

    def test_two_workers_publish_one_due_occurrence(self):
        row, _ = self.create(); self.activate(row)
        results = self.parallel(lambda:execute(row['id'], now=self.start), lambda:execute(row['id'], now=self.start))
        self.assertEqual(results.count('published'), 1); self.assertEqual(ChannelMessage.objects.count(), 1)
        self.assertEqual(AutomationRun.objects.count(), 1); self.assertEqual(AutomationRun.objects.get().attempts, 1)

    def test_two_workers_publish_one_status_run(self):
        row, _ = self.create('task_status'); self.activate(row); self.change_status()
        run = AutomationRun.objects.get()
        results = self.parallel(lambda:execute(row['id'], run.pk), lambda:execute(row['id'], run.pk))
        self.assertEqual(sorted(results), ['published', 'settled']); self.assertEqual(ChannelMessage.objects.count(), 1)

    def test_pause_and_publication_have_one_serialized_outcome(self):
        row, _ = self.create(); row = self.activate(row)
        def pause():
            client = self.as_person(self.alice)
            import uuid
            return client.patch(self.endpoint + row['id'] + '/', {'client_id':str(uuid.uuid4()),
                'version':row['version'], 'active':False}, format='json').status_code
        result = self.parallel(pause, lambda:execute(row['id'], now=self.start))
        self.assertIn(tuple(result), ((200, 'not_due'), (409, 'published')))
        self.assertEqual(ChannelMessage.objects.count(), int(result[1] == 'published'))

    def test_concurrent_stale_status_saves_capture_one_transition(self):
        row, _ = self.create('task_status'); self.activate(row)
        from boldApp.tareas.models import Task
        first, second = Task.objects.get(pk=self.task.pk), Task.objects.get(pk=self.task.pk)
        def change(task):
            task.status_id = self.final.pk; task.save(update_fields=['status', 'updated_at'])
        self.parallel(lambda:change(first), lambda:change(second))
        self.assertEqual(AutomationRun.objects.count(), 1)

    def test_two_creators_cannot_exceed_account_rule_budget(self):
        import uuid
        from .models import ChannelAutomation
        def create():
            return self.as_person(self.alice).post(self.endpoint, {'client_id':str(uuid.uuid4()), 'name':'Carrera sintética',
                'kind':'reminder', 'body':'Recordatorio', 'next_at':self.start.isoformat(), 'share_confirmed':True}, format='json').status_code
        with override_settings(MESSAGING_AUTOMATION_ACCOUNT_RULES=1):
            self.assertEqual(sorted(self.parallel(create, create)), [201, 409])
        self.assertEqual(ChannelAutomation.objects.count(), 1)
