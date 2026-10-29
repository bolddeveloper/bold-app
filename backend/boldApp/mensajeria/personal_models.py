"""Personal references, never copies of content or independent read grants."""
from django.db import models


class SavedItem(models.Model):
    employee = models.ForeignKey("boldApp_core.Employee", on_delete=models.CASCADE)
    document = models.ForeignKey("boldApp_mensajeria.SearchDocument", on_delete=models.CASCADE, related_name="saved_items")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "messaging_saved_items"
        constraints = [models.UniqueConstraint(fields=["employee", "document"], name="unique_personal_saved_item")]
