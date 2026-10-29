import re
import unicodedata
import uuid
import django.db.models.deletion
from django.db import migrations, models


def normalize(value):
    value = unicodedata.normalize("NFKD", value.casefold())
    return " ".join(re.findall(r"[^\W_]+", "".join(c for c in value if not unicodedata.combining(c))))


def backfill(apps, schema_editor):
    alias = schema_editor.connection.alias
    if schema_editor.connection.vendor == "postgresql":
        # Prevent old application workers from changing a source between its
        # snapshot and activation of the new projection-writing code. SHARE
        # permits reads, but preceding ALTER TABLE locks can also block them
        # until commit: deploy this backfill in a maintenance window.
        schema_editor.execute("LOCK TABLE messaging_direct_messages, messaging_channel_messages, messaging_channel_pages, messaging_message_media, messaging_channel_media IN SHARE MODE")
    Document = apps.get_model("boldApp_mensajeria", "SearchDocument")
    for model_name, field in (("DirectMessage", "direct"), ("ChannelMessage", "channel_message"), ("ChannelPage", "page")):
        Source = apps.get_model("boldApp_mensajeria", model_name)
        rows = Source.objects.using(alias).all().order_by("pk")
        if field != "page":
            rows = rows.select_related("media")
        pending = []
        for row in rows.iterator(chunk_size=300):
            if field == "page":
                text = "\n".join([row.title, *(block.get("text", "") for block in row.blocks if block.get("type") != "task")])
            else:
                media = getattr(row, "media", None)
                text = "\n".join([row.body, *([media.filename, media.mime_type,
                    "imagen" if media.kind == "image" else "nota de voz audio"] if media else [])])
            pending.append(Document(**{field + "_id": row.pk, "created_at": row.created_at, "text": normalize(text)}))
            if len(pending) == 300:
                Document.objects.using(alias).bulk_create(pending)
                pending = []
        if pending:
            Document.objects.using(alias).bulk_create(pending)


def create_gin(apps, schema_editor):
    if schema_editor.connection.vendor == "postgresql":
        schema_editor.execute("CREATE INDEX slack_search_text_gin ON messaging_search_documents USING GIN (to_tsvector('simple'::regconfig, COALESCE(text, '')))")


def drop_gin(apps, schema_editor):
    if schema_editor.connection.vendor == "postgresql":
        schema_editor.execute("DROP INDEX IF EXISTS slack_search_text_gin")


class Migration(migrations.Migration):
    dependencies = [("boldApp_mensajeria", "0016_templates_collaboration")]
    operations = [
        migrations.AddField(model_name="messagemedia", name="filename", field=models.CharField(blank=True, default="", max_length=180)),
        migrations.AddField(model_name="channelmedia", name="filename", field=models.CharField(blank=True, default="", max_length=180)),
        migrations.CreateModel(name="SearchDocument", fields=[
            ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
            ("text", models.TextField()), ("created_at", models.DateTimeField()),
            ("direct", models.OneToOneField(null=True, on_delete=django.db.models.deletion.CASCADE, related_name="search_document", to="boldApp_mensajeria.directmessage")),
            ("channel_message", models.OneToOneField(null=True, on_delete=django.db.models.deletion.CASCADE, related_name="search_document", to="boldApp_mensajeria.channelmessage")),
            ("page", models.OneToOneField(null=True, on_delete=django.db.models.deletion.CASCADE, related_name="search_document", to="boldApp_mensajeria.channelpage")),
        ], options={"db_table": "messaging_search_documents",
            "indexes": [models.Index(fields=["-created_at", "-id"], name="slack_search_history")],
            "constraints": [models.CheckConstraint(condition=(
                models.Q(direct__isnull=False, channel_message__isnull=True, page__isnull=True) |
                models.Q(direct__isnull=True, channel_message__isnull=False, page__isnull=True) |
                models.Q(direct__isnull=True, channel_message__isnull=True, page__isnull=False)
            ), name="slack_search_one_source")]}),
        migrations.RunPython(backfill, migrations.RunPython.noop),
        # PostgreSQL-only functional index; SQLite keeps the portable test path.
        # Build after the bounded backfill, not once for every inserted source.
        migrations.RunPython(create_gin, drop_gin),
    ]
