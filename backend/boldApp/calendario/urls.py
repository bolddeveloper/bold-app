from django.urls import path
from .mail_contacts import CalendarMailContactSearchView

from .views import CalendarConnectionView, CalendarOAuthCallbackView, CalendarOAuthStartView, CalendarDraftView, CalendarDraftsView, CalendarEventView, CalendarEventsView, CalendarTaskListsView, CalendarTasksView, CalendarTaskView, CalendarContactSearchView

urlpatterns = [
    path("connection/", CalendarConnectionView.as_view()),
    path("oauth/start/", CalendarOAuthStartView.as_view()),
    path("oauth/callback/", CalendarOAuthCallbackView.as_view()),
    path("events/", CalendarEventsView.as_view()),
    path("drafts/", CalendarDraftsView.as_view()),
    path("drafts/<int:draft_id>/", CalendarDraftView.as_view()),
    path("task-lists/", CalendarTaskListsView.as_view()),
    path("tasks/", CalendarTasksView.as_view()),
    path("contacts/", CalendarContactSearchView.as_view()),
    path("mail-contacts/", CalendarMailContactSearchView.as_view()),
    path("tasks/<str:list_id>/<str:task_id>/", CalendarTaskView.as_view()),
    path("events/<str:event_id>/", CalendarEventView.as_view()),
]
