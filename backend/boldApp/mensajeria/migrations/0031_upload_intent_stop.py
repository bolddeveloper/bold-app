import django.db.models.deletion
from django.db import migrations,models


class Migration(migrations.Migration):
    dependencies=[('boldApp_mensajeria','0030_media_upload_outbox')]
    operations=[
        migrations.AlterField(model_name='mediaupload',name='root',field=models.ForeignKey(null=True,
            on_delete=django.db.models.deletion.PROTECT,to='boldApp_workspace.imagestorageroot')),
        migrations.AddConstraint(model_name='mediaupload',constraint=models.CheckConstraint(
            condition=(models.Q(root__isnull=False) | models.Q(state='cancelled',size_bytes=0,cipher_bytes=0,
                content=b'',message_id__isnull=True,drive_id='',folder_id='',digest='',filename='',kind='',
                mime_type='',attempts=0,width__isnull=True,height__isnull=True)),name='media_upload_root_or_stop')),
        # Do not silently drop nonce stops or resurrect abandoned requests during
        # a downgrade. Reversal requires a deliberate data-preserving procedure.
        migrations.RunPython(migrations.RunPython.noop),
    ]
