import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('boldApp_autenticacion','0003_privatenote'),
        ('boldApp_core','0017_account_connector_delegation'),
        ('boldApp_mensajeria','0029_document_media'),
        ('boldApp_workspace','0007_imagedocument'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]
    operations = [
        migrations.CreateModel(name='MediaUploadQuota',fields=[
            ('id',models.PositiveSmallIntegerField(default=1,primary_key=True,serialize=False)),
        ]),
        migrations.CreateModel(name='MediaUpload',fields=[
            ('id',models.UUIDField(default=uuid.uuid4,editable=False,primary_key=True,serialize=False)),
            ('client_id',models.UUIDField()),
            ('state',models.CharField(choices=[(s,s) for s in ('queued','uploading','retry','failed','ready','attached','cancelled','expired')],default='queued',max_length=12)),
            ('digest',models.CharField(max_length=64)),
            ('filename',models.CharField(blank=True,max_length=180)),
            ('kind',models.CharField(max_length=10)),
            ('mime_type',models.CharField(max_length=100)),
            ('size_bytes',models.PositiveIntegerField()),
            ('width',models.PositiveIntegerField(null=True)),
            ('height',models.PositiveIntegerField(null=True)),
            ('content',models.BinaryField(default=bytes)),
            ('cipher_bytes',models.PositiveIntegerField(default=0)),
            ('drive_id',models.CharField(blank=True,max_length=200)),
            ('folder_id',models.CharField(blank=True,max_length=200)),
            ('message_id',models.UUIDField(null=True)),
            ('attempts',models.PositiveSmallIntegerField(default=0)),
            ('cycle_attempts',models.PositiveSmallIntegerField(default=0)),
            ('error_code',models.CharField(blank=True,max_length=32)),
            ('next_at',models.DateTimeField(db_index=True)),
            ('lease_token',models.UUIDField(null=True)),
            ('lease_until',models.DateTimeField(null=True)),
            ('expires_at',models.DateTimeField(db_index=True)),
            ('created_at',models.DateTimeField(auto_now_add=True)),
            ('updated_at',models.DateTimeField(auto_now=True)),
            ('cleanup_attempts',models.PositiveSmallIntegerField(default=0)),
            ('cleaned_at',models.DateTimeField(null=True)),
            ('account',models.ForeignKey(on_delete=django.db.models.deletion.PROTECT,to=settings.AUTH_USER_MODEL)),
            ('assignment',models.ForeignKey(on_delete=django.db.models.deletion.PROTECT,to='boldApp_core.positionassignment')),
            ('channel',models.ForeignKey(null=True,on_delete=django.db.models.deletion.PROTECT,to='boldApp_mensajeria.departmentchannel')),
            ('conversation',models.ForeignKey(null=True,on_delete=django.db.models.deletion.PROTECT,to='boldApp_mensajeria.directconversation')),
            ('root',models.ForeignKey(on_delete=django.db.models.deletion.PROTECT,to='boldApp_workspace.imagestorageroot')),
            ('session',models.ForeignKey(null=True,on_delete=django.db.models.deletion.SET_NULL,to='boldApp_autenticacion.authsession')),
        ],options={'db_table':'messaging_media_uploads',
            'indexes':[models.Index(fields=['state','next_at'],name='media_upload_pending')],
            'constraints':[models.CheckConstraint(condition=(models.Q(channel__isnull=True,conversation__isnull=False)|
                models.Q(channel__isnull=False,conversation__isnull=True)),name='media_upload_one_scope')]}),
        migrations.CreateModel(name='MediaUploadFolder',fields=[
            ('id',models.BigAutoField(auto_created=True,primary_key=True,serialize=False,verbose_name='ID')),
            ('key',models.CharField(max_length=700)),
            ('drive_id',models.CharField(max_length=200)),
            ('root',models.ForeignKey(on_delete=django.db.models.deletion.PROTECT,to='boldApp_workspace.imagestorageroot')),
        ],options={'constraints':[models.UniqueConstraint(fields=('root','key'),name='media_upload_folder_key')]}),
    ]
