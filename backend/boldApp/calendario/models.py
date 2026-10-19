from django.db import models
import uuid


class AppCalendar(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=120)
    owner = models.ForeignKey("boldApp_core.UserAccount", on_delete=models.PROTECT, related_name="app_calendars")
    system_key = models.CharField(max_length=30, null=True, blank=True, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)


class CalendarMember(models.Model):
    calendar = models.ForeignKey(AppCalendar, on_delete=models.CASCADE, related_name="members")
    user = models.ForeignKey("boldApp_core.UserAccount", on_delete=models.CASCADE)
    role = models.CharField(max_length=10, choices=[("reader", "Lectura"), ("editor", "Edición"), ("manager", "Administración")])

    class Meta:
        constraints = [models.UniqueConstraint(fields=["calendar", "user"], name="unique_app_calendar_member")]


class CalendarTeamShare(models.Model):
    calendar = models.ForeignKey(AppCalendar, on_delete=models.CASCADE, related_name="team_shares")
    user = models.ForeignKey("boldApp_core.UserAccount", on_delete=models.CASCADE)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["calendar", "user"], name="unique_calendar_team_share")]


class AppCalendarEvent(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    calendar = models.ForeignKey(AppCalendar, on_delete=models.CASCADE, related_name="events")
    start_at = models.DateTimeField(db_index=True)
    end_at = models.DateTimeField(db_index=True)
    data = models.JSONField(default=dict)
    source_key = models.CharField(max_length=160, null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["calendar", "source_key"], name="unique_app_calendar_import")]


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
    connection = models.ForeignKey("boldApp_workspace.GoogleConnection", null=True, on_delete=models.SET_NULL)
    google_subject = models.CharField(max_length=255, blank=True)
    calendar_email = models.EmailField()
    last_seen_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "google_calendar_draft"
