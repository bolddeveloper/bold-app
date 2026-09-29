from django.db import models


class GoogleCalendarConnection(models.Model):
    # One shared Google account for the whole Bold installation.
    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)
    email = models.EmailField(blank=True)
    time_zone = models.CharField(max_length=80, default="UTC")
    refresh_token_encrypted = models.TextField()
    connected_at = models.DateTimeField(auto_now_add=True)
    last_checked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "google_calendar_connection"


class CalendarDraft(models.Model):
    event_id = models.CharField(max_length=255, unique=True)
    owner = models.ForeignKey("boldApp_core.UserAccount", null=True, on_delete=models.SET_NULL)
    calendar_email = models.EmailField()
    last_seen_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "google_calendar_draft"
