from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True
    dependencies = []
    operations = [migrations.CreateModel(name="GoogleCalendarConnection", fields=[
        ("id", models.PositiveSmallIntegerField(default=1, editable=False, primary_key=True, serialize=False)),
        ("email", models.EmailField(blank=True, max_length=254)),
        ("time_zone", models.CharField(default="UTC", max_length=80)),
        ("refresh_token_encrypted", models.TextField()),
        ("connected_at", models.DateTimeField(auto_now_add=True)),
        ("last_checked_at", models.DateTimeField(blank=True, null=True)),
    ], options={"db_table": "google_calendar_connection"})]
