from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):
    dependencies = [("boldApp_hojas", "0004_workbook_calculation_error"), ("boldApp_autenticacion", "0001_initial")]
    operations = [
        migrations.AddField("workbook", "excel_content", models.BinaryField(blank=True, null=True)),
        migrations.AddField("workbook", "excel_revision", models.PositiveBigIntegerField(default=0)),
        migrations.AddField("workbook", "office_lock", models.CharField(blank=True, max_length=1024)),
        migrations.AddField("workbook", "office_lock_until", models.DateTimeField(blank=True, null=True)),
        migrations.AddField("revision", "excel_content", models.BinaryField(blank=True, null=True)),
        migrations.AddField("importreview", "excel_content", models.BinaryField(blank=True, null=True)),
        migrations.CreateModel(name="OfficeSession", fields=[
            ("id", models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, serialize=False)),
            ("base_revision", models.PositiveBigIntegerField()),
            ("expires_at", models.DateTimeField()),
            ("workbook", models.ForeignKey(to="boldApp_hojas.workbook", on_delete=django.db.models.deletion.CASCADE)),
            ("assignment", models.ForeignKey(to="boldApp_core.positionassignment", on_delete=django.db.models.deletion.CASCADE)),
            ("auth_session", models.ForeignKey(to="boldApp_autenticacion.authsession", on_delete=django.db.models.deletion.CASCADE)),
        ]),
    ]
