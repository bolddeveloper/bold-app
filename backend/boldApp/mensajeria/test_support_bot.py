import json
import subprocess
from io import StringIO
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from django.test import TestCase, SimpleTestCase, override_settings
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.core.management import call_command, CommandError
from django.utils import timezone

from boldApp.autenticacion.models import AuthSession
from boldApp.core.models import JobRolePermission, Permission
from boldApp.tareas.models import Task, TaskStatus, TeamTaskShare
from . import test_channels as base
from .models import ChannelMessage, DepartmentChannel, SupportRequest, ChannelAccessRule
from .support_bot import BOT_ID, configure_identity, drain, mentioned, process, prompt_for
from .support_codex import answer, SupportUnavailable
from .support_identity import BOT_EMAIL, BOT_NAME, BOT_TOKEN, mention_person


USAGE = {'input_tokens': 200, 'cached_input_tokens': 100, 'output_tokens': 35}


@override_settings(MESSAGING_PILOT_ENABLED=False, BOLD_SUPPORT_ENABLED=True,
                   BOLD_SUPPORT_DAILY_LIMIT=100, BOLD_SUPPORT_USER_DAILY_LIMIT=20)
class SupportTests(TestCase):
    root = base.DepartmentChannelTests.root
    identity = base.DepartmentChannelTests.identity
    as_person = base.DepartmentChannelTests.as_person
    deny = base.DepartmentChannelTests.deny
    send = base.DepartmentChannelTests.send

    def setUp(self):
        base.DepartmentChannelTests.setUp(self)
        self.bot = configure_identity(self.it)
        self.model = patch('boldApp.mensajeria.support_bot.answer', return_value=('Abre Mis tareas.', USAGE)).start()
        self.addCleanup(patch.stopall)

    def ask(self, **extra):
        response = self.send('@soporte bold ¿Cómo reviso mis tareas?', **extra)
        self.assertEqual(response.status_code, 201, response.data)
        return ChannelMessage.objects.get(pk=response.data['message']['id'])

    def test_explicit_mention_queues_once_and_reply_has_its_own_identity(self):
        source = self.ask()
        self.model.assert_not_called()
        request = SupportRequest.objects.get(source=source)
        retry = self.client.post(self.url+'messages/', {'client_id':str(source.client_id), 'body':source.body}, format='json')
        self.assertEqual(retry.status_code, 200)
        self.assertEqual(SupportRequest.objects.count(), 1)
        self.assertEqual(drain(), 1)
        self.assertEqual(drain(), 0)
        self.model.assert_called_once()
        request.refresh_from_db()
        self.assertEqual(request.state, 'completed')
        self.assertEqual(request.input_tokens, 200)
        self.assertEqual(request.output_tokens, 35)
        reply = request.reply
        self.assertIsNone(reply.parent_id)
        source.refresh_from_db()
        self.assertIsNone(source.thread_started_at)
        self.assertEqual(source.replies.count(), 0)
        self.assertEqual(reply.author_assignment_id, BOT_ID)
        self.assertEqual(reply.automation_kind, 'support')
        self.assertNotEqual(reply.author_id, source.author_id)
        self.assertFalse(self.bot.is_active)
        self.assertFalse(self.bot.employee.is_active)
        account = self.bot.employee.user_account
        self.assertEqual(account.email, BOT_EMAIL)
        self.assertFalse(account.is_active)
        self.assertFalse(account.has_usable_password())
        self.assertFalse(account.is_staff or account.is_superuser)
        result = self.client.get(self.url+'messages/')
        self.assertEqual(result.status_code, 200, result.data)
        result = next(row for row in result.data['results'] if row['id'] == str(reply.pk))
        self.assertEqual(result['author']['name'], BOT_NAME)
        self.assertTrue(result['author']['is_bot'])
        self.assertFalse(result['can_edit'])

    def test_mention_in_an_existing_thread_replies_only_inside_that_thread(self):
        root = self.send('Conversación ya abierta', thread_title='Ayuda del equipo').data['message']
        source = self.ask(parent_id=root['id'])
        started_at = ChannelMessage.objects.get(pk=root['id']).thread_started_at
        self.assertEqual(drain(), 1)
        reply = SupportRequest.objects.get(source=source).reply
        self.assertEqual(str(reply.parent_id), root['id'])
        history = self.client.get(self.url+'messages/').data['results']
        self.assertNotIn(str(reply.pk), [row['id'] for row in history])
        thread = self.client.get(self.url+'messages/', {'parent':root['id']}).data['results']
        self.assertIn(str(reply.pk), [row['id'] for row in thread])
        self.assertEqual(ChannelMessage.objects.get(pk=root['id']).thread_started_at, started_at)

    def test_bot_is_found_by_name_and_alias_without_enabling_its_login(self):
        account_id = self.bot.employee.user_account.pk
        self.bot.employee.full_name = 'Soporte BOLD'
        self.bot.employee.save(update_fields=['full_name'])
        upgraded = configure_identity(self.it)
        self.assertEqual(upgraded.employee.user_account.pk, account_id)
        self.assertEqual(upgraded.employee.full_name, BOT_NAME)
        for term in ('', 'sop', 'soportebold', 'soporte b', 'Soporte BOLD'):
            response = self.client.get(self.url+'mention-people/', {'q':term})
            self.assertEqual(response.status_code, 200, response.data)
            bot = response.data['results'][0]
            self.assertEqual(bot['name'], BOT_NAME)
            self.assertEqual(bot['email'], BOT_EMAIL)
            self.assertEqual(bot['token'], BOT_TOKEN)
            self.assertTrue(bot['is_bot'])
        from .channel_access import ChannelPolicy
        self.assertFalse(ChannelPolicy(self.bot).allows('slack.channel.read', self.it, self.channel_id))

    def test_selected_bot_mention_is_verified_in_history_and_triggers_one_reply(self):
        response = self.send(BOT_TOKEN+' ¿Cómo reviso mis tareas?')
        self.assertEqual(response.status_code, 201, response.data)
        source = response.data['message']
        self.assertEqual(source['mentions'][0]['name'], BOT_NAME)
        self.assertEqual(source['mentions'][0]['token'], BOT_TOKEN)
        self.assertTrue(source['mentions'][0]['is_bot'])
        self.assertEqual(drain(), 1)
        self.model.assert_called_once()
        history = self.client.get(self.url+'messages/').data['results']
        saved = next(row for row in history if row['id']==source['id'])
        self.assertEqual(saved['mentions'], source['mentions'])

    def test_bot_suggestion_does_not_bypass_channel_access_or_disabled_support(self):
        with override_settings(BOLD_SUPPORT_ENABLED=False):
            response = self.client.get(self.url+'mention-people/', {'q':'soporte'})
            self.assertEqual(response.data['results'], [])
        self.deny('slack.message.create')
        response = self.client.get(self.url+'mention-people/', {'q':'soporte'})
        self.assertEqual(response.data['results'], [])
        DepartmentChannel.objects.filter(pk=self.channel_id).update(visibility='private')
        self.assertEqual(self.client.get(self.url+'mention-people/', {'q':'soporte'}).status_code, 404)

    def test_service_account_cannot_be_advertised_or_used_if_activated(self):
        self.ask()
        account = self.bot.employee.user_account
        account.is_active = True
        account.save(update_fields=['is_active'])
        self.assertIsNone(mention_person())
        self.assertEqual(drain(), 0)
        self.model.assert_not_called()
        with self.assertRaises(ValueError):
            configure_identity(self.it)

    def test_plain_message_and_disabled_support_do_not_consume(self):
        self.assertEqual(self.send('Hola equipo').status_code, 201)
        with override_settings(BOLD_SUPPORT_ENABLED=False):
            self.ask()
        self.assertFalse(SupportRequest.objects.exists())
        self.assertEqual(drain(), 0)
        self.model.assert_not_called()

    def test_denied_send_cannot_queue_a_request(self):
        self.deny('slack.message.create')
        self.assertEqual(self.send('@soporte bold ayuda').status_code, 403)
        self.assertFalse(SupportRequest.objects.exists())

    def test_revoked_permission_cancels_before_inference(self):
        self.ask()
        self.deny('slack.message.create')
        self.assertEqual(drain(), 0)
        self.model.assert_not_called()
        self.assertEqual(SupportRequest.objects.get().state, 'skipped')

    def test_private_invitation_removal_cancels_before_inference(self):
        DepartmentChannel.objects.filter(pk=self.channel_id).update(visibility='private')
        invitation = ChannelAccessRule.objects.create(channel_id=self.channel_id, employee=self.alice.employee, access='write')
        self.ask()
        invitation.delete()
        self.assertEqual(drain(), 0)
        self.model.assert_not_called()

    def test_changed_question_closed_thread_and_archived_channel_cancel(self):
        for field, value in [('body','Otra pregunta'), ('thread_locked',True), ('thread_closed_at',timezone.now())]:
            root = self.send('Tema del equipo').data['message']
            source = self.ask(parent_id=root['id'])
            changes = {field:value}
            if field == 'body':
                changes['version'] = 2
            ChannelMessage.objects.filter(pk=source.pk if field == 'body' else root['id']).update(**changes)
            self.assertEqual(drain(), 0)
        self.ask()
        DepartmentChannel.objects.filter(pk=self.channel_id).update(archived_at=timezone.now())
        self.assertEqual(drain(), 0)
        self.model.assert_not_called()

    def test_deleted_channel_cancels_before_or_during_inference(self):
        source = self.ask()
        channel = DepartmentChannel.objects.get(pk=self.channel_id)
        channel.deleted_at = timezone.now()
        channel.save(update_fields=['deleted_at'])
        self.assertEqual(drain(), 0)
        self.model.assert_not_called()
        self.assertEqual(SupportRequest.objects.get(source=source).state, 'skipped')
        channel.deleted_at = None
        channel.save(update_fields=['deleted_at'])
        source = self.ask()
        def remove_during_generation(_):
            DepartmentChannel.objects.filter(pk=self.channel_id).update(deleted_at=timezone.now())
            return 'No publicar.', USAGE
        self.model.side_effect = remove_during_generation
        self.assertEqual(drain(), 0)
        request = SupportRequest.objects.get(source=source)
        self.assertEqual(request.state, 'skipped')
        self.assertIsNone(request.reply_id)

    def test_permission_revoked_during_inference_does_not_publish(self):
        self.ask()
        def reply(_):
            self.deny('slack.message.create')
            return 'No debe publicarse.', USAGE
        self.model.side_effect = reply
        self.assertEqual(drain(), 0)
        request = SupportRequest.objects.get()
        self.assertEqual(request.state, 'skipped')
        self.assertEqual(request.input_tokens, 200)
        self.assertIsNone(request.reply_id)

    def test_daily_limits_do_not_make_model_calls_and_failed_attempts_stay_counted(self):
        with override_settings(BOLD_SUPPORT_DAILY_LIMIT=1):
            self.model.side_effect = SupportUnavailable('codex_failed')
            self.ask()
            self.assertEqual(drain(), 0)
            self.ask()
            self.assertEqual(drain(), 0)
        self.assertEqual(self.model.call_count, 1)
        self.assertEqual(SupportRequest.objects.filter(admitted=True).count(), 1)
        self.assertEqual(SupportRequest.objects.filter(reason='daily_limit').count(), 1)
        self.assertEqual(drain(), 0)
        self.assertEqual(self.model.call_count, 1)

    def test_per_person_daily_limit_leaves_another_person_available(self):
        with override_settings(BOLD_SUPPORT_USER_DAILY_LIMIT=1):
            self.ask()
            self.ask()
            self.client = self.as_person(self.bob)
            self.ask()
            self.assertEqual(drain(), 2)
        self.assertEqual(self.model.call_count, 2)
        self.assertEqual(SupportRequest.objects.filter(reason='user_daily_limit').count(), 1)

    def test_session_revocation_is_checked_before_inference(self):
        source = self.ask()
        session = AuthSession.objects.create(user_account=self.alice.employee.user_account,
            token_hash='f'*64, credentials_version=1, expires_at=timezone.now(), revoked_at=timezone.now())
        SupportRequest.objects.filter(source=source).update(session=session)
        self.assertEqual(drain(), 0)
        self.model.assert_not_called()

    def test_context_reads_current_channel_and_thread_but_not_other_channels_or_future_messages(self):
        other = DepartmentChannel.objects.create(unit=self.it, name='Reservado', creator=self.alice, visibility='private')
        ChannelMessage.objects.create(channel=other, author=self.alice.employee, author_assignment=self.alice,
            client_id=uuid4(), sequence=1, body='NO INCLUIR: otro canal')
        deleted = self.send('NO INCLUIR: hilo eliminado').data['message']['id']
        ChannelMessage.objects.filter(pk=deleted).update(thread_deleted_at=timezone.now())
        self.send('La reunión del equipo será a las diez.')
        root = self.ask()
        self.assertEqual(drain(), 1)
        following = self.ask(parent_id=str(root.pk))
        self.send('NO INCLUIR: posterior a la pregunta')
        prompt = prompt_for(following)
        self.assertNotIn('NO INCLUIR', prompt)
        self.assertIn('La reunión del equipo será a las diez.', prompt)
        self.assertIn('Abre Mis tareas.', prompt)
        self.assertLessEqual(len(prompt), 24000)

    def published_task(self, title='Trabajo publicado'):
        JobRolePermission.objects.get_or_create(job_role=self.role,
            permission=Permission.objects.get(code='tasks.task.read'), scope_type='global', effect='allow')
        status = TaskStatus.objects.create(unit=self.it, name='Pendiente', category='pending', position=0)
        task = Task.objects.create(unit=self.it, status=status, title=title, priority='medium',
            created_by_assignment=self.alice, assignee_assignment=self.alice)
        share = TeamTaskShare.objects.create(employee=self.alice.employee, task=task, source_assignment=self.alice)
        return task, share

    def test_team_context_contains_only_opt_in_publications_and_does_not_write(self):
        task, share = self.published_task()
        private = Task.objects.create(unit=self.it, status=task.status, title='SECRETO sin compartir', priority='medium',
            created_by_assignment=self.alice, assignee_assignment=self.alice)
        card = self.send('Referencia de tarea').data['message']['id']
        ChannelMessage.objects.filter(pk=card).update(task_id=private.pk)
        message = self.ask()
        with CaptureQueriesContext(connection) as queries:
            data = json.loads(prompt_for(message))
        self.assertEqual([row['title'] for row in data['shared_tasks']], ['Trabajo publicado'])
        self.assertNotIn('SECRETO', json.dumps(data))
        self.assertIn({'name':'alice', 'department':'IT'}, data['people'])
        self.assertNotIn('soportebold', json.dumps(data['people']))
        self.assertFalse(any(row['sql'].lstrip().split()[0].upper() in ('INSERT','UPDATE','DELETE') for row in queries))
        share.delete()
        self.assertEqual(json.loads(prompt_for(message))['shared_tasks'], [])

    def test_publication_requires_current_publisher_access_and_participation(self):
        task, share = self.published_task()
        message = self.ask()
        JobRolePermission.objects.filter(job_role=self.role, permission__code='tasks.task.read').update(effect='deny')
        self.assertEqual(json.loads(prompt_for(message))['shared_tasks'], [])
        JobRolePermission.objects.filter(effect='deny').delete()
        share.source_assignment = self.bob
        share.save(update_fields=['source_assignment'])
        self.assertEqual(json.loads(prompt_for(message))['shared_tasks'], [])

    def test_unsharing_during_inference_does_not_publish_generated_data(self):
        task, share = self.published_task()
        self.ask()
        def reply(prompt):
            self.assertIn(task.title, prompt)
            share.delete()
            return 'No debe publicarse: '+task.title, USAGE
        self.model.side_effect = reply
        self.assertEqual(drain(), 0)
        request = SupportRequest.objects.get()
        self.assertEqual(request.reason, 'context_changed')
        self.assertIsNone(request.reply_id)
        self.assertEqual(request.input_tokens, USAGE['input_tokens'])

    def test_context_limits_long_histories_without_claiming_a_complete_list(self):
        for index in range(19):
            self.send(f'Mensaje {index} '+('x'*4500))
        data = json.loads(prompt_for(self.ask()))
        self.assertEqual(len(data['channel_history']), 16)
        self.assertTrue(data['partial']['channel_history'])
        self.assertTrue(all(row['truncated'] for row in data['channel_history']))
        self.assertLessEqual(len(json.dumps(data, ensure_ascii=False)), 24000)

    def test_combined_context_is_trimmed_to_the_total_budget(self):
        from unittest.mock import MagicMock
        people = [SimpleNamespace(employee=SimpleNamespace(full_name='Persona '+('n'*120)),
            position=SimpleNamespace(unit=SimpleNamespace(name='Departamento '+('d'*120)))) for _ in range(81)]
        directory = MagicMock()
        directory.order_by.return_value.__getitem__.return_value = people
        for index in range(16):
            self.send(str(index)+('x'*4500))
        message = self.ask()
        with patch('boldApp.mensajeria.support_context.active_assignments', return_value=directory), \
                patch('boldApp.mensajeria.support_context.shared_tasks', return_value=([],False)):
            prompt = prompt_for(message)
        self.assertLessEqual(len(prompt), 24000)
        self.assertTrue(json.loads(prompt)['partial']['people'])

    def test_processing_receipt_is_not_automatically_retried(self):
        self.ask()
        request = SupportRequest.objects.get()
        request.state = 'processing'
        from datetime import timedelta
        request.started_at = timezone.now()-timedelta(minutes=5)
        request.save()
        self.assertEqual(drain(), 0)
        request.refresh_from_db()
        self.assertEqual(request.state, 'failed')
        self.assertEqual(request.reason, 'interrupted')
        self.assertFalse(process(request.pk))
        self.model.assert_not_called()

    @override_settings(DEBUG=True)
    @patch('boldApp.mensajeria.management.commands.run_support_bot.shutil.which', return_value='codex')
    @patch('boldApp.mensajeria.management.commands.run_support_bot.subprocess.run')
    def test_worker_preflight_checks_login_without_consumption_or_business_writes(self, run, which):
        run.return_value = SimpleNamespace(returncode=0, stdout='Logged in using ChatGPT', stderr='')
        with CaptureQueriesContext(connection) as queries:
            call_command('run_support_bot', unit=str(self.it.pk), check=True, stdout=StringIO())
        self.model.assert_not_called()
        self.assertFalse(any(row['sql'].lstrip().split()[0].upper() in ('INSERT','UPDATE','DELETE') for row in queries))
        run.return_value.stdout = 'Logged in using an API key'
        with self.assertRaises(CommandError):
            call_command('run_support_bot', unit=str(self.it.pk), check=True, stdout=StringIO())

    @override_settings(DEBUG=False, CHANNEL_LAYERS={'default':{'BACKEND':'channels.layers.InMemoryChannelLayer'}})
    def test_production_worker_refuses_unshared_event_delivery(self):
        with self.assertRaisesRegex(CommandError, 'REDIS_URL'):
            call_command('run_support_bot', unit=str(self.it.pk), check=True, stdout=StringIO())
        self.model.assert_not_called()

    @override_settings(DEBUG=True)
    @patch('boldApp.mensajeria.management.commands.run_support_bot.close_old_connections')
    @patch('boldApp.mensajeria.management.commands.run_support_bot.shutil.which', return_value='codex')
    @patch('boldApp.mensajeria.management.commands.run_support_bot.subprocess.run')
    def test_worker_finishes_current_pass_and_stops_admitting_work_on_sigterm(self, run, which, close):
        import signal
        run.return_value = SimpleNamespace(returncode=0, stdout='Logged in using ChatGPT', stderr='')
        def finish(**kwargs):
            signal.getsignal(signal.SIGTERM)(signal.SIGTERM, None)
            return 0
        previous = signal.getsignal(signal.SIGTERM)
        with patch('boldApp.mensajeria.management.commands.run_support_bot.drain', side_effect=finish) as drain:
            call_command('run_support_bot', unit=str(self.it.pk), stdout=StringIO())
        drain.assert_called_once_with(limit=1)
        self.assertIs(signal.getsignal(signal.SIGTERM), previous)


