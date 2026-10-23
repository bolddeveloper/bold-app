from django.urls import path

from .views import ConversationDetailView, ConversationListView, MessageDetailView, MessageListView, MessageMediaView, ReceiptView, PreferencesView, UnreadSummaryView
from .channel_views import DepartmentListView, ChannelListView, ChannelDetailView, ChannelMessageListView, ChannelMessageDetailView, ChannelReadView, ChannelTaskSearchView, ChannelMediaView, ChannelFollowView, ChannelUnreadView
from .channel_access_views import ChannelAccessView, ChannelManagementView, ChannelPeopleView
from .phone_views import PhoneCreateView, PhoneDetailView, PhoneApproveView, PhoneDownloadView, PhoneClaimView, PhoneUploadView, PhoneSealView
from .page_views import PageListView, PageDetailView, PageHistoryView, PageRevisionView
from .page_templates import TemplateListView, TemplateDetailView, TemplatePageView
from .page_ticket import PageTicketView

urlpatterns = [
    path("channels/<uuid:channel_id>/pages/<uuid:page_id>/ticket/", PageTicketView.as_view()),
    path("channels/<uuid:channel_id>/templates/", TemplateListView.as_view()),
    path("channels/<uuid:channel_id>/templates/<str:template_id>/", TemplateDetailView.as_view()),
    path("channels/<uuid:channel_id>/templates/<str:template_id>/pages/", TemplatePageView.as_view()),
    path("channels/<uuid:channel_id>/pages/", PageListView.as_view()),
    path("channels/<uuid:channel_id>/pages/<uuid:page_id>/", PageDetailView.as_view()),
    path("channels/<uuid:channel_id>/pages/<uuid:page_id>/history/", PageHistoryView.as_view()),
    path("channels/<uuid:channel_id>/pages/<uuid:page_id>/history/<int:version>/", PageRevisionView.as_view()),
    path("phone-transfers/", PhoneCreateView.as_view()),
    path("phone-transfers/<uuid:identity>/", PhoneDetailView.as_view()),
    path("phone-transfers/<uuid:identity>/approve/", PhoneApproveView.as_view()),
    path("phone-transfers/<uuid:identity>/seal/", PhoneSealView.as_view()),
    path("phone-transfers/<uuid:identity>/images/<uuid:image_id>/", PhoneDownloadView.as_view()),
    path("phone-transfers/<uuid:identity>/claim/", PhoneClaimView.as_view()),
    path("phone-transfers/<uuid:identity>/mobile/", PhoneUploadView.as_view()),
    path("departments/", DepartmentListView.as_view(), name="slack-departments"),
    path("channels/", ChannelListView.as_view(), name="slack-channels"),
    path("channels/unread/", ChannelUnreadView.as_view(), name="slack-unread"),
    path("channels/managed/", ChannelManagementView.as_view(), name="slack-managed-channels"),
    path("channels/people/", ChannelPeopleView.as_view(), name="slack-channel-people"),
    path("channels/<uuid:channel_id>/access/", ChannelAccessView.as_view(), name="slack-channel-access"),
    path("channels/<uuid:channel_id>/", ChannelDetailView.as_view(), name="slack-channel"),
    path("channels/<uuid:channel_id>/messages/", ChannelMessageListView.as_view(), name="slack-messages"),
    path("channels/<uuid:channel_id>/messages/<uuid:message_id>/", ChannelMessageDetailView.as_view(), name="slack-message"),
    path("channels/<uuid:channel_id>/messages/<uuid:message_id>/media/", ChannelMediaView.as_view(), name="slack-media"),
    path("channels/<uuid:channel_id>/read/", ChannelReadView.as_view(), name="slack-read"),
    path("channels/<uuid:channel_id>/following/", ChannelFollowView.as_view(), name="slack-following"),
    path("channels/<uuid:channel_id>/tasks/", ChannelTaskSearchView.as_view(), name="slack-task-search"),
    path("unread/", UnreadSummaryView.as_view(), name="messaging-unread"),
    path("preferences/", PreferencesView.as_view(), name="messaging-preferences"),
    path("conversations/", ConversationListView.as_view(), name="direct-conversations"),
    path("conversations/<uuid:conversation_id>/", ConversationDetailView.as_view(), name="direct-conversation"),
    path("conversations/<uuid:conversation_id>/messages/", MessageListView.as_view(), name="direct-messages"),
    path("conversations/<uuid:conversation_id>/receipts/", ReceiptView.as_view(), name="direct-receipts"),
    path("conversations/<uuid:conversation_id>/messages/<uuid:message_id>/", MessageDetailView.as_view(), name="direct-message"),
    path("conversations/<uuid:conversation_id>/messages/<uuid:message_id>/media/", MessageMediaView.as_view(), name="direct-message-media"),
]
