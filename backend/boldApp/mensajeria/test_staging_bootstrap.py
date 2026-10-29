import json
import tempfile
import shutil
from pathlib import Path
from unittest import skipUnless
from unittest.mock import patch
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import SimpleTestCase
from .management.commands.bootstrap_messaging_staging import checked_client,checked_profile,CLIENT,PROJECT,CALLBACK
from .management.commands.prepare_staging_drive_consent import checked_authorization_url
from .management.commands.verify_staged_messaging_drive import synthetic_samples,save_json
from .media import prepare


class StagingBootstrapTests(SimpleTestCase):
    def test_regular_profile_is_rejected_before_database_or_google_access(self):
        with self.assertRaises(CommandError):
            checked_profile()

    def test_automation_fixture_and_watch_worker_refuse_regular_profile(self):
        with self.assertRaises(CommandError):call_command('prepare_staging_automations')
        with self.assertRaises(CommandError):call_command('verify_staging_automation_ui')
        with patch('boldApp.mensajeria.management.commands.run_channel_automations.drain',side_effect=AssertionError('must not execute')):
            with self.assertRaises(CommandError):call_command('run_channel_automations','--watch')
            with self.assertRaises(CommandError):call_command('run_channel_automations','--watch','--interval','1')

    def test_live_acceptance_refuses_the_ordinary_profile_before_provider_access(self):
        with patch('boldApp.workspace.service.google',side_effect=AssertionError('must not contact Google')):
            with self.assertRaises(CommandError):call_command('verify_staged_messaging_drive','--run')
            with self.assertRaises(CommandError):call_command('verify_staged_messaging_drive','--verify-existing')

    def test_interactive_worker_refuses_non_staging_before_any_batch(self):
        with patch('boldApp.mensajeria.management.commands.drain_media_uploads.drain_media_uploads.run',
                side_effect=AssertionError('must not run a batch')):
            with self.assertRaises(CommandError):call_command('drain_media_uploads','--watch')
            with self.assertRaises(CommandError):call_command('drain_media_uploads','--watch','--interval','1')

    @skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'),'Synthetic audio acceptance requires installed FFmpeg tools')
    def test_acceptance_samples_are_small_valid_containers_for_every_supported_format(self):
        samples=synthetic_samples()
        self.assertEqual({row[0] for row in samples},{'image','webm','ogg','m4a','pdf','txt','csv','docx','xlsx','pptx'})
        for label,name,mime,content in samples:
            result=prepare(SimpleUploadedFile(name,content,content_type=mime))
            self.assertLess(result['size_bytes'],100000)
            self.assertEqual(result['kind'],'image' if label=='image' else 'audio' if label in ('webm','ogg','m4a') else 'document')

    def test_journal_replacement_retains_only_complete_json(self):
        with tempfile.TemporaryDirectory() as root:
            target=Path(root)/'journal.json'
            save_json(target,{'nonce':'synthetic','content':'same bytes'})
            save_json(target,{'nonce':'synthetic','content':'same bytes','ready':True})
            self.assertEqual(json.loads(target.read_text(encoding='utf-8')),{'nonce':'synthetic','content':'same bytes','ready':True})
            self.assertEqual([path.name for path in Path(root).iterdir()],['journal.json'])

    def test_client_must_be_the_approved_independent_project_and_callback(self):
        web={'project_id':PROJECT,'client_id':CLIENT,'redirect_uris':[CALLBACK],'client_secret':'synthetic-test-only'}
        with tempfile.TemporaryDirectory() as root:
            path=Path(root)/'test-client.json'
            path.write_text(json.dumps({'web':web}),encoding='utf-8')
            self.assertEqual(checked_client(path),web)
            for key,value in (('project_id','production'),('client_id','another-client'),
                    ('redirect_uris',['https://production.invalid/callback/']),('client_secret','')):
                path.write_text(json.dumps({'web':{**web,key:value}}),encoding='utf-8')
                with self.assertRaises(CommandError) as error:
                    checked_client(path)
                self.assertNotIn('synthetic-test-only',str(error.exception))

    def test_malformed_oversized_missing_client_never_reveals_raw_file(self):
        with tempfile.TemporaryDirectory() as root:
            path=Path(root)/'test-client.json'
            for value in ('not-json',json.dumps([]),'x'*65537):
                path.write_text(value,encoding='utf-8')
                with self.assertRaises(CommandError):
                    checked_client(path)
            with self.assertRaises(CommandError):
                checked_client(Path(root)/'missing.json')

    def test_handoff_rejects_other_clients_scopes_accounts_or_remote_callbacks(self):
        from urllib.parse import urlencode
        fields={'client_id':CLIENT,'redirect_uri':CALLBACK,'scope':'openid email https://www.googleapis.com/auth/drive',
            'include_granted_scopes':'false','access_type':'offline','response_type':'code',
            'login_hint':'samuel@bold.gt','hd':'bold.gt','state':'synthetic-private-state'}
        def link(data):return 'https://accounts.google.com/o/oauth2/v2/auth?'+urlencode(data)
        self.assertEqual(checked_authorization_url(link(fields)),link(fields))
        for key,value in (('client_id','production'),('scope',fields['scope']+' gmail'),
                ('redirect_uri','https://production.invalid/callback/'),('include_granted_scopes','true'),
                ('login_hint','another@example.invalid'),('state','')):
            with self.assertRaises(CommandError) as error:
                checked_authorization_url(link({**fields,key:value}))
            self.assertNotIn('synthetic-private-state',str(error.exception))
        with self.assertRaises(CommandError):
            checked_authorization_url(link(fields).replace('accounts.google.com','accounts.google.com.invalid'))
