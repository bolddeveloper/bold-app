"""Verified person references share the source lifetime, never its ACL."""
from django.db import models


class ResourceMention(models.Model):
    document = models.ForeignKey("boldApp_mensajeria.SearchDocument", on_delete=models.CASCADE, related_name="mentions")
    employee = models.ForeignKey("boldApp_core.Employee", on_delete=models.PROTECT)
    token = models.CharField(max_length=256)
    name = models.CharField(max_length=200)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "messaging_resource_mentions"
        constraints = [models.UniqueConstraint(fields=["document", "token"], name="unique_resource_mention_token")]
