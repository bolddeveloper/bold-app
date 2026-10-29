from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("boldApp_mensajeria", "0019_thread_subscriptions")]
    operations = [migrations.CreateModel(name="ResourceMention", fields=[
        ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
        ("token", models.CharField(max_length=256)),
        ("name", models.CharField(max_length=200)),
        ("created_at", models.DateTimeField(auto_now_add=True)),
        ("document", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="mentions", to="boldApp_mensajeria.searchdocument")),
        ("employee", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to="boldApp_core.employee")),
    ], options={"db_table": "messaging_resource_mentions", "constraints": [models.UniqueConstraint(fields=("document", "token"), name="unique_resource_mention_token")]})]
