from django.db import migrations, models
import django.db.models.deletion
from django.db.models.functions import Lower


class Migration(migrations.Migration):
    dependencies = [("boldApp_mensajeria", "0009_channel_following_and_thread_reads")]
    operations = [
        migrations.AlterField(
            model_name="departmentchannel", name="unit",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT,
                related_name="communication_channels", to="boldApp_core.organizationalunit"),
        ),
        migrations.AddConstraint(
            model_name="departmentchannel",
            constraint=models.UniqueConstraint(Lower("name"), condition=models.Q(unit__isnull=True), name="unique_independent_channel_name"),
        ),
    ]
