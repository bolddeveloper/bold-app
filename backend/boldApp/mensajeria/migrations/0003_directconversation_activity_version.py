from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("boldApp_mensajeria", "0002_messagingpreferences_directmessage_delivered_at_and_more")]
    operations = [migrations.AddField(model_name="directconversation", name="activity_version",
                                     field=models.PositiveBigIntegerField(default=0)),
                  migrations.AddIndex(model_name="directmessage", index=models.Index(fields=["conversation", "author"],
                      condition=models.Q(read_at__isnull=True), name="chat_unread_recipient"))]
