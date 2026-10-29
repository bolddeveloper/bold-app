from django.urls import path

from .views import ConversationDetailView, ConversationListView, MessageDetailView, MessageListView, MessageMediaView, ReceiptView, PreferencesView, UnreadSummaryView
from .channel_views import DepartmentListView, ChannelListView, ChannelDetailView, ChannelMessageListView, ChannelMessageDetailView, ChannelReadView, ChannelTaskSearchView, ChannelMediaView, ChannelFollowView, ChannelUnreadView
from .channel_access_views import ChannelAccessView, ChannelManagementView, ChannelPeopleView
from .phone_views import PhoneCreateView, PhoneDetailView, PhoneApproveView, PhoneDownloadView, PhoneClaimView, PhoneUploadView, PhoneSealView
from .page_views import PageListView, PageDetailView, PageHistoryView, PageRevisionView
from .page_structure_views import PageStructureView, PageParentOptionsView
from .page_link_views import PageLinkOptionsView, PageBacklinksView
from .page_discussion_views import PageDiscussionSummaryView, PageDiscussionListView, PageDiscussionCommentsView, PageDiscussionResolveView, PageDiscussionCommentView, PageDiscussionDeleteView
from .page_templates import TemplateListView, TemplateDetailView, TemplatePageView
from .page_ticket import PageTicketView
from .draft_grants import DraftGrantView
from .search_views import HistorySearchView, DirectMessageContextView, ChannelMessageContextView
from .resource_views import ResourceLibraryView
from .upload_views import MediaUploadView,MediaUploadDiscardView
from .personal_views import SavedItemView
from .thread_views import ThreadFollowView
from .mention_views import ChannelMentionPeopleView, DirectMentionPeopleView, PageMentionPeopleView
from .reading_views import ReadingReminderView, ReadingReminderClearView
from .reaction_views import DirectReactionView, ChannelReactionView
from .task_conversion_views import MessageTasksView, TaskConversionProjectsView
from .agreement_views import AgreementDestinationsView, AgreementReviewView, AgreementCreateView
from .automation_views import AutomationListView, AutomationDetailView, AutomationHistoryView, AutomationAuditView, AutomationProjectsView

