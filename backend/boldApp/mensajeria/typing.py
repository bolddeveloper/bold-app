from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from rest_framework.response import Response
from .views import PrivateChatView
from .events import _conversations
from boldApp.core.events import build_event_envelope


class TypingView(PrivateChatView):
    def post(self, request, conversation_id):
        conversation = self.conversation(conversation_id)
        actor = self.actor()
        peer = conversation.second_employee_id if conversation.first_employee_id == actor else conversation.first_employee_id
        layer = get_channel_layer()
        if layer:
            async_to_sync(layer.group_send)(f"messaging_employee_{peer}", {"type":"messaging.typing", "conversation_id":str(conversation.pk), "author_id":str(actor)})
        return Response(status=204)


def typing_event(employee_id, event):
    conversation = _conversations(employee_id).filter(pk=event["conversation_id"]).first()
    if not conversation or event["author_id"] == str(employee_id) or event["author_id"] not in (str(conversation.first_employee_id),str(conversation.second_employee_id)):
        return None
    return build_event_envelope("messaging.typing", "direct_conversation", conversation.pk, {"conversation_id":str(conversation.pk), "author_id":event["author_id"]})
