from django.db import models

from boldApp.core.models import PositionAssignment
from boldApp.core.models.mixins import UUIDPrimaryKeyModel


class Suggestion(UUIDPrimaryKeyModel):
    CATEGORY_CHOICES = [
        ("idea", "Idea"), ("bug", "Problema"),
        ("visual", "Mejora visual"), ("other", "Otro"),
    ]
    STATUS_CHOICES = [
        ("new", "Nueva"), ("reviewing", "En revision"),
        ("accepted", "Aceptada"), ("resolved", "Resuelta"),
        ("dismissed", "Descartada"),
    ]

    author_assignment = models.ForeignKey(
        PositionAssignment, on_delete=models.PROTECT, related_name="suggestions_authored"
    )
    unit = models.ForeignKey(
        "boldApp_core.OrganizationalUnit", on_delete=models.PROTECT, related_name="suggestions"
    )
    category = models.CharField(max_length=20, choices=CATEGORY_CHOICES)
    message = models.TextField(max_length=2000)
    source_module = models.CharField(max_length=50, blank=True)
    source_view = models.CharField(max_length=80, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="new")
    internal_note = models.TextField(max_length=2000, blank=True)
    reviewed_by_assignment = models.ForeignKey(
        PositionAssignment, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="suggestions_reviewed",
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "suggestions"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["unit", "status", "created_at"], name="idx_suggestion_unit_status"),
            models.Index(fields=["author_assignment", "created_at"], name="idx_suggestion_author_time"),
        ]


class SuggestionEvent(UUIDPrimaryKeyModel):
    suggestion = models.ForeignKey(Suggestion, on_delete=models.PROTECT, related_name="events")
    actor_assignment = models.ForeignKey(
        PositionAssignment, on_delete=models.SET_NULL, null=True, related_name="suggestion_events"
    )
    event_type = models.CharField(max_length=60)
    changes = models.JSONField(default=dict, blank=True)
    occurred_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "suggestion_events"
        ordering = ["-occurred_at"]