urlpatterns = [
    path('channels/<uuid:channel_id>/automation-projects/', AutomationProjectsView.as_view()),
    path('channels/<uuid:channel_id>/automation-projects/<uuid:project_id>/', AutomationProjectsView.as_view()),
    path('channels/<uuid:channel_id>/automations/', AutomationListView.as_view()),
    path('channels/<uuid:channel_id>/automations/<uuid:rule_id>/', AutomationDetailView.as_view()),
    path('channels/<uuid:channel_id>/automations/<uuid:rule_id>/runs/', AutomationHistoryView.as_view()),
    path('channels/<uuid:channel_id>/automations/<uuid:rule_id>/audit/', AutomationAuditView.as_view()),
    path("conversations/<uuid:container_id>/uploads/discard/", MediaUploadDiscardView.as_view(), {"kind":"chat"}),
    path("channels/<uuid:container_id>/uploads/discard/", MediaUploadDiscardView.as_view(), {"kind":"channel"}),
    path("conversations/<uuid:container_id>/uploads/", MediaUploadView.as_view(), {"kind":"chat"}),
    path("conversations/<uuid:container_id>/uploads/<uuid:upload_id>/", MediaUploadView.as_view(), {"kind":"chat"}),
    path("channels/<uuid:container_id>/uploads/", MediaUploadView.as_view(), {"kind":"channel"}),
    path("channels/<uuid:container_id>/uploads/<uuid:upload_id>/", MediaUploadView.as_view(), {"kind":"channel"}),
    path("conversations/<uuid:container_id>/library/", ResourceLibraryView.as_view(), {"kind": "chat"}),
    path("channels/<uuid:container_id>/library/", ResourceLibraryView.as_view(), {"kind": "channel"}),
    path("agreement-destinations/", AgreementDestinationsView.as_view()),
    path("agreement-destinations/<uuid:channel_id>/", AgreementDestinationsView.as_view()),
    path("conversations/<uuid:container_id>/agreement-review/", AgreementReviewView.as_view(), {"kind":"chat"}),
    path("channels/<uuid:container_id>/agreement-review/", AgreementReviewView.as_view(), {"kind":"channel"}),
    path("conversations/<uuid:container_id>/agreements/", AgreementCreateView.as_view(), {"kind":"chat"}),
    path("channels/<uuid:container_id>/agreements/", AgreementCreateView.as_view(), {"kind":"channel"}),
    path("task-conversion-projects/", TaskConversionProjectsView.as_view()),
    path("task-conversion-projects/<uuid:project_id>/", TaskConversionProjectsView.as_view()),
    path("conversations/<uuid:container_id>/messages/<uuid:message_id>/tasks/", MessageTasksView.as_view(), {"kind":"chat"}),
    path("channels/<uuid:container_id>/messages/<uuid:message_id>/tasks/", MessageTasksView.as_view(), {"kind":"channel"}),
    path("conversations/<uuid:conversation_id>/messages/<uuid:message_id>/reactions/", DirectReactionView.as_view(http_method_names=["get", "put", "options"])),
    path("channels/<uuid:channel_id>/messages/<uuid:message_id>/reactions/", ChannelReactionView.as_view(http_method_names=["get", "put", "options"])),
    path("reading-reminders/", ReadingReminderView.as_view(http_method_names=["get", "put", "options"])),
    path("reading-reminders/<uuid:reminder_id>/", ReadingReminderClearView.as_view(http_method_names=["put", "options"])),
    path("channels/<uuid:channel_id>/pages/<uuid:page_id>/mention-people/", PageMentionPeopleView.as_view()),
    path("conversations/<uuid:conversation_id>/mention-people/", DirectMentionPeopleView.as_view()),
    path("channels/<uuid:channel_id>/mention-people/", ChannelMentionPeopleView.as_view()),
    path("channels/<uuid:channel_id>/messages/<uuid:message_id>/following/", ThreadFollowView.as_view()),
    path("saved-items/", SavedItemView.as_view(http_method_names=["put", "options"])),
    path("saved-items/<uuid:document_id>/", SavedItemView.as_view(http_method_names=["delete", "options"])),
    path("search/", HistorySearchView.as_view(), name="messaging-history-search"),
    path("conversations/<uuid:conversation_id>/messages/<uuid:message_id>/context/", DirectMessageContextView.as_view()),
    path("channels/<uuid:channel_id>/messages/<uuid:message_id>/context/", ChannelMessageContextView.as_view()),
    path("draft-grants/", DraftGrantView.as_view(), name="messaging-draft-grant"),
    path("channels/<uuid:channel_id>/pages/<uuid:page_id>/ticket/", PageTicketView.as_view()),
    path("channels/<uuid:channel_id>/templates/", TemplateListView.as_view()),
    path("channels/<uuid:channel_id>/templates/<str:template_id>/", TemplateDetailView.as_view()),
    path("channels/<uuid:channel_id>/templates/<str:template_id>/pages/", TemplatePageView.as_view()),
    path("channels/<uuid:channel_id>/pages/", PageListView.as_view()),
    path("channels/<uuid:channel_id>/pages/<uuid:page_id>/structure/", PageStructureView.as_view()),
    path("channels/<uuid:channel_id>/pages/<uuid:page_id>/link-options/", PageLinkOptionsView.as_view()),
    path("channels/<uuid:channel_id>/pages/<uuid:page_id>/backlinks/", PageBacklinksView.as_view()),
    path("channels/<uuid:channel_id>/pages/<uuid:page_id>/discussions/summary/", PageDiscussionSummaryView.as_view()),
    path("channels/<uuid:channel_id>/pages/<uuid:page_id>/discussions/", PageDiscussionListView.as_view()),
    path("channels/<uuid:channel_id>/pages/<uuid:page_id>/discussions/<uuid:thread_id>/comments/", PageDiscussionCommentsView.as_view()),
    path("channels/<uuid:channel_id>/pages/<uuid:page_id>/discussions/<uuid:thread_id>/resolution/", PageDiscussionResolveView.as_view()),
    path("channels/<uuid:channel_id>/pages/<uuid:page_id>/discussion-comments/<uuid:comment_id>/", PageDiscussionCommentView.as_view()),
    path("channels/<uuid:channel_id>/pages/<uuid:page_id>/discussion-comments/<uuid:comment_id>/delete/", PageDiscussionDeleteView.as_view()),
    path("channels/<uuid:channel_id>/pages/<uuid:page_id>/parent-options/", PageParentOptionsView.as_view()),
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
