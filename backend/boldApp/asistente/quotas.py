from datetime import datetime,time,timedelta
from django.utils import timezone


def daily_window():
    """Use indexed instants, without relying on the database's timezone catalog."""
    day=timezone.localdate();zone=timezone.get_current_timezone()
    return datetime.combine(day,time.min,tzinfo=zone),datetime.combine(day+timedelta(days=1),time.min,tzinfo=zone)
