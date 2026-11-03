"""Legacy originals remain intact until Drive confirms a complete copy."""
from datetime import timedelta
from io import StringIO
from unittest.mock import patch

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TransactionTestCase, override_settings
from django.utils import timezone

from . import test_upload_outbox as base
from .management.commands.migrate_messaging_files_to_drive import archive_upload
from .models import DirectMessage, MediaUpload
from .upload_outbox import cipher, expire_pending
from .upload_tasks import drain_media_uploads
from boldApp.workspace.service import Reconnect


@override_settings(MESSAGING_PILOT_ENABLED=False, AUTH_MFA_REQUIRED=False,
    CELERY_TASK_ALWAYS_EAGER=True, AUTH_ENCRYPTION_KEY='synthetic-upload-outbox-tests-only')
class DriveMigrationTests(TransactionTestCase):
    root=base.UploadOutboxTests.root
    identity=base.UploadOutboxTests.identity
    as_person=base.UploadOutboxTests.as_person
    open=base.UploadOutboxTests.open
    setUp=base.UploadOutboxTests.setUp
    queue=base.UploadOutboxTests.queue

    def legacy(self):
        content=b'Documento privado de prueba'
        self.drive.unavailable=True
        response=self.queue()
        self.drive.unavailable=False
        row=MediaUpload.objects.get(pk=response.data['id'])
        row.content=cipher().encrypt(content)
        row.cipher_bytes=len(row.content)
        row.state='queued'
        row.expires_at=timezone.now()-timedelta(days=1)
        row.save()
        current=patch('boldApp.mensajeria.management.commands.migrate_messaging_files_to_drive.storage_user',
            return_value=self.alice.employee.user_account)
        current.start();self.addCleanup(current.stop)
        return row,content

    def test_confirmed_copy_clears_only_bytes_preserving_state_and_access(self):
        row,content=self.legacy()
        expiry=row.expires_at
        self.session.revoked_at=timezone.now();self.session.save(update_fields=['revoked_at'])
        archive_upload(row,content)
        row.refresh_from_db()
        self.assertEqual((row.state,row.expires_at,bytes(row.content),row.cipher_bytes),('queued',expiry,b'',0))
        self.assertIsNone(row.lease_token)
        self.assertEqual(self.drive.files[row.drive_id]['content'],content)
        self.assertEqual(DirectMessage.objects.count(),0)

    def test_failed_copy_and_reconnect_never_clear_original(self):
        row,content=self.legacy()
        original=bytes(row.content);expiry=row.expires_at
        self.drive.unavailable=True
        with self.assertRaises(Exception):archive_upload(row,content)
        row.refresh_from_db()
        self.assertEqual((row.state,row.expires_at,bytes(row.content)),('queued',expiry,original))
        with patch('boldApp.mensajeria.management.commands.migrate_messaging_files_to_drive.storage_user',side_effect=Reconnect()):
            with self.assertRaises(CommandError):call_command('migrate_messaging_files_to_drive',apply=True,stdout=StringIO())
        row.refresh_from_db();self.assertEqual(bytes(row.content),original)

    def test_inventory_and_periodic_worker_preserve_unmigrated_original(self):
        row,_=self.legacy()
        original=bytes(row.content);calls=len(self.drive.calls)
        report=StringIO();call_command('migrate_messaging_files_to_drive',stdout=report)
        self.assertIn('uploads=1',report.getvalue())
        self.assertEqual(expire_pending(),0)
        self.assertEqual(drain_media_uploads()['examined'],0)
        row.refresh_from_db()
        self.assertEqual((bytes(row.content),row.state),(original,'queued'))
        self.assertEqual(len(self.drive.calls),calls)

    def test_corrupted_original_never_reaches_drive(self):
        row,_=self.legacy();calls=len(self.drive.calls)
        with self.assertRaises(ValueError):archive_upload(row,b'wrong content')
        row.refresh_from_db();self.assertTrue(row.content)
        self.assertEqual(len(self.drive.calls),calls)
