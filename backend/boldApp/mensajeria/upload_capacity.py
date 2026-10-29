"""Logical managed-file and intent budgets under MediaUploadQuota's DB mutex.

No Google quota calls, cross-user metrics or background scan. Already-published
legacy media count too. Trashing a remotely reserved file does NOT refund this
conservative budget: absence/Trash is not proof that remote storage was freed.
These bounds exclude folders, indexes/WAL/backups and files outside Messaging.
"""
from django.conf import settings
from django.db.models import Q, Sum
from rest_framework.exceptions import APIException
from .models import MediaUpload, MessageMedia, ChannelMedia, PhoneImage


class MessagingCapacityFull(APIException):
    status_code = 507
    default_code = 'messaging_capacity_limit'
    default_detail = ('Se alcanzó un límite configurado de archivos o intentos de mensajería. '
        'No se creó un nuevo intento ni se subió un archivo. Revisa la capacidad antes de iniciar otro envío; no descartes tu borrador.')


class TemporaryCapacityFull(APIException):
    status_code = 429
    default_detail = 'La cola temporal de archivos está llena. Espera a que termine una transferencia antes de añadir otra.'
    wait = 60


def check_temporary_capacity(account, extra_bytes, *, check_records=True):
    """Caller holds MediaUploadQuota, before allocating outbox OR phone bytes.

    Expired phone bytes still occupy the database until cleanup actually removes
    them. A phone draft and its staged copy temporarily count separately.
    """
    uploads = MediaUpload.objects
    phones = PhoneImage.objects
    if check_records:
        _check_records(account, *legacy_media())
    total = uploads.aggregate(total=Sum('cipher_bytes'))['total'] or 0
    own = uploads.filter(account=account).aggregate(total=Sum('cipher_bytes'))['total'] or 0
    if (total + _bytes(phones) + extra_bytes > settings.MESSAGING_UPLOAD_QUEUE_BYTES or
            own + _bytes(phones.filter(transfer__account=account)) + extra_bytes > settings.MESSAGING_UPLOAD_ACCOUNT_BYTES):
        raise TemporaryCapacityFull()


def legacy_media():
    # New media share their upload UUID. Counting both would double charge an
    # attachment at publication, while ignoring legacy files would undercount.
    direct = MessageMedia.objects.exclude(pk__in=MediaUpload.objects.filter(
        conversation__isnull=False, message_id__isnull=False).values('pk'))
    channel = ChannelMedia.objects.exclude(pk__in=MediaUpload.objects.filter(
        channel__isnull=False, message_id__isnull=False).values('pk'))
    return direct, channel


def _bytes(query):
    return query.aggregate(total=Sum('size_bytes'))['total'] or 0


def _check_records(account, direct, channel):
    total = MediaUpload.objects.count() + direct.count() + channel.count() + PhoneImage.objects.count()
    own = (MediaUpload.objects.filter(account=account).count() +
        direct.filter(message__author_id=account.employee_id).count() +
        channel.filter(message__author_id=account.employee_id).count() +
        PhoneImage.objects.filter(transfer__account=account).count())
    if (total + 1 > settings.MESSAGING_UPLOAD_MAX_RECORDS or
            own + 1 > settings.MESSAGING_UPLOAD_ACCOUNT_MAX_RECORDS):
        raise MessagingCapacityFull()


def check_capacity(account, size_bytes=0, *, metadata_only=False):
    """Before inserting a NEW intent. Idempotent lookup/cancel/publish precede it.

    Caller holds the existing global reservation mutex; never invoke this after
    provider I/O or as an authorization substitute. All policy/session checks
    remain in the upload endpoint/worker/publication.
    """
    direct, channel = legacy_media()
    own_direct = direct.filter(message__author_id=account.employee_id)
    own_channel = channel.filter(message__author_id=account.employee_id)
    _check_records(account, direct, channel)
    if metadata_only:
        return
    # A stopped intent without a reserved remote ID cannot create a file after
    # its nonce is fenced. A file with a remote ID remains charged even in Trash.
    charge = MediaUpload.objects.filter(root__isnull=False).filter(
        ~Q(state__in=('cancelled','expired')) | ~Q(drive_id=''))
    if (_bytes(charge) + _bytes(direct) + _bytes(channel) + size_bytes > settings.MESSAGING_STORAGE_TOTAL_BYTES or
            _bytes(charge.filter(account=account)) + _bytes(own_direct) + _bytes(own_channel) + size_bytes > settings.MESSAGING_STORAGE_ACCOUNT_BYTES):
        raise MessagingCapacityFull()
