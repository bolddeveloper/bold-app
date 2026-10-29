import uuid
from asgiref.sync import async_to_sync
from channels.db import database_sync_to_async
from channels.layers import get_channel_layer
from django.test import TransactionTestCase,override_settings
from django.utils import timezone
from boldApp.notificaciones.tests.socket_helpers import receive_event
from . import test_realtime as base
from .models import DirectMessage


@override_settings(MESSAGING_PILOT_ENABLED=False)
class ReactionSocketTests(TransactionTestCase):
    setUp=base.RealtimeChatTests.setUp
    client_for=base.RealtimeChatTests.client_for
    socket_for=base.RealtimeChatTests.socket_for
    no_chat=base.RealtimeChatTests.no_chat

    def test_same_socket_two_participants_get_counts_without_message_receipt_or_notice(self):
        message=DirectMessage.objects.create(conversation=self.conversation,author_id=self.people[0][0].employee_id,
            client_id=uuid.uuid4(),body='Private source text must not be in the reaction event',delivered_at=timezone.now(),read_at=timezone.now())
        sockets=[self.socket_for(index) for index in range(3)]
        url=self.root+f'messages/{message.pk}/reactions/'
        async def scenario():
            try:
                for socket in sockets:
                    self.assertTrue((await socket.connect())[0]);await receive_event(socket,'control.ready')
                result=await database_sync_to_async(lambda:self.client_for(0).put(url,{
                    'key':'heart','active':True,'version':0,'client_id':str(uuid.uuid4())},format='json'))()
                self.assertEqual(result.status_code,200,result.data)
                for index in (0,1):
                    event=await receive_event(sockets[index],'messaging.reactions.updated')
                    self.assertEqual(set(event['payload']),{'conversation_id','reactions'})
                    item=event['payload']['reactions'][0]['reactions']['items'][0]
                    self.assertEqual((item['count'],item['mine']),(1,index==0))
                    self.assertNotIn(message.body,str(event))
                    await self.no_chat(sockets[index])
                await get_channel_layer().group_send(f'messaging_employee_{self.people[2][0].employee_id}',{
                    'type':'messaging.changed','kind':'reactions.updated','conversation_id':str(self.conversation.pk),'message_ids':[str(message.pk)]})
                await self.no_chat(sockets[2])
            finally:
                for socket in sockets:await socket.disconnect()
        async_to_sync(scenario)()
