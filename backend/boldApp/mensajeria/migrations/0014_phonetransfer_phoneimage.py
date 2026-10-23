import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('boldApp_autenticacion', '0003_privatenote'),
        ('boldApp_core', '0017_account_connector_delegation'),
        ('boldApp_mensajeria', '0013_channel_color'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]
    operations = [
        migrations.CreateModel(name='PhoneTransfer', fields=[
            ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
            ('claim_hash', models.CharField(max_length=64)),
            ('device_hash', models.CharField(blank=True, max_length=64)),
            ('pairing_code', models.CharField(blank=True, max_length=6)),
            ('approved', models.BooleanField(default=False)),
            ('sealed', models.BooleanField(default=False)),
            ('max_images', models.PositiveSmallIntegerField(default=10)),
            ('expires_at', models.DateTimeField(db_index=True)),
            ('created_at', models.DateTimeField(auto_now_add=True)),
            ('account', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, to=settings.AUTH_USER_MODEL)),
            ('assignment', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='boldApp_core.positionassignment')),
            ('channel', models.ForeignKey(null=True, on_delete=django.db.models.deletion.CASCADE, to='boldApp_mensajeria.departmentchannel')),
            ('conversation', models.ForeignKey(null=True, on_delete=django.db.models.deletion.CASCADE, to='boldApp_mensajeria.directconversation')),
            ('parent', models.ForeignKey(null=True, on_delete=django.db.models.deletion.CASCADE, to='boldApp_mensajeria.channelmessage')),
            ('session', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='boldApp_autenticacion.authsession')),
        ]),
        migrations.CreateModel(name='PhoneImage', fields=[
            ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
            ('client_id', models.UUIDField()), ('content', models.BinaryField()),
            ('size_bytes', models.PositiveIntegerField()), ('digest', models.CharField(max_length=64)),
            ('created_at', models.DateTimeField(auto_now_add=True)),
            ('transfer', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='images', to='boldApp_mensajeria.phonetransfer')),
        ], options={'constraints': [models.UniqueConstraint(fields=('transfer', 'client_id'), name='phone_image_retry')]}),
    ]
