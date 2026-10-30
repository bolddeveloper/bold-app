"""Opt-in isolated PostgreSQL/Redis/Celery acceptance. Never production settings.

Run only in a disposable Docker network whose DB/cache host names start with
bold-validation-. Uses fictitious users and a Redis-backed Drive protocol double;
does not contact Google or certify hardware capture. prepare -> worker -> verify.
"""
import asyncio
import base64
from contextlib import ExitStack
from datetime import timedelta
import json
import os
from pathlib import Path
import sys
import time
from unittest.mock import patch
from urllib.parse import urlsplit
import uuid


def configure():
    database = os.environ.get('BOLD_TEST_DATABASE_URL', '')
    redis = os.environ.get('BOLD_TEST_REDIS_URL', '')
    db, cache = urlsplit(database), urlsplit(redis)
    if (db.scheme not in {'postgres', 'postgresql'} or db.path != '/bold_validation'
            or not (db.hostname or '').startswith('bold-validation-')
            or cache.scheme != 'redis' or not (cache.hostname or '').startswith('bold-validation-')
            or cache.path != '/0'):
        raise RuntimeError('Only disposable bold-validation-* PostgreSQL/Redis hosts are allowed')
    # Override before importing settings: never read the production environment.
    os.environ.update(DATABASE_URL=database, REDIS_URL=redis, DJANGO_DEBUG='true',
        DJANGO_SETTINGS_MODULE='config.settings', SECRET_KEY='synthetic-distributed-acceptance-only',
        AUTH_ENCRYPTION_KEY='synthetic-distributed-acceptance-only',
        CELERY_TASK_ALWAYS_EAGER='false', AUTH_MFA_REQUIRED='false',
        SEED_DEMO_ACCOUNTS='false', SEED_PRIVILEGED_DEMO_ACCOUNTS='false',
        MESSAGING_AUTOMATIONS_ENABLED='true', MESSAGING_PILOT_ENABLED='true',
        MESSAGING_PILOT_UNIT_IDS='11111111-2222-4333-8444-555555555551,11111111-2222-4333-8444-555555555552',
        GOOGLE_WORKSPACE_CLIENT_ID='', GOOGLE_WORKSPACE_CLIENT_SECRET='',
        GOOGLE_CALENDAR_CLIENT_ID='', GOOGLE_CALENDAR_CLIENT_SECRET='',
        EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend',
        ALLOWED_HOSTS='testserver,localhost,127.0.0.1')
    source = Path('/app') if Path('/app/manage.py').is_file() else Path(__file__).resolve().parents[1] / 'backend'
    sys.path.insert(0, str(source))
    import django
    django.setup()


def provider_double(stack):
    import redis
    from django.conf import settings
    from boldApp.mensajeria.channel_validation import LocalDrive
    cache = redis.Redis.from_url(settings.CELERY_BROKER_URL)

    def google(user, method, path, **options):
        drive = LocalDrive()
        snapshot = json.loads(cache.get('bold-validation-drive') or b'{}')
        drive.files = {key: {**row, 'content': base64.b64decode(row['content'])} for key, row in snapshot.items()}
        result = drive.google(user, method, path, **options)
        cache.set('bold-validation-drive', json.dumps({key: {**row, 'content': base64.b64encode(row['content']).decode()}
            for key, row in drive.files.items()}))
        return result

    def storage_user(root):
        if root.subject != 'channel-validation' or root.folder_id != 'validation_root':
            raise RuntimeError('Refusing a non-synthetic storage root')
        return root.user

    for target in ('boldApp.mensajeria.upload_provider.google', 'boldApp.mensajeria.upload_cleanup.google', 'boldApp.workspace.service.google'):
        stack.enter_context(patch(target, side_effect=google))
    for target in ('boldApp.mensajeria.upload_provider.storage_user', 'boldApp.mensajeria.upload_cleanup.storage_user', 'boldApp.workspace.image_storage.storage_user'):
        stack.enter_context(patch(target, side_effect=storage_user))


def wait_for(predicate, seconds=95):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(1)
    raise RuntimeError('Isolated distributed acceptance timed out')


