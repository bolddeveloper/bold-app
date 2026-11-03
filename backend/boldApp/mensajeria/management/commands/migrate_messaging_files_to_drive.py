"""Move legacy bytes only after Drive confirms their checksum; never publish messages."""
import hashlib
import uuid

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone
from boldApp.workspace.image_storage import storage_user, store_instance_images
from boldApp.workspace.models import ImageStorageRoot
from boldApp.mensajeria.models import MediaUpload, PhoneImage, ServerIcon
from boldApp.mensajeria.upload_outbox import cipher, LEASE, identity
from boldApp.mensajeria.upload_provider import upload


def archive_upload(row, content):
    if len(content) != row.size_bytes or hashlib.sha256(content).hexdigest() != row.digest:
        raise ValueError('El original no coincide con sus metadatos.')
    if not row.root or not row.root.active:
        raise ValueError('El destino original de Drive ya no está activo.')
    storage_user(row.root)
    now=timezone.now()
    with transaction.atomic():
        current=MediaUpload.objects.select_for_update().get(pk=row.pk)
        if current.state=='uploading' and current.lease_until and current.lease_until>now:
            raise ValueError('Hay una subida en curso; reintenta la migración cuando termine.')
        original_state, original_expiry = current.state, current.expires_at
        current.state='uploading';current.lease_token=uuid.uuid4();current.lease_until=now+LEASE
        current.expires_at=max(original_expiry,now+LEASE)
        current.save(update_fields=['state','lease_token','lease_until','expires_at'])
    try:
        # Trusted archival copy; retaining the original state/expiry grants no publication or access.
        upload(current,content)
        with transaction.atomic():
            saved=MediaUpload.objects.select_for_update().get(pk=current.pk)
            if saved.state!='uploading' or saved.lease_token!=current.lease_token:
                raise ValueError('El intento cambió durante la copia; se conserva el original.')
            saved.content=b'';saved.cipher_bytes=0
            saved.state=original_state;saved.expires_at=original_expiry
            saved.lease_token=None;saved.lease_until=None
            saved.save(update_fields=['content','cipher_bytes','state','expires_at','lease_token','lease_until'])
    except Exception:
        MediaUpload.objects.filter(pk=current.pk,state='uploading',lease_token=current.lease_token).update(
            state=original_state,expires_at=original_expiry,lease_token=None,lease_until=None)
        raise


class Command(BaseCommand):
    help='Inventario de archivos antiguos. --apply copia a Drive después de hacer respaldo; conserva originales si falla.'

    def add_arguments(self,parser):
        parser.add_argument('--apply',action='store_true')
        parser.add_argument('--kind',choices=['all','icons','uploads','phone'],default='all')

    def handle(self,*args,**options):
        icons=ServerIcon.objects.filter(image__startswith='data:image/')
        uploads=MediaUpload.objects.exclude(content=b'')
        phones=PhoneImage.objects.exclude(content=b'')
        kinds={'icons':icons,'uploads':uploads,'phone':phones}
        if options['kind']!='all':kinds={options['kind']:kinds[options['kind']]}
        counts={kind:query.count() for kind,query in kinds.items()}
        self.stdout.write('Originales pendientes: '+', '.join(f'{kind}={count}' for kind,count in counts.items()))
        if not options['apply'] or not any(counts.values()):return
        root=ImageStorageRoot.objects.filter(active=True).select_related('user').first()
        if not root:raise CommandError('Configura y reconecta el almacenamiento de Drive. Los originales se conservan.')
        try:storage_user(root)
        except Exception as exc:raise CommandError('Reconecta Drive antes de migrar. No se modificaron los originales.') from exc
        completed=failures=0
        for kind,query in kinds.items():
            for source in query.iterator(chunk_size=20):
                try:
                    if kind=='icons':
                        with transaction.atomic():
                            locked=ServerIcon.objects.select_for_update().get(pk=source.pk)
                            store_instance_images(locked,fields=['image'])
                    elif kind=='uploads':
                        archive_upload(source,cipher().decrypt(bytes(source.content)))
                    else:
                        transfer=source.transfer
                        container=transfer.channel or transfer.conversation
                        client_id=uuid.uuid5(transfer.pk,str(source.client_id))
                        token=identity('channel' if transfer.channel_id else 'chat',container.pk,transfer.account_id,client_id)
                        row,_=MediaUpload.objects.get_or_create(pk=token,defaults={
                            'account':transfer.account,'assignment':transfer.assignment,'session':transfer.session,
                            'channel':transfer.channel,'conversation':transfer.conversation,'client_id':client_id,'root':root,
                            'kind':'image','mime_type':'image/webp','filename':'phone-image.webp','size_bytes':source.size_bytes,
                            'digest':source.digest,'state':'ready','expires_at':transfer.expires_at,'next_at':timezone.now()})
                        archive_upload(row,bytes(source.content))
                        PhoneImage.objects.filter(pk=source.pk,digest=source.digest).update(content=b'',upload=row)
                    completed+=1
                except Exception as exc:
                    failures+=1
                    self.stderr.write(f'Pendiente {kind}: {type(exc).__name__}. Se conserva el original.')
        self.stdout.write(f'Migrados: {completed}. Pendientes: {failures}.')
        if failures:raise CommandError('La migración quedó incompleta. No borres los originales ni el respaldo; corrige Drive y reintenta.')