class CodexSupportTests(SimpleTestCase):
    def test_model_process_does_not_inherit_server_credentials_or_api_billing_keys(self):
        from .support_codex import process_environment
        with patch.dict('os.environ', {'PATH':'/usr/bin','CODEX_HOME':'/private/support',
                'DATABASE_URL':'private','SECRET_KEY':'private','AUTH_ENCRYPTION_KEY':'private',
                'GOOGLE_WORKSPACE_CLIENT_SECRET':'private','OPENAI_API_KEY':'private','CODEX_API_KEY':'private'}, clear=True):
            self.assertEqual(process_environment(), {'PATH':'/usr/bin','CODEX_HOME':'/private/support'})

    def test_only_explicit_mentions_outside_literals_match(self):
        for text in ['@soporte bold ayuda', 'Hola, @SOPORTE BOLD: ayuda',
                     '@soportebold ayuda', '@SoporteBold@Bold.gt. ayuda']:
            self.assertTrue(mentioned(text), text)
        for text in ['soporte bold', '@soporte boldness', 'correo@soporte bold',
                     '`@soporte bold`', '```@soporte bold```', 'https://example.com/@soporte bold',
                     '@soporteboldness', '@soportebold@otra.gt', '@soportebold@bold.gt.evil',
                     '`@soportebold@bold.gt`', 'https://example.com/@soportebold@bold.gt']:
            self.assertFalse(mentioned(text), text)

    @patch('boldApp.mensajeria.support_codex.subprocess.run')
    @patch('boldApp.mensajeria.support_codex.shutil.which', return_value='codex.exe')
    def test_codex_is_chatgpt_only_without_personal_tools_or_shell(self, which, run):
        run.return_value = SimpleNamespace(returncode=0, stdout='\n'.join([
            json.dumps({'type':'item.completed','item':{'type':'agent_message','text':json.dumps({'answer':'Hola.'})}}),
            json.dumps({'type':'turn.completed','usage':USAGE})]), stderr='')
        body, usage = answer('Texto; $(no ejecutar)')
        self.assertEqual(body, 'Hola.')
        self.assertEqual(usage, USAGE)
        args, kwargs = run.call_args
        command = args[0]
        self.assertIn('--ignore-user-config', command)
        self.assertIn('--ephemeral', command)
        self.assertIn('forced_login_method="chatgpt"', command)
        self.assertIn('features.shell_tool=false', command)
        self.assertIn('features.apps=false', command)
        self.assertIn('features.multi_agent=false', command)
        self.assertIn('features.view_image=false', command)
        self.assertFalse(any(option.startswith('mcp_servers.') for option in command))
        self.assertIn('read-only', command)
        self.assertNotIn('shell', kwargs)
        self.assertEqual(kwargs['input'], 'Texto; $(no ejecutar)')
        self.assertNotIn('Texto;', ' '.join(command))

    @patch('boldApp.mensajeria.support_codex.subprocess.run')
    @patch('boldApp.mensajeria.support_codex.shutil.which', return_value='codex.exe')
    def test_missing_or_failed_generation_does_not_publish_diagnostics(self, which, run):
        run.return_value = SimpleNamespace(returncode=1, stdout='', stderr='private context or credentials')
        with self.assertRaisesRegex(SupportUnavailable, '^codex_failed$'):
            answer('Pregunta')
        run.return_value = SimpleNamespace(returncode=0, stdout='{}', stderr='')
        with self.assertRaisesRegex(SupportUnavailable, '^codex_invalid_result$'):
            answer('Pregunta')
        run.return_value = SimpleNamespace(returncode=0,
            stdout=json.dumps({'type':'item.completed','item':{'type':'command_execution'}}), stderr='')
        with self.assertRaisesRegex(SupportUnavailable, '^codex_invalid_result$'):
            answer('Pregunta')
        run.return_value = SimpleNamespace(returncode=0,
            stdout=json.dumps({'type':'item.completed','item':{'type':'mcp_tool_call','server':'externo','tool':'read'}}), stderr='')
        with self.assertRaisesRegex(SupportUnavailable, '^codex_invalid_result$'):
            answer('Pregunta')
        run.side_effect = subprocess.TimeoutExpired('codex',90)
        with self.assertRaisesRegex(SupportUnavailable, '^codex_timeout_or_start$'):
            answer('Pregunta')

    def test_local_listener_starts_once_and_only_in_development(self):
        import asyncio
        from asgiref.sync import async_to_sync
        from unittest.mock import AsyncMock
        from .support_asgi import LocalSupportHTTP

        async def check():
            app = AsyncMock()
            listener = LocalSupportHTTP(app)
            listener.run = AsyncMock()
            with override_settings(DEBUG=False, BOLD_SUPPORT_ENABLED=True):
                await listener({}, None, None)
                self.assertIsNone(listener.task)
            with override_settings(DEBUG=True, BOLD_SUPPORT_ENABLED=False):
                await listener({}, None, None)
                self.assertIsNone(listener.task)
            with override_settings(DEBUG=True, BOLD_SUPPORT_ENABLED=True):
                await listener({}, None, None)
                first = listener.task
                await listener({}, None, None)
                self.assertIs(listener.task, first)
                await first
            listener.run.assert_awaited_once()
            self.assertEqual(app.await_count, 4)
        async_to_sync(check)()
