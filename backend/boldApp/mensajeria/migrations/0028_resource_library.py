from django.db import migrations, models
from boldApp.mensajeria.resource_links_v1 import resource_links


def backfill(apps, schema_editor):
    alias = schema_editor.connection.alias
    if schema_editor.connection.vendor == "postgresql":
        schema_editor.execute("LOCK TABLE messaging_direct_messages, messaging_channel_messages IN SHARE MODE")
    Document = apps.get_model("boldApp_mensajeria", "SearchDocument")
    rows = Document.objects.using(alias).filter(page__isnull=True).select_related("direct", "channel_message").order_by("pk")
    pending = []
    for row in rows.iterator(chunk_size=300):
        source = row.direct if row.direct_id else row.channel_message
        row.has_links = bool(resource_links(source.body))
        pending.append(row)
        if len(pending) == 300:
            Document.objects.using(alias).bulk_update(pending, ["has_links"], batch_size=300)
            pending = []
    if pending:
        Document.objects.using(alias).bulk_update(pending, ["has_links"], batch_size=300)


class Migration(migrations.Migration):
    dependencies = [("boldApp_mensajeria", "0027_page_discussions")]
    operations = [
        migrations.AddField(model_name="searchdocument", name="has_links", field=models.BooleanField(default=False, db_default=False)),
        migrations.RunPython(backfill, migrations.RunPython.noop),
        migrations.AddIndex(model_name="searchdocument", index=models.Index(fields=["-created_at", "-id"], condition=models.Q(has_links=True), name="slack_resource_links")),
    ]
