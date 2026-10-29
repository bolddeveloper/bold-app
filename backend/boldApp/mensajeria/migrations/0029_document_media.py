from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("boldApp_mensajeria", "0028_resource_library")]
    operations = [migrations.AlterField(model_name=name, name="kind", field=models.CharField(max_length=10,
        choices=[("image", "Imagen"), ("audio", "Nota de voz"), ("document", "Documento")])) for name in ("messagemedia", "channelmedia")]
