from django.core.validators import RegexValidator
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("boldApp_mensajeria", "0012_channel_access_epoch")]
    operations = [migrations.AddField(model_name="departmentchannel", name="color",
        field=models.CharField(blank=True, default="", max_length=7,
            validators=[RegexValidator(r"^#[0-9a-fA-F]{6}$", "Usa un color hexadecimal de seis dígitos.")]))]
