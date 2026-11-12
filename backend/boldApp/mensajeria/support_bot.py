"""Explicit local support mentions, durable receipts and no automatic model retries."""
from datetime import timedelta
import hashlib
import re
from types import SimpleNamespace

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from boldApp.autenticacion.models import AuthSession
from boldApp.core.models import PositionAssignment
from .channel_access import ChannelPolicy
from .mentions import LITERAL
from .models import ChannelMessage, DepartmentChannel, SupportRequest
from .support_codex import answer, SupportUnavailable
from .support_identity import BOT_ID, configure_identity, isolated, mention_person
from .support_context import prompt_for


MENTION = re.compile(r'(?<![\w@.+%-])(?:@soporte[ \t]+bold|@soportebold(?:@bold\.gt)?)(?![\w@%+-]|\.[\w])', re.IGNORECASE)


def mentioned(body):
    return bool(MENTION.search(LITERAL.sub(' ', body)))


def enqueue(message, request):
    if not settings.BOLD_SUPPORT_ENABLED or message.automation_kind or not mentioned(message.body):
        return
    if not PositionAssignment.objects.select_for_update().filter(pk=BOT_ID).exists():
        return
    if SupportRequest.objects.filter(source=message).exists():
        return
    from boldApp.asistente.models import InferenceGate
    InferenceGate.objects.select_for_update().get(pk=1)
    from boldApp.asistente.quotas import daily_window
    start,end=daily_window()
    today = SupportRequest.objects.filter(created_at__gte=start,created_at__lt=end, admitted=True)
    from boldApp.asistente.models import InferenceAttempt
    operational=InferenceAttempt.objects.filter(created_at__gte=start,created_at__lt=end)
    reason = 'daily_limit' if today.count()+operational.count() >= settings.BOLD_SUPPORT_DAILY_LIMIT else ''
    if not reason and today.filter(source__author_id=message.author_id).count()+operational.filter(request__account__employee_id=message.author_id).count() >= settings.BOLD_SUPPORT_USER_DAILY_LIMIT:
        reason = 'user_daily_limit'
    session = request.auth if isinstance(request.auth, AuthSession) else None
    SupportRequest.objects.create(source=message, source_version=message.version, session=session,
                                  reason=reason, admitted=not reason)


def permitted(job):
    message, now = job.source, timezone.now()
    assignment = message.author_assignment
    account = getattr(assignment.employee, 'user_account', None)
    if not settings.BOLD_SUPPORT_ENABLED or not account or not account.is_active or account.must_change_password:
        return False
    if mention_person() is None:
        return False
    if not mentioned(message.body) or message.version != job.source_version or message.channel.archived_at:
        return False
    parent = message.parent if message.parent_id else None
    if parent and (parent.thread_closed_at or parent.thread_locked or parent.thread_deleted_at):
        return False
    session = job.session
    if session and (session.revoked_at or session.expires_at <= now
            or session.idle_expires_at and session.idle_expires_at <= now
            or session.credentials_version != account.credentials_version
            or session.user_account_id != account.pk):
        return False
    if settings.AUTH_MFA_REQUIRED and (not session or not session.mfa_verified_at
            or not account.mfa_methods.filter(is_active=True).exists()):
        return False
    policy = ChannelPolicy(assignment, SimpleNamespace(auth=session))
    return all(policy.allows(code, message.channel.unit, message.channel_id)
               for code in ('slack.channel.read', 'slack.message.create'))


def load_job(pk):
    return SupportRequest.objects.select_related(
        'session', 'source__channel__unit', 'source__parent',
        'source__author_assignment__employee__user_account',
        'source__author_assignment__position__unit',
        'source__author_assignment__position__job_role').get(pk=pk)


