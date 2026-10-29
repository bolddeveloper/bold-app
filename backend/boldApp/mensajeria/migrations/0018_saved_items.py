from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("boldApp_mensajeria", "0017_history_search")]

    operations = [migrations.CreateModel(
        name="SavedItem",
        fields=[
            ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
            ("created_at", models.DateTimeField(auto_now_add=True)),
            ("document", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="saved_items", to="boldApp_mensajeria.searchdocument")),
            ("employee", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to="boldApp_core.employee")),
        ],
        options={"db_table": "messaging_saved_items", "constraints": [models.UniqueConstraint(fields=("employee", "document"), name="unique_personal_saved_item")]},
    )]
