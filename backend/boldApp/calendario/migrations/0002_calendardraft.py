from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("calendario", "0001_initial"), ("boldApp_core", "0007_useraccount_administration_dashboard_layout")]

    operations = [migrations.CreateModel(
        name="CalendarDraft",
        fields=[
            ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
            ("event_id", models.CharField(max_length=255, unique=True)),
            ("calendar_email", models.EmailField(max_length=254)),
            ("last_seen_at", models.DateTimeField(auto_now_add=True)),
            ("owner", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, to="boldApp_core.useraccount")),
        ],
        options={"db_table": "google_calendar_draft"},
    )]