@transaction.atomic
def publish(pk, body, *, reason='', context_digest=None):
    channel_id = SupportRequest.objects.values_list('source__channel_id', flat=True).get(pk=pk)
    channel = DepartmentChannel.objects.select_for_update().get(pk=channel_id)
    SupportRequest.objects.select_for_update().get(pk=pk)
    job = load_job(pk)
    if job.state != 'processing':
        return False
    if not permitted(job):
        SupportRequest.objects.filter(pk=pk).update(state='skipped', reason='access_or_source_changed', finished_at=timezone.now())
        return False
    if context_digest and hashlib.sha256(prompt_for(job.source).encode()).hexdigest() != context_digest:
        SupportRequest.objects.filter(pk=pk).update(state='skipped', reason='context_changed', finished_at=timezone.now())
        return False
    bot = PositionAssignment.objects.select_related('employee__user_account').get(pk=BOT_ID)
    if not isolated(bot):
        raise ValueError('La identidad de soporte ya no está aislada.')
    source = job.source
    parent = ChannelMessage.objects.select_for_update().get(pk=source.parent_id) if source.parent_id else None
    channel.activity_version += 1
    reply = ChannelMessage.objects.create(channel=channel, author=bot.employee, author_assignment=bot,
        department_name='Asistente IA', department_color='#ed3033', client_id=job.pk,
        payload_digest=hashlib.sha256(body.encode()).hexdigest(), sequence=channel.activity_version,
        body=body, parent=parent, automation_kind='support')
    if parent and not parent.thread_started_at:
        parent.thread_started_at = reply.created_at
        parent.thread_starter_id = source.author_id
        parent.version += 1
        parent.save(update_fields=['thread_started_at', 'thread_starter', 'version'])
    channel.updated_at = reply.created_at
    channel.save(update_fields=['activity_version', 'updated_at'])
    from .channel_notifications import notify_channel_message
    from .channel_events import publish_channel
    notify_channel_message(reply, source.author_assignment)
    publish_channel(channel, 'message.created')
    SupportRequest.objects.filter(pk=pk).update(reply=reply, state='failed' if reason else 'completed',
        reason=reason, finished_at=timezone.now())
    return True


def _process(pk):
    if not SupportRequest.objects.filter(pk=pk, state='pending').update(
            state='processing', started_at=timezone.now(), model=settings.BOLD_SUPPORT_MODEL):
        return False
    job = load_job(pk)
    if not permitted(job):
        SupportRequest.objects.filter(pk=pk).update(state='skipped', reason='access_or_source_changed', finished_at=timezone.now())
        return False
    if job.reason:
        publish(pk, 'Alcanzamos el límite diario de consultas de soporte. Puedes volver a mencionar @soporte bold mañana.', reason=job.reason)
        return False
    try:
        prompt = prompt_for(job.source)
        context_digest = hashlib.sha256(prompt.encode()).hexdigest()
        body, usage = answer(prompt)
        SupportRequest.objects.filter(pk=pk).update(**usage)
    except SupportUnavailable as error:
        publish(pk, 'No pude completar esta respuesta. Revisa que Codex tenga sesión y consumo disponible. '
                    'No reintentaré automáticamente; puedes enviar otra mención cuando esté disponible.', reason=str(error))
        return False
    return publish(pk, body, context_digest=context_digest)


def process(pk):
    from boldApp.asistente import gate
    owner=gate.acquire()
    if not owner:
        return False
    try:
        return _process(pk)
    finally:
        gate.release(owner)


def drain(limit=10):
    if not settings.BOLD_SUPPORT_ENABLED:
        return 0
    # An interrupted inference may already have consumed credits. Never repeat it automatically.
    SupportRequest.objects.filter(state='processing', started_at__lt=timezone.now()-timedelta(minutes=3)).update(
        state='failed', reason='interrupted', finished_at=timezone.now())
    pending = list(SupportRequest.objects.filter(state='pending').order_by('created_at').values_list('pk', flat=True)[:limit])
    from boldApp.asistente.service import drain as drain_assistant
    return sum(process(pk) for pk in pending)+drain_assistant()