def verify():
    from asgiref.sync import async_to_sync
    from channels.layers import get_channel_layer
    from django.conf import settings
    from django.core.files.uploadedfile import SimpleUploadedFile
    from django.utils import timezone
    from rest_framework.test import APIClient
    from boldApp.autenticacion.models import AuthSession
    from boldApp.core.models import UserAccount, PositionAssignment, OrganizationalUnit, Employee, Position, JobRole
    from boldApp.mensajeria.models import DepartmentChannel, ChannelAutomation, AutomationRun, ChannelMessage, MediaUpload, DirectMessage
    from boldApp.mensajeria.upload_tasks import drain_media_uploads
    from boldApp.mensajeria.automation_tasks import run_channel_automations
    import secrets

    assert settings.CELERY_TASK_ALWAYS_EAGER is False
    assert get_channel_layer().__class__.__name__ == 'RedisChannelLayer'
    people = []
    for label in ('alfa', 'beta'):
        user = UserAccount.objects.get(email=f'canal.validacion.{label}@bold.gt')
        assignment = PositionAssignment.objects.select_related('position__unit').get(employee=user.employee)
        session = AuthSession.objects.create(user_account=user, token_hash=secrets.token_hex(32),
            credentials_version=user.credentials_version, expires_at=timezone.now() + timedelta(hours=1))
        client = APIClient(); client.force_authenticate(user, token=session)
        client.credentials(HTTP_X_ASSIGNMENT_ID=str(assignment.pk))
        people.append((user, assignment, client))
    alfa, beta = people[0][2], people[1][2]
    conversation = alfa.post('/api/v2/messaging/conversations/', {'employee_id': str(people[1][1].employee_id)}, format='json')
    assert conversation.status_code in (200, 201), conversation.status_code
    url = '/api/v2/messaging/conversations/' + conversation.data['id'] + '/'

    # Subscribe in this process; receive the worker's publication through Redis.
    layer = get_channel_layer()
    inbox = async_to_sync(layer.new_channel)('rollout.')
    group = f'messaging_employee_{people[0][1].employee_id}'
    async_to_sync(layer.group_add)(group, inbox)
    content = b'Distributed synthetic upload, not a Google file'
    upload_id = str(uuid.uuid4())
    queued = alfa.post(url + 'uploads/', {'client_id': upload_id,
        'file': SimpleUploadedFile('runtime.txt', content, content_type='text/plain')}, format='multipart')
    assert queued.status_code == 202, (queued.status_code, str(queued.data))
    identity = queued.data['id']
    wait_for(lambda: MediaUpload.objects.filter(pk=identity, state='ready').exists())
    row = MediaUpload.objects.get(pk=identity)
    assert not bytes(row.content) and row.attempts == 1
    async def receive_worker_hint():
        for _ in range(8):
            event = await asyncio.wait_for(layer.receive(inbox), timeout=12)
            if event.get('upload_id') == str(row.pk) or event.get('type') == 'messaging.upload.changed':
                return event
        raise AssertionError('Missing cross-process upload hint')
    hint = async_to_sync(receive_worker_hint)()
    sent = alfa.post(url + 'messages/', {'client_id': upload_id, 'upload_id': str(row.pk), 'body': ''}, format='json')
    assert sent.status_code == 201, (sent.status_code, str(sent.data))
    again = alfa.post(url + 'messages/', {'client_id': upload_id, 'upload_id': str(row.pk), 'body': ''}, format='json')
    assert again.status_code == 200
    message = sent.data['message']['id']
    downloaded = beta.get(url + 'messages/' + message + '/media/')
    assert downloaded.status_code == 200 and downloaded.content == content
    assert DirectMessage.objects.filter(pk=message).count() == 1
    drain_media_uploads.delay()  # duplicate drain must not create another effect

    channel = DepartmentChannel.objects.get(name='coordinación')
    endpoint = f'/api/v2/messaging/channels/{channel.pk}/automations/'
    due = timezone.now() + timedelta(seconds=12)
    created = alfa.post(endpoint, {'client_id': str(uuid.uuid4()), 'kind': 'reminder', 'name': 'Runtime aislado',
        'body': 'Recordatorio distribuido sintético', 'next_at': due.isoformat(), 'share_confirmed': True}, format='json')
    assert created.status_code == 201, (created.status_code, str(created.data))
    assert created.data['active'] is False
    rule_id = created.data['id']
    activated = alfa.patch(endpoint + rule_id + '/', {'client_id': str(uuid.uuid4()), 'version': created.data['version'],
        'active': True, 'share_confirmed': True}, format='json')
    assert activated.status_code == 200, (activated.status_code, str(activated.data))
    assert beta.get(endpoint).data['results'] == []
    wait_for(lambda: AutomationRun.objects.filter(rule_id=rule_id, state='published').exists())
    assert ChannelMessage.objects.filter(automation_run__rule_id=rule_id).count() == 1
    run_channel_automations.delay()
    time.sleep(3)
    assert ChannelMessage.objects.filter(automation_run__rule_id=rule_id).count() == 1
    assert not ChannelAutomation.objects.get(pk=rule_id).active
    # A real assignment outside the allowlist, including owner, stays excluded.
    unit, _ = OrganizationalUnit.objects.get_or_create(name='Fuera del piloto sintético', defaults={'unit_type':'department', 'sensitivity_level':'low'})
    employee = Employee.objects.create(full_name='Propietario sintético fuera de IT')
    outsider = UserAccount.objects.create_user(employee=employee, email=f'outside-runtime-{uuid.uuid4().hex[:8]}@bold.gt', is_superuser=True)
    assignment = PositionAssignment.objects.create(employee=employee, position=Position.objects.create(unit=unit, job_role=JobRole.objects.first()))
    client = APIClient(); client.force_authenticate(outsider); client.credentials(HTTP_X_ASSIGNMENT_ID=str(assignment.pk))
    assert client.get('/api/v2/messaging/conversations/').status_code == 403
    assert client.get('/api/v2/messaging/channels/').status_code == 403
    assert client.get(endpoint).status_code == 403
    async_to_sync(layer.group_discard)(group, inbox)
    print(json.dumps({'isolated_postgres_redis_celery_beat': True, 'eager': False,
        'worker_upload_and_two_account_download': True, 'provider': 'synthetic_not_google',
        'worker_hint_via_redis': bool(hint), 'real_clock_beat_reminder_once': True,
        'duplicate_jobs_no_duplicate_effect': True, 'outside_pilot_owner_denied': True,
        'production_data_used': False}))


if __name__ == '__main__':
    if len(sys.argv) != 2 or sys.argv[1] not in {'prepare', 'worker', 'verify'}:
        raise SystemExit('Usage: verify_messaging_runtime.py prepare|worker|verify')
    mode = sys.argv[1]
    configure()
    with ExitStack() as stack:
        provider_double(stack)
        if mode == 'prepare':
            from boldApp.mensajeria.channel_validation import seed
            seed()
            print('Isolated database migrated; fictitious accounts ready; no Google calls')
        elif mode == 'worker':
            from config.celery import app
            app.worker_main(['worker', '-B', '--schedule=/tmp/bold-validation-beat', '--loglevel=warning', '--concurrency=1'])
        else:
            verify()
