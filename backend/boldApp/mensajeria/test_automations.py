import uuid
from datetime import timedelta
from unittest.mock import patch
from django.db import transaction
from django.db import connection
from django.test import TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from boldApp.core.models import Permission, JobRolePermission
from boldApp.tareas.models import Project, Task, TaskProject, TaskStatus
from . import test_channels as base
from .automations import drain, execute, record_failure
from .models import ChannelAutomation, AutomationAudit, AutomationRun, ChannelMessage, ChannelPage, PageTemplate, ChannelAccessRule, DepartmentChannel


@override_settings(MESSAGING_PILOT_ENABLED=False, MESSAGING_AUTOMATIONS_ENABLED=True)
class AutomationTests(TestCase):
    root = base.DepartmentChannelTests.root
    identity = base.DepartmentChannelTests.identity
    as_person = base.DepartmentChannelTests.as_person
    deny = base.DepartmentChannelTests.deny

    def setUp(self):
        base.DepartmentChannelTests.setUp(self)
        self.endpoint = self.url + 'automations/'
        for code in ('tasks.task.read', 'tasks.project.read'):
            JobRolePermission.objects.get_or_create(job_role=self.role, permission=Permission.objects.get(code=code),
                scope_type='global', defaults={'effect':'allow'})
        self.project = Project.objects.create(unit=self.it, owner_assignment=self.alice, created_by_assignment=self.alice,
            name='Proyecto privado sintético', status='active')
        self.initial = TaskStatus.objects.filter(unit=self.it, category='todo').first()
        self.final = TaskStatus.objects.filter(unit=self.it, is_final=True).first()
        self.task = Task.objects.create(unit=self.it, status=self.initial, title='NO COPIAR: título privado',
            created_by_assignment=self.alice, priority='Media')
        TaskProject.objects.create(task=self.task, project=self.project, position=1, added_by_assignment=self.alice)
        self.start = timezone.now() + timedelta(minutes=10)

    def create(self, kind='reminder', client=None, **extra):
        values = {'client_id':str(uuid.uuid4()), 'name':'Regla sintética', 'kind':kind, 'share_confirmed':True}
        if kind == 'task_status':
            values.update(project_id=str(self.project.pk), to_status_id=str(self.final.pk))
        elif kind == 'recurring_page':
            template = PageTemplate.objects.create(channel_id=self.channel_id, creator=self.alice.employee, client_id=uuid.uuid4(),
                creation_digest='a'*64, name='Modelo privado', title='Revisión periódica', icon='note',
                blocks=[{'id':str(uuid.uuid4()), 'type':'check', 'text':'Revisar', 'checked':False}])
            values.update(template_id=str(template.pk), template_version=1, next_at=self.start.isoformat(), interval_days=7)
        else:
            values.update(body='Recordatorio sintético', next_at=self.start.isoformat())
        result = (client or self.client).post(self.endpoint, {**values, **extra}, format='json')
        self.assertEqual(result.status_code, 201, result.data)
        return result.data, {**values, **extra}

    def action(self, row, active, **extra):
        return self.client.patch(self.endpoint + row['id'] + '/', {'client_id':str(uuid.uuid4()), 'version':row['version'],
            'active':active, 'share_confirmed':True, **extra}, format='json')

    def activate(self, row):
        response = self.action(row, True); self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def change_status(self, status=None):
        self.task.refresh_from_db(); self.task.status = status or self.final
        self.task.save(update_fields=['status', 'updated_at'])

    def test_three_types_start_paused_and_creation_retries_are_immutable(self):
        for kind in ('task_status', 'reminder', 'recurring_page'):
            row, values = self.create(kind)
            self.assertFalse(row['active']); self.assertEqual(drain(now=self.start)['published'], 0)
            result = self.client.post(self.endpoint, values, format='json')
            self.assertEqual(result.status_code, 200, result.data); self.assertEqual(result.data['id'], row['id'])
            self.assertEqual(self.client.post(self.endpoint, {**values, 'name':'Otro intento'}, format='json').status_code, 409)
        self.assertEqual(ChannelAutomation.objects.count(), 3); self.assertEqual(AutomationAudit.objects.count(), 3)
        self.assertFalse(AutomationRun.objects.exists()); self.assertFalse(ChannelMessage.objects.exists())

    def test_status_change_queues_transactionally_no_existing_or_creation_backfill(self):
        row, _ = self.create('task_status'); row = self.activate(row)
        self.assertFalse(AutomationRun.objects.exists())
        self.task.title = 'Otra edición'; self.task.save(update_fields=['title'])
        self.assertFalse(AutomationRun.objects.exists())
        self.change_status()
        self.assertEqual(AutomationRun.objects.count(), 1); self.assertFalse(ChannelMessage.objects.exists())
        result = drain(); self.assertEqual(result['published'], 1, result)
        message = ChannelMessage.objects.get()
        self.assertEqual(message.task_id, self.task.pk); self.assertEqual(message.automation_kind, 'task_status')
        self.assertNotIn(self.task.title, message.body); self.assertNotIn(self.project.name, message.body)
        self.assertEqual(drain()['published'], 0); self.assertEqual(ChannelMessage.objects.count(), 1)
        self.task.refresh_from_db(); self.assertEqual(self.task.status_id, self.final.pk)
        self.assertEqual(AutomationRun.objects.count(), 1, 'action never changes a Task or emits another Task transition')
        response = self.client.get(self.url + 'messages/')
        self.assertFalse(response.data['results'][0]['can_edit'])
        self.assertEqual(self.client.patch(self.url + 'messages/' + str(message.pk) + '/',
            {'body':'No alterar el registro', 'version':1}, format='json').status_code, 403)

    def test_rollback_discards_transition_and_run(self):
        row, _ = self.create('task_status'); self.activate(row)
        with self.assertRaises(RuntimeError):
            with transaction.atomic():
                self.change_status(); self.assertEqual(AutomationRun.objects.count(), 1)
                raise RuntimeError('rollback sintético')
        self.assertFalse(AutomationRun.objects.exists()); self.task.refresh_from_db()
        self.assertEqual(self.task.status_id, self.initial.pk)

    def test_from_status_filter_and_project_membership_are_required(self):
        foreign = Project.objects.create(unit=self.it, owner_assignment=self.alice, created_by_assignment=self.alice, name='Otro', status='active')
        row, _ = self.create('task_status', project_id=str(foreign.pk)); self.activate(row)
        row, _ = self.create('task_status', from_status_id=str(TaskStatus.objects.filter(unit=self.it, category='in_progress').first().pk)); self.activate(row)
        self.change_status(); self.assertFalse(AutomationRun.objects.exists())

    def test_status_fanout_counts_quota_once_and_honors_the_remaining_budget(self):
        for index in range(5):
            row, _ = self.create('task_status', name=f'Regla {index}'); self.activate(row)
        # Ten audit rows already exist; only two new runs may fit.
        with override_settings(MESSAGING_AUTOMATION_MAX_RECORDS=12), CaptureQueriesContext(connection) as queries:
            self.change_status()
        self.assertEqual(AutomationRun.objects.count(), 2)
        self.assertEqual(ChannelAutomation.objects.filter(active=False, pause_reason='capacity').count(), 3)
        count_queries = [row['sql'] for row in queries if 'COUNT(' in row['sql'].upper() and 'messaging_automation_runs' in row['sql']]
        self.assertLessEqual(len(count_queries), 2, 'quota scans must not grow once per matched rule')

    def test_pause_and_reactivation_do_not_replay_old_pending_runs(self):
        row, _ = self.create('task_status'); row = self.activate(row); self.change_status()
        run = AutomationRun.objects.get()
        paused = self.action(row, False); self.assertEqual(paused.status_code, 200)
        self.activate(paused.data); self.assertEqual(drain()['published'], 0)
        run.refresh_from_db(); self.assertEqual(run.state, 'skipped'); self.assertEqual(run.reason, 'rule_changed')

    def test_one_off_reminder_due_exactly_once_after_delayed_worker_and_lost_reply(self):
        row, values = self.create(); row = self.activate(row)
        self.assertEqual(drain(now=self.start - timedelta(seconds=1))['published'], 0)
        self.assertEqual(drain(now=self.start + timedelta(hours=3))['published'], 1)
        self.assertEqual(drain(now=self.start + timedelta(days=1))['published'], 0)
        self.assertEqual(ChannelMessage.objects.get().body, values['body'])
        rule = ChannelAutomation.objects.get(); self.assertFalse(rule.active); self.assertEqual(rule.pause_reason, 'completed')
        with patch('boldApp.mensajeria.automation_views.timezone.now', return_value=self.start + timedelta(days=2)):
            replay = self.client.post(self.endpoint, values, format='json')
        self.assertEqual(replay.status_code, 200, replay.data); self.assertEqual(replay.data['id'], row['id'])

    def test_recurring_reminder_skips_missed_intervals_without_flood(self):
        row, _ = self.create(interval_days=1); self.activate(row)
        late = self.start + timedelta(days=100, hours=3)
        self.assertEqual(drain(now=late)['published'], 1)
        rule = ChannelAutomation.objects.get(); self.assertEqual(rule.next_at, self.start + timedelta(days=101))
        self.assertEqual(drain(now=late)['published'], 0); self.assertEqual(AutomationRun.objects.count(), 1)

    def test_recurring_page_is_independent_versioned_and_pins_template(self):
        row, _ = self.create('recurring_page'); self.activate(row)
        self.assertEqual(drain(now=self.start)['published'], 1)
        page = ChannelPage.objects.get(); template = PageTemplate.objects.get()
        self.assertEqual(page.title, template.title); self.assertEqual(page.revisions.count(), 1)
        self.assertNotEqual(page.blocks[0]['id'], template.blocks[0]['id'])
        self.assertEqual(drain(now=self.start)['published'], 0)
        template.title = 'No copiar sin revisar'; template.version += 1; template.save()
        self.assertEqual(drain(now=self.start + timedelta(days=7))['published'], 0)
        rule = ChannelAutomation.objects.get(); self.assertFalse(rule.active); self.assertEqual(rule.pause_reason, 'template_changed')
        self.assertEqual(ChannelPage.objects.count(), 1)

    def test_other_employee_and_owner_cannot_inspect_or_modify_own_rules(self):
        row, _ = self.create(); url = self.endpoint + row['id'] + '/'
        for person in (self.bob, self.owner):
            client = self.as_person(person)
            self.assertEqual(client.get(self.endpoint).data['results'], [])
            self.assertEqual(client.get(url).status_code, 404)
            self.assertEqual(client.get(url + 'runs/').status_code, 404)
            self.assertEqual(client.get(url + 'audit/').status_code, 404)
            self.assertEqual(client.patch(url, {'client_id':str(uuid.uuid4()), 'version':1, 'active':False}, format='json').status_code, 404)
        DepartmentChannel.objects.filter(pk=self.channel_id).update(visibility='private')
        self.assertEqual(self.as_person(self.owner).get(url).status_code, 404)

    def test_readonly_channel_permission_does_not_allow_rule_activation(self):
        row, _ = self.create()
        ChannelAccessRule.objects.create(channel_id=self.channel_id, employee=self.alice.employee, access='read')
        self.assertEqual(self.client.get(self.endpoint).status_code, 200)
        self.assertEqual(self.action(row, True).status_code, 403)

    def test_revoke_account_credential_assignment_or_permissions_before_worker(self):
        for mutation in ('credentials', 'account', 'assignment', 'channel', 'permission', 'archive'):
            row, _ = self.create(); self.activate(row)
            with transaction.atomic():
                if mutation == 'credentials':
                    account = self.alice.employee.user_account; account.credentials_version += 1; account.save()
                elif mutation == 'account':
                    account = self.alice.employee.user_account; account.is_active = False; account.save()
                elif mutation == 'assignment':
                    self.alice.is_active = False; self.alice.save()
                elif mutation == 'channel':
                    ChannelAccessRule.objects.create(channel_id=self.channel_id, employee=self.alice.employee, access='blocked')
                elif mutation == 'permission':
                    self.deny('slack.message.create')
                else:
                    DepartmentChannel.objects.filter(pk=self.channel_id).update(archived_at=timezone.now())
                self.assertEqual(drain(now=self.start)['published'], 0, mutation)
                rule = ChannelAutomation.objects.get(pk=row['id']); self.assertFalse(rule.active, mutation)
                transaction.set_rollback(True)
            # Rollback also restored the active rule. Pause it before next case.
            ChannelAutomation.objects.filter(pk=row['id']).update(active=False)
            self.alice.refresh_from_db(); self.alice.employee.user_account.refresh_from_db()
        self.assertFalse(ChannelMessage.objects.exists())

    def test_mfa_cannot_be_persisted_as_permanent_background_authority(self):
        row, _ = self.create(); permission = Permission.objects.get(code='slack.message.create')
        permission.requires_step_up_mfa = True; permission.save()
        result = self.action(row, True); self.assertEqual(result.status_code, 400, result.data)
        self.assertFalse(ChannelAutomation.objects.get().active)

    def test_task_revocation_suppresses_and_redacts_pending_run(self):
        row, _ = self.create('task_status'); self.activate(row); self.change_status()
        JobRolePermission.objects.filter(job_role=self.role, permission__code='tasks.task.read').update(effect='deny')
        self.assertEqual(drain()['published'], 0); self.assertFalse(ChannelMessage.objects.exists())
        history = self.client.get(self.endpoint + row['id'] + '/runs/')
        self.assertEqual(history.data['results'][0]['task'], {'available':False})
        self.assertNotIn(str(self.task.pk), str(history.data)); self.assertNotIn(self.task.title, str(history.data))

    def test_retry_backoff_and_failure_pause_keep_same_occurrence(self):
        row, _ = self.create(); self.activate(row)
        with patch('boldApp.mensajeria.automations.publish_message', side_effect=RuntimeError('fallo sintético')):
            self.assertEqual(drain(now=self.start)['failed'], 1)
            self.assertEqual(drain(now=self.start + timedelta(seconds=30))['failed'], 0)
            self.assertEqual(drain(now=self.start + timedelta(seconds=60))['failed'], 1)
            self.assertEqual(drain(now=self.start + timedelta(seconds=360))['failed'], 1)
        run = AutomationRun.objects.get(); self.assertEqual(run.state, 'failed'); self.assertEqual(run.attempts, 3)
        self.assertFalse(ChannelAutomation.objects.get().active); self.assertFalse(ChannelMessage.objects.exists())

    def test_effect_is_rolled_back_when_receipt_save_fails_then_one_retry(self):
        row, _ = self.create(); self.activate(row)
        original = AutomationRun.save
        def fail_published(instance, *args, **kwargs):
            if instance.state == 'published':
                raise RuntimeError('fallo después de crear el mensaje')
            return original(instance, *args, **kwargs)
        with patch.object(AutomationRun, 'save', fail_published):
            self.assertEqual(drain(now=self.start)['failed'], 1)
        self.assertFalse(ChannelMessage.objects.exists())
        self.assertEqual(drain(now=self.start + timedelta(minutes=1))['published'], 1)
        self.assertEqual(ChannelMessage.objects.count(), 1); self.assertEqual(AutomationRun.objects.count(), 1)

    def test_capacity_limits_fail_closed_without_deleting_effects_or_audit(self):
        row, _ = self.create(); self.activate(row)
        with override_settings(MESSAGING_AUTOMATION_MAX_RECORDS=2):
            self.assertEqual(drain(now=self.start)['published'], 0)
        self.assertEqual(AutomationAudit.objects.count(), 2); self.assertFalse(AutomationRun.objects.exists())
        self.assertEqual(ChannelAutomation.objects.get().pause_reason, 'capacity')
        with override_settings(MESSAGING_AUTOMATION_ACCOUNT_RULES=1):
            response = self.client.post(self.endpoint, {'client_id':str(uuid.uuid4()), 'name':'No', 'kind':'reminder',
                'body':'No', 'next_at':self.start.isoformat(), 'share_confirmed':True}, format='json')
        self.assertEqual(response.status_code, 409)

    def test_full_audit_budget_still_allows_idempotent_manual_stop(self):
        row, _ = self.create(); row = self.activate(row)
        values = {'client_id':str(uuid.uuid4()), 'version':row['version'], 'active':False}
        url = self.endpoint + row['id'] + '/'
        with override_settings(MESSAGING_AUTOMATION_MAX_RECORDS=2):
            result = self.client.patch(url, values, format='json')
            self.assertEqual(result.status_code, 200, result.data)
            self.assertEqual(result.data['pause_reason'], 'manual_capacity')
            replay = self.client.patch(url, values, format='json')
            self.assertEqual(replay.status_code, 200, replay.data)
            self.assertEqual(replay.data['version'], result.data['version'])
        self.assertFalse(ChannelAutomation.objects.get().active); self.assertEqual(AutomationAudit.objects.count(), 2)

    def test_late_failure_cannot_pause_a_successful_recurring_occurrence(self):
        row, _ = self.create(interval_days=1); row = self.activate(row)
        self.assertEqual(execute(row['id'], now=self.start), 'published')
        record_failure(row['id'], None, self.start, version=row['version'], planned=self.start)
        rule = ChannelAutomation.objects.get(); self.assertTrue(rule.active)
        self.assertEqual(rule.next_at, self.start + timedelta(days=1)); self.assertEqual(AutomationRun.objects.count(), 1)

    def test_existing_reservation_can_complete_when_new_record_budget_is_full(self):
        row, _ = self.create(); self.activate(row)
        with patch('boldApp.mensajeria.automations.publish_message', side_effect=RuntimeError('fallo sintético')):
            drain(now=self.start)
        with override_settings(MESSAGING_AUTOMATION_MAX_RECORDS=3):
            self.assertEqual(drain(now=self.start + timedelta(minutes=1))['published'], 1)
        self.assertEqual(ChannelMessage.objects.count(), 1); self.assertEqual(AutomationRun.objects.count(), 1)

    def test_failure_reconciliation_reuses_a_reservation_at_full_capacity(self):
        row, _ = self.create(); row = self.activate(row)
        with patch('boldApp.mensajeria.automations.publish_message', side_effect=RuntimeError('fallo sintético')):
            drain(now=self.start)
        with override_settings(MESSAGING_AUTOMATION_MAX_RECORDS=3):
            record_failure(row['id'], None, self.start, version=row['version'], planned=self.start)
        self.assertTrue(ChannelAutomation.objects.get().active)
        self.assertEqual(AutomationRun.objects.count(), 1); self.assertEqual(AutomationRun.objects.get().attempts, 2)

    def test_disabled_and_pilot_boundaries_apply_before_owner(self):
        row, _ = self.create()
        with override_settings(MESSAGING_AUTOMATIONS_ENABLED=False):
            self.assertEqual(self.client.get(self.endpoint).status_code, 403)
            with self.assertNumQueries(0):
                self.assertFalse(drain()['enabled'])
        with override_settings(MESSAGING_PILOT_ENABLED=True, MESSAGING_PILOT_UNIT_IDS=[str(self.marketing.pk)]):
            self.assertEqual(self.client.get(self.endpoint).status_code, 403)
            self.assertEqual(self.as_person(self.owner).get(self.endpoint + row['id'] + '/').status_code, 404)

    def test_strict_shapes_utc_dates_and_no_delete(self):
        row, values = self.create()
        for replacement in ({'share_confirmed':False}, {'active':True}, {'next_at':'2026-11-01T10:00:00'},
                {'interval_days':0}, {'kind':'webhook'}, {'template_id':str(uuid.uuid4())}):
            result = self.client.post(self.endpoint, {**values, **replacement, 'client_id':str(uuid.uuid4())}, format='json')
            self.assertEqual(result.status_code, 400, result.data)
        self.assertEqual(self.client.delete(self.endpoint + row['id'] + '/').status_code, 405)

    def test_paused_update_conflict_activation_receipt_and_exact_assignment(self):
        row, values = self.create()
        url = self.endpoint + row['id'] + '/'
        action = {'client_id':str(uuid.uuid4()), 'version':1, 'active':True, 'share_confirmed':True}
        first = self.client.patch(url, action, format='json'); self.assertEqual(first.status_code, 200, first.data)
        self.assertEqual(self.client.patch(url, action, format='json').data['version'], 2)
        self.assertEqual(self.client.put(url, {**values, 'client_id':str(uuid.uuid4()), 'version':2}, format='json').status_code, 409)
        paused = self.action(first.data, False).data
        edited = self.client.put(url, {**values, 'name':'Revisada', 'version':paused['version'], 'client_id':str(uuid.uuid4())}, format='json')
        self.assertEqual(edited.status_code, 200, edited.data)
        self.assertEqual(self.action(paused, True).status_code, 409)
        audit = self.client.get(url + 'audit/')
        self.assertEqual(audit.status_code, 200, audit.data)
        self.assertEqual([item['action'] for item in audit.data['results']], ['updated', 'paused', 'activated', 'created'])
        self.assertNotIn(values['body'], str(audit.data))

    def test_project_picker_uses_read_not_management_and_revocation_hides_identifiers(self):
        url = self.url + 'automation-projects/'
        self.assertEqual(self.client.get(url).status_code, 400)
        rows = self.client.get(url + '?q=privado')
        self.assertEqual(rows.status_code, 200, rows.data)
        self.assertEqual([row['id'] for row in rows.data['results']], [str(self.project.pk)])
        detail = self.client.get(url + str(self.project.pk) + '/')
        self.assertEqual(detail.status_code, 200, detail.data)
        self.assertIn(str(self.final.pk), [row['id'] for row in detail.data['statuses']])
        JobRolePermission.objects.filter(job_role=self.role, permission__code='tasks.project.read').update(effect='deny')
        rows = self.client.get(url + '?q=privado')
        self.assertEqual(rows.data['results'], [])
        self.assertEqual(self.client.get(url + str(self.project.pk) + '/').status_code, 404)
        self.assertNotIn(str(self.project.pk), str(rows.data))
