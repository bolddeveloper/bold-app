from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("boldApp_mensajeria", "0038_phoneimage_upload_alter_phoneimage_content")]

    operations = [
        migrations.AddField(
            model_name="privateserver",
            name="deleted_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
