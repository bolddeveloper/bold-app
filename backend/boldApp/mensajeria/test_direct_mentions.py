"""Direct references never change the two-participant privacy boundary."""
import uuid
from datetime import timedelta
from unittest.mock import patch

from django.test import TestCase, override_settings
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.test import APIClient

from boldApp.notificaciones.models import Notification
from . import tests as base
from .models import DirectConversation, DirectMessage, ResourceMention, SearchDocument
from .mentions import prime_direct_mentions


@override_settings(MESSAGING_PILOT_ENABLED=False)
class DirectMentionTests(TestCase):
    root = base.DirectChatTests.root
    setUp = base.DirectChatTests.setUp
    identity = base.DirectChatTests.identity
    as_person = base.DirectChatTests.as_person
    open = base.DirectChatTests.open
    send = base.DirectChatTests.send
    edit = base.DirectChatTests.edit

    @property
    def token(self):
        return '@' + self.bob.employee.user_account.email

    def test_only_participants_are_selectable_even_by_an_owner(self):
        conversation = self.open()
        url = self.root + conversation + '/mention-people/'
        self.assertEqual(self.client.get(url, {'q':'bob'}).data['results'][0]['token'], self.token)
        self.assertEqual(self.client.get(url, {'q':'alice'}).data['results'][0]['employee_id'], str(self.alice.employee_id))
        self.assertEqual(self.client.get(url, {'q':'eve'}).data['results'], [])
        for outsider in (self.eve, self.owner):
            self.assertEqual(self.as_person(outsider).get(url, {'q':'bob'}).status_code, 404)
        for query in ({}, {'q':'x'}, {'q':'bob','employee_id':str(self.eve.employee_id)}):
            self.assertEqual(self.client.get(url, query).status_code, 400)
        self.assertEqual(APIClient().get(url, {'q':'bob'}).status_code, 401)

    def test_verified_reference_keeps_the_existing_single_chat_notice(self):
        conversation = self.open()
        client_id = str(uuid.uuid4())
        body = f'{self.token} {self.token.upper()} @eve@bold.gt @owner@bold.gt normal@bold.gt'
        message = self.send(conversation, body, client_id)
        self.assertEqual([r['employee_id'] for r in message['mentions']], [str(self.bob.employee_id)])
        self.assertEqual(ResourceMention.objects.count(), 1)
        notice = Notification.objects.get()
        self.assertEqual(notice.type, 'messaging.message_created')
        self.assertNotIn(self.token, notice.body)
        self.assertEqual(DirectConversation.objects.count(), 1)
        self.assertEqual(self.send(conversation, body, client_id)['id'], message['id'])
        self.assertEqual(Notification.objects.count(), 1)
        Notification.objects.all().delete()
        bob = self.as_person(self.bob)
        response = bob.patch('/api/v2/auth/notification-settings/', {'events':{'slack.mentioned':False}}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.send(conversation, self.token)
        self.assertEqual(Notification.objects.get().type, 'messaging.message_created', 'Slack mention opt-out does not silence direct chat')

    def test_edit_history_context_and_socket_projections_preserve_verified_identity(self):
        from .events import pending_event, private_event
        conversation = self.open()
        message = self.send(conversation, self.token)
        token = self.token
        account = self.bob.employee.user_account
        account.email = 'new-direct-identity@bold.gt'
        account.save(update_fields=['email'])
        edited = self.edit(conversation, message, body=token + ' con detalle')
        self.assertEqual(edited.status_code, 200, edited.data)
        self.assertEqual(edited.data['message']['mentions'][0]['employee_id'], str(self.bob.employee_id))
        self.assertEqual(Notification.objects.count(), 1, 'editing does not add a second Chat notice')
        url = self.root + conversation + '/messages/'
        self.assertEqual(self.client.get(url).data['results'][0]['mentions'], edited.data['message']['mentions'])
        context = self.client.get(url + message['id'] + '/context/')
        self.assertEqual(context.data['results'][0]['mentions'], edited.data['message']['mentions'])
        hint = {'conversation_id':conversation, 'kind':'message.updated', 'message_ids':[message['id']]}
        event = private_event(self.bob.employee_id, hint)
        self.assertEqual(event['payload']['messages'][0]['mentions'], edited.data['message']['mentions'])
        self.assertEqual(pending_event(self.bob.employee_id)['payload']['messages'][0]['mentions'], edited.data['message']['mentions'])
        self.assertIsNone(private_event(self.owner.employee_id, hint))
        self.client = self.as_person(self.bob)
        self.assertEqual(self.edit(conversation, edited.data['message']).status_code, 403)
        self.client = self.as_person(self.alice)
        DirectMessage.objects.filter(pk=message['id']).update(created_at=timezone.now()-timedelta(minutes=11))
        self.assertEqual(self.edit(conversation, edited.data['message']).status_code, 403)

    def test_forwarding_text_does_not_carry_third_party_references_or_access(self):
        source = self.send(self.open(), self.token)
        destination = self.open(self.eve)
        forwarded = self.send(destination, source['body'])
        self.assertEqual(forwarded['mentions'], [])
        self.assertEqual(ResourceMention.objects.count(), 1)
        self.assertEqual(self.as_person(self.bob).get(self.root + destination + '/').status_code, 404)

    def test_limits_reject_before_upload_and_roll_back_source_and_index(self):
        from .test_media import ChatMediaTests
        conversation = self.open()
        body = ' '.join(f'@person{i}@bold.gt' for i in range(21))
        with patch('boldApp.mensajeria.upload_outbox.attach') as upload:
            response = self.client.post(self.root + conversation + '/messages/', {'body':body,'client_id':str(uuid.uuid4())}, format='json')
        self.assertEqual(response.status_code, 400)
        upload.assert_not_called()
        self.assertFalse(DirectMessage.objects.exists())
        self.assertFalse(SearchDocument.objects.exists())
        message = self.send(conversation, 'Texto inicial')
        self.assertEqual(self.edit(conversation, message, body=body).status_code, 400)
        self.assertEqual(DirectMessage.objects.get(pk=message['id']).version, 1)

    def test_pilot_inactive_and_database_email_uniqueness_remain_fail_closed(self):
        conversation = self.open()
        url = self.root + conversation + '/mention-people/'
        with override_settings(MESSAGING_PILOT_ENABLED=True, MESSAGING_PILOT_UNIT_IDS=[str(self.unit.pk)]):
            self.assertEqual(self.client.get(url, {'q':'bob'}).status_code, 404)
        account = self.bob.employee.user_account
        account.is_active = False
        account.save(update_fields=['is_active'])
        self.assertEqual(self.client.get(url, {'q':'bob'}).data['results'], [])
        with self.assertRaises(IntegrityError), transaction.atomic():
            account.email = self.alice.employee.user_account.email.upper()
            account.save(update_fields=['email'])
        account.refresh_from_db()
        account.is_active = True
        account.save(update_fields=['is_active'])
        self.assertEqual(self.client.get(url, {'q':'BOB'}).data['results'][0]['token'], self.token)

    def test_projection_batches_fifty_messages_and_plain_messages_cost_no_query(self):
        conversation = DirectConversation.objects.get(pk=self.open())
        rows = [DirectMessage(conversation=conversation, author=self.alice.employee, client_id=uuid.uuid4(), body=self.token) for _ in range(50)]
        DirectMessage.objects.bulk_create(rows)
        docs = [SearchDocument(direct=message, text=message.body, created_at=message.created_at) for message in rows]
        SearchDocument.objects.bulk_create(docs)
        ResourceMention.objects.bulk_create([ResourceMention(document=doc,employee=self.bob.employee,token=self.token,name='bob') for doc in docs])
        with self.assertNumQueries(1):
            prime_direct_mentions(rows)
        self.assertTrue(all(row._mentions[0]['employee_id'] == str(self.bob.employee_id) for row in rows))
        for row in rows:
            row.body = 'Sin referencias'
        with self.assertNumQueries(0):
            prime_direct_mentions(rows)
