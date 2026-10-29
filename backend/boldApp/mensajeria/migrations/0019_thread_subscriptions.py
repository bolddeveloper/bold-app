from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("boldApp_mensajeria", "0018_saved_items")]
    operations = [migrations.CreateModel(
        name="ChannelThreadSubscription",
        fields=[
            ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
            ("following", models.BooleanField(default=False)),
            ("revision", models.PositiveBigIntegerField(default=0)),
            ("updated_at", models.DateTimeField(auto_now=True)),
            ("employee", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to="boldApp_core.employee")),
            ("parent", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="thread_subscriptions", to="boldApp_mensajeria.channelmessage")),
        ],
        options={"db_table": "messaging_thread_subscriptions", "constraints": [models.UniqueConstraint(fields=("parent", "employee"), name="unique_thread_subscription")],
            "indexes": [models.Index(fields=["employee", "parent"], condition=models.Q(following=True), name="slack_followed_threads")]},
    )]
