from django.urls import path

from .views import ConversationDetailView, ConversationListView, MessageDetailView, MessageListView, MessageMediaView, ReceiptView, PreferencesView, UnreadSummaryView

urlpatterns = [
    path("unread/", UnreadSummaryView.as_view(), name="messaging-unread"),
    path("preferences/", PreferencesView.as_view(), name="messaging-preferences"),
    path("conversations/", ConversationListView.as_view(), name="direct-conversations"),
    path("conversations/<uuid:conversation_id>/", ConversationDetailView.as_view(), name="direct-conversation"),
    path("conversations/<uuid:conversation_id>/messages/", MessageListView.as_view(), name="direct-messages"),
    path("conversations/<uuid:conversation_id>/receipts/", ReceiptView.as_view(), name="direct-receipts"),
    path("conversations/<uuid:conversation_id>/messages/<uuid:message_id>/", MessageDetailView.as_view(), name="direct-message"),
    path("conversations/<uuid:conversation_id>/messages/<uuid:message_id>/media/", MessageMediaView.as_view(), name="direct-message-media"),
]
