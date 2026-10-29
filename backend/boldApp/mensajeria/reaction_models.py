"""Independent reaction clocks; clearing the last emoji retains an actor tombstone."""
from django.db import models


class ReactionActorState(models.Model):
    document = models.ForeignKey("boldApp_mensajeria.SearchDocument", on_delete=models.CASCADE)
    employee = models.ForeignKey("boldApp_core.Employee", on_delete=models.CASCADE)
    version = models.PositiveBigIntegerField(default=0)
    last_client_id = models.UUIDField(null=True)
    last_digest = models.CharField(max_length=64, default="", blank=True)

    class Meta:
        db_table = "messaging_reaction_actor_states"
        constraints = [models.UniqueConstraint(fields=["document", "employee"], name="unique_message_reaction_actor")]


class MessageReaction(models.Model):
    document = models.ForeignKey("boldApp_mensajeria.SearchDocument", on_delete=models.CASCADE, related_name="reactions")
    employee = models.ForeignKey("boldApp_core.Employee", on_delete=models.CASCADE)
    key = models.CharField(max_length=24)

    class Meta:
        db_table = "messaging_message_reactions"
        constraints = [models.UniqueConstraint(fields=["document", "employee", "key"], name="unique_message_actor_emoji")]
