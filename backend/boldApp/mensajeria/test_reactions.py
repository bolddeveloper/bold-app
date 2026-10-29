import uuid
from datetime import timedelta
from unittest.mock import AsyncMock, patch
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from boldApp.core.models import Permission
from boldApp.notificaciones.models import Notification
from . import test_saved_items as fixtures
from .models import ChannelAccessRule, DepartmentChannel, MessageReaction, ReactionActorState, SearchDocument, ChannelReadState, ChannelThreadReadState
from .reactions import CATALOG, prime_reactions, reaction_data


@override_settings(MESSAGING_PILOT_ENABLED=False)
class ReactionTests(TestCase):
    root=fixtures.SavedItemTests.root
    identity=fixtures.SavedItemTests.identity
    as_person=fixtures.SavedItemTests.as_person
    blocks=fixtures.SavedItemTests.blocks
    deny=fixtures.SavedItemTests.deny
    direct=fixtures.SavedItemTests.direct
    channel_message=fixtures.SavedItemTests.channel_message
    setUp=fixtures.SavedItemTests.setUp

    def endpoint(self, message, kind='chat'):
        return f'/api/v2/messaging/{"conversations" if kind=="chat" else "channels"}/{message.conversation_id if kind=="chat" else message.channel_id}/messages/{message.pk}/reactions/'

    def state(self, message, kind='chat', client=None):
        response=(client or self.client).get(self.endpoint(message,kind))
        self.assertEqual(response.status_code,200,response.data)
        self.assertIn('no-store',response['Cache-Control'])
        return response.data

    def react(self, message, kind='chat', client=None, **overrides):
        data={'key':'thumbs_up','active':True,'version':self.state(message,kind,client)['reactions']['own_version'],'client_id':str(uuid.uuid4()),**overrides}
        return (client or self.client).put(self.endpoint(message,kind),data,format='json')

    def test_two_people_share_count_but_each_can_remove_only_their_own(self):
        message=self.direct('Texto privado')
        alice=self.react(message);bob=self.as_person(self.bob)
        self.assertEqual(alice.status_code,200,alice.data)
        both=self.react(message,client=bob)
        self.assertEqual(both.status_code,200,both.data)
        self.assertEqual(both.data['reactions']['items'][0]['count'],2)
        removed=self.react(message,active=False)
        self.assertEqual(removed.status_code,200,removed.data)
        item=removed.data['reactions']['items'][0]
        self.assertEqual((item['count'],item['mine']),(1,False))
        self.assertTrue(self.state(message,client=bob)['reactions']['items'][0]['mine'])
        self.assertEqual(self.react(message,employee_id=str(self.bob.employee_id)).status_code,400)
        self.assertEqual(MessageReaction.objects.count(),1)

    def test_old_messages_accept_reactions_without_edit_or_receipt_side_effects(self):
        message=self.direct('Antiguo')
        message.created_at=timezone.now()-timedelta(days=5);message.delivered_at=message.read_at=timezone.now();message.save()
        before=(message.body,message.version,message.created_at,message.edited_at,message.read_at,message.delivered_at)
        result=self.react(message)
        self.assertEqual(result.status_code,200,result.data)
        message.refresh_from_db();self.chat.refresh_from_db()
        self.assertEqual((message.body,message.version,message.created_at,message.edited_at,message.read_at,message.delivered_at),before)
        self.assertEqual(self.chat.activity_version,0)
        self.assertFalse(Notification.objects.exists())
        self.assertFalse(ChannelReadState.objects.exists());self.assertFalse(ChannelThreadReadState.objects.exists())

    def test_images_and_voice_react_without_copying_or_contacting_drive(self):
        from boldApp.workspace.models import ImageStorageRoot
        from .models import MessageMedia
        root=ImageStorageRoot.objects.create(user=self.alice.employee.user_account,subject='reaction-test',client_id='synthetic',
            google_email='drive@example.invalid',folder_id='private-test-root',folder_name='Pruebas',active=True)
        with patch('boldApp.mensajeria.media.google') as drive:
            for kind,mime in [('image','image/webp'),('audio','audio/webm')]:
                message=self.direct('')
                MessageMedia.objects.create(message=message,root=root,drive_id='NEVER-EXPOSE',kind=kind,mime_type=mime,size_bytes=100,digest='a'*64)
                result=self.react(message)
                self.assertEqual(result.status_code,200,result.data)
                self.assertNotIn('NEVER-EXPOSE',str(result.data))
            drive.assert_not_called()
        self.assertEqual(MessageMedia.objects.count(),2)

    def test_retry_noop_changed_payload_and_stale_resurrection(self):
        message=self.direct('Reintento');token=str(uuid.uuid4())
        first=self.react(message,client_id=token,version=0)
        self.assertEqual(first.status_code,200,first.data)
        self.assertEqual(self.react(message,client_id=token,version=0).data,first.data)
        self.assertEqual(self.react(message,client_id=token,version=0,key='heart').status_code,409)
        no_op=self.react(message)
        self.assertEqual(no_op.data['reactions']['version'],1)
        cleared=self.react(message,active=False)
        self.assertEqual(cleared.data['reactions']['version'],2)
        self.assertEqual(self.react(message,client_id=token,version=0).status_code,409)
        self.assertEqual(self.state(message)['reactions']['items'],[])
        self.assertEqual(ReactionActorState.objects.count(),1)

    def test_other_person_changes_do_not_conflict_with_my_actor_clock(self):
        message=self.direct('Independiente')
        self.react(message,client=self.as_person(self.bob))
        result=self.react(message,version=0)
        self.assertEqual(result.status_code,200,result.data)
        self.assertEqual(result.data['reactions']['version'],2)

    def test_private_conversation_has_no_owner_bypass_and_source_ids_are_bound(self):
        message=self.direct('Privado');owner=self.as_person(self.owner)
        self.assertEqual(owner.get(self.endpoint(message)).status_code,404)
        self.assertEqual(APIClient().get(self.endpoint(message)).status_code,401)
        channel=self.channel_message('Otro ámbito')
        bad=self.endpoint(message).replace(str(message.pk),str(channel.pk))
        self.assertEqual(self.client.get(bad).status_code,404)
        with override_settings(MESSAGING_PILOT_ENABLED=True,MESSAGING_PILOT_UNIT_IDS=[]):
            self.assertEqual(self.client.get(self.endpoint(message)).status_code,403)

    def test_channel_roots_and_replies_obey_private_readonly_revocation_and_archive(self):
        root=self.channel_message('Raíz');reply=self.channel_message('Hilo',parent=root)
        DepartmentChannel.objects.filter(pk=self.channel_id).update(visibility='private')
        bob=self.as_person(self.bob);owner=self.as_person(self.owner)
        self.assertEqual(owner.get(self.endpoint(root,'channel')).status_code,404)
        rule=ChannelAccessRule.objects.create(channel_id=self.channel_id,employee=self.bob.employee,access='read')
        self.assertFalse(self.state(root,'channel',bob)['can_change'])
        self.assertEqual(self.react(root,'channel',bob).status_code,403)
        rule.access='write';rule.save()
        self.assertEqual(self.react(reply,'channel',bob).status_code,200)
        rule.access='blocked';rule.save()
        self.assertEqual(bob.get(self.endpoint(reply,'channel')).status_code,404)
        ChannelAccessRule.objects.create(channel_id=self.channel_id,employee=self.alice.employee,access='write')
        DepartmentChannel.objects.filter(pk=self.channel_id).update(archived_at=timezone.now())
        self.assertFalse(self.state(root,'channel')['can_change'])
        self.assertEqual(self.react(root,'channel').status_code,403)

    def test_configurable_reaction_permission_is_distinct_and_obeys_mfa(self):
        message=self.channel_message('Permisos')
        self.deny('slack.message.create')
        self.assertEqual(self.react(message,'channel').status_code,200)
        permission=Permission.objects.get(code='slack.reaction.create')
        permission.requires_step_up_mfa=True;permission.save()
        self.assertFalse(self.state(message,'channel')['can_change'])
        self.assertEqual(self.react(message,'channel',active=False).status_code,403)
        permission.requires_step_up_mfa=False;permission.save()
        self.deny('slack.reaction.create')
        self.assertEqual(self.react(message,'channel',active=False).status_code,403)

    def test_catalog_limit_strict_payload_and_atomic_overflow(self):
        message=self.direct('Límite')
        for key, *_ in CATALOG[:8]:
            self.assertEqual(self.react(message,key=key).status_code,200)
        self.assertEqual(self.react(message,key=CATALOG[8][0]).status_code,400)
        self.assertEqual(MessageReaction.objects.count(),8)
        self.assertEqual(self.state(message)['reactions']['version'],8)
        self.assertEqual(self.react(message,key='unknown').status_code,400)
        self.assertEqual(self.react(message,body='otra cosa').status_code,400)
        self.assertEqual(self.react(message,key=CATALOG[0][0],active=False).status_code,200)
        self.assertEqual(self.react(message,key=CATALOG[8][0]).status_code,200)

    def test_history_context_and_projection_are_batched_and_content_reindex_keeps_clock(self):
        messages=[self.direct(f'Mensaje {n}') for n in range(12)]
        self.react(messages[0])
        with self.assertNumQueries(3):
            prime_reactions(messages,'direct',self.alice.employee_id)
            self.assertTrue(reaction_data(messages[0],'direct',self.alice.employee_id)['items'][0]['mine'])
        messages[0].body='Editado sin perder reacción';messages[0].save()
        context=self.client.get(self.endpoint(messages[0]).replace('/reactions/','/context/'))
        self.assertEqual(context.status_code,200,context.data)
        row=next(row for row in context.data['results'] if row['id']==str(messages[0].pk))
        self.assertEqual(row['reactions']['version'],1)
        self.assertEqual(self.state(messages[1])['reactions']['items'],[],'new copies have their own state')
        messages[0].delete()
        self.assertFalse(MessageReaction.objects.exists());self.assertFalse(ReactionActorState.objects.exists())

    def test_push_is_only_reaction_metadata_and_rechecks_participants(self):
        from .events import private_event
        message=self.direct('Never include private body in this event')
        with patch('boldApp.mensajeria.events.get_channel_layer') as layer:
            layer.return_value.group_send=AsyncMock()
            with self.captureOnCommitCallbacks(execute=True):
                self.react(message)
            self.assertEqual(layer.return_value.group_send.call_count,2)
        event={'conversation_id':str(self.chat.pk),'message_ids':[str(message.pk)],'kind':'reactions.updated'}
        result=private_event(self.bob.employee_id,event)
        self.assertEqual(result['event_type'],'messaging.reactions.updated')
        self.assertEqual(set(result['payload']),{'conversation_id','reactions'})
        self.assertNotIn(message.body,str(result))
        self.assertFalse(result['payload']['reactions'][0]['reactions']['items'][0]['mine'])
        self.assertIsNone(private_event(self.owner.employee_id,event))
