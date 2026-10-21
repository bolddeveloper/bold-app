import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("boldApp_mensajeria", "0011_channel_access")]
    operations = [migrations.CreateModel(name="ChannelAccessEpoch", fields=[
        ("employee", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, primary_key=True, serialize=False, to="boldApp_core.employee")),
        ("revision", models.PositiveBigIntegerField(default=0)),
    ], options={"db_table": "messaging_channel_access_epochs"})]
