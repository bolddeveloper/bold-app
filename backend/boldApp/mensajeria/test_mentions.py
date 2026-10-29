import uuid
from datetime import timedelta
from time import process_time
from django.test import TestCase, SimpleTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from boldApp.core.models import Permission
from boldApp.notificaciones.models import Notification
from boldApp.notificaciones.consumers import notification_resource_is_readable
from . import test_channels as base
from .models import ChannelAccessRule, ChannelMessage, ChannelReadState, ChannelSubscription, ChannelThreadReadState, ResourceMention, SearchDocument
from .mentions import mention_tokens, prime_channel_mentions

readable = notification_resource_is_readable.__wrapped__


class MentionTokenTests(SimpleTestCase):
    def test_only_explicit_tokens_outside_urls_and_code(self):
        body = 'normal@bold.gt @Bob@Bold.gt. `@code@bold.gt` ```@block@bold.gt``` https://example.com/@path@bold.gt mailto:@mail@bold.gt @person+alias@bold.gt'
        self.assertEqual(mention_tokens(body), {'@bob@bold.gt', '@person+alias@bold.gt'})
        self.assertEqual(mention_tokens('x@bob@bold.gt'), set())
        self.assertEqual(mention_tokens('@bob@bold.gt.evil'), {'@bob@bold.gt.evil'})

    def test_long_plain_words_are_not_retried_as_uri_schemes(self):
        # A maximum-size page may contain one very long word and a real token.
        # CPU time avoids a wall-clock assertion affected by CI scheduling.
        body = 'a' * 100_000 + ' @persona@bold.gt'
        start = process_time()
        self.assertEqual(mention_tokens(body), {'@persona@bold.gt'})
        self.assertLess(process_time() - start, 1.0)

    def test_uri_boundary_keeps_schemes_and_literal_code_masked(self):
        body = '(HTTPS://example.com/@web@bold.gt) custom+v1://host/@custom@bold.gt\n' \
            '`@inline@bold.gt` ```\n@code@bold.gt\n``` mailto:@mail@bold.gt @persona@bold.gt'
        self.assertEqual(mention_tokens(body), {'@persona@bold.gt'})


@override_settings(MESSAGING_PILOT_ENABLED=False)
class ChannelMentionTests(TestCase):
    root = base.DepartmentChannelTests.root
    setUp = base.DepartmentChannelTests.setUp
    identity = base.DepartmentChannelTests.identity
    as_person = base.DepartmentChannelTests.as_person
    send = base.DepartmentChannelTests.send

    @property
    def token(self):
        return '@' + self.bob.employee.user_account.email

    def edit(self, message, body, version=None):
        return self.client.patch(self.url + f"messages/{message['id']}/", {'body': body, 'version': version or message['version']}, format='json')

    def test_unfollowed_person_gets_one_private_notice_without_any_grant_or_read(self):
        token = str(uuid.uuid4())
        response = self.send('Revisión reservada ' + self.token + ' ' + self.token.upper(), client_id=token)
        self.assertEqual(response.status_code, 201, response.data)
        message = response.data['message']
        self.assertEqual(len(message['mentions']), 1)
        self.assertEqual(message['mentions'][0]['employee_id'], str(self.bob.employee_id))
        notice = Notification.objects.get()
        self.assertEqual(notice.type, 'slack.mentioned')
        self.assertEqual(notice.route['parent_id'], message['id'])
        self.assertNotIn('reservada', notice.title + notice.body)
        self.assertTrue(readable(str(self.bob.pk), str(notice.pk)))
        self.assertFalse(ChannelSubscription.objects.exists())
        self.assertFalse(ChannelAccessRule.objects.exists())
        self.assertFalse(ChannelReadState.objects.exists())
        self.assertFalse(ChannelThreadReadState.objects.exists())
        self.send('Revisión reservada ' + self.token + ' ' + self.token.upper(), client_id=token)
        self.assertEqual(Notification.objects.count(), 1)
        self.assertEqual(ResourceMention.objects.count(), 1)

    def test_private_boundary_owner_is_not_exception_and_revocation_blocks_delivery(self):
        channel = self.channel()
        channel.visibility = 'private'
        channel.save()
        ChannelAccessRule.objects.create(channel=channel, employee=self.alice.employee, access='write')
        message = self.send(self.token).data['message']
        self.assertEqual(message['mentions'], [])
        self.assertFalse(Notification.objects.exists())
        self.assertEqual(self.client.get(self.url + 'mention-people/', {'q': 'bob'}).data['results'], [])
        owner = self.as_person(self.owner)
        self.assertEqual(owner.get(self.url + 'mention-people/', {'q': 'alice'}).status_code, 404)
        rule = ChannelAccessRule.objects.create(channel=channel, employee=self.bob.employee, access='read')
        allowed = self.client.get(self.url + 'mention-people/', {'q': 'bob'})
        self.assertEqual(allowed.status_code, 200)
        self.assertEqual(allowed.data['results'][0]['employee_id'], str(self.bob.employee_id))
        self.send(self.token)
        notice = Notification.objects.get()
        self.assertTrue(readable(str(self.bob.pk), str(notice.pk)))
        rule.delete()
        self.assertFalse(readable(str(self.bob.pk), str(notice.pk)))

    def channel(self):
        from .models import DepartmentChannel
        return DepartmentChannel.objects.get(pk=self.channel_id)

    def test_personal_preference_fallback_follow_dedup_and_unfollow_preserves_mentions(self):
        bob = self.as_person(self.bob)
        bob.put(self.url + 'following/', {'following': True}, format='json')
        self.send(self.token)
        first = Notification.objects.get()
        self.assertEqual(first.type, 'slack.mentioned')
        bob.put(self.url + 'following/', {'following': False}, format='json')
        first.refresh_from_db()
        self.assertFalse(first.is_read, 'channel opt-out does not dismiss independent mention notices')
        response = bob.patch('/api/v2/auth/notification-settings/', {'events': {'slack.mentioned': False}}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(readable(str(self.bob.pk), str(first.pk)))
        self.send(self.token)
        self.assertEqual(Notification.objects.count(), 1)
        bob.put(self.url + 'following/', {'following': True}, format='json')
        self.send(self.token)
        self.assertEqual(Notification.objects.order_by('-created_at').first().type, 'slack.message_created')
        bob.patch('/api/v2/auth/notification-settings/', {'events': {'slack.mentioned': True, 'slack.message_created': False}}, format='json')
        message = self.send(self.token).data['message']
        notice = Notification.objects.order_by('-created_at').first()
        self.assertEqual(notice.type, 'slack.mentioned')
        bob.post(self.url + 'read/', {'message_id': message['id']}, format='json')
        notice.refresh_from_db()
        self.assertTrue(notice.is_read)

    def test_edit_adds_a_new_mention_but_remove_readd_never_spams(self):
        message = self.send('Sin mención').data['message']
        response = self.edit(message, 'Con mención ' + self.token)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(Notification.objects.count(), 1)
        notice = Notification.objects.get()
        response = self.edit(response.data['message'], 'De nuevo sin mención')
        self.assertEqual(response.data['message']['mentions'], [])
        self.assertFalse(readable(str(self.bob.pk), str(notice.pk)))
        response = self.edit(response.data['message'], self.token)
        self.assertEqual(Notification.objects.count(), 1)
        self.assertTrue(readable(str(self.bob.pk), str(notice.pk)))
        self.client = self.as_person(self.bob)
        self.assertEqual(self.edit(response.data['message'], 'Edición ajena').status_code, 403)
        self.client = self.as_person(self.alice)
        ChannelMessage.objects.filter(pk=message['id']).update(created_at=timezone.now()-timedelta(minutes=11))
        self.assertEqual(self.edit(response.data['message'], 'Fuera de plazo').status_code, 403)

    def test_reference_survives_email_rename_and_source_removal_cascades(self):
        token = self.token
        message = self.send(token).data['message']
        account = self.bob.employee.user_account
        account.email = 'renamed-channel-test@bold.gt'
        account.save(update_fields=['email'])
        response = self.edit(message, token + ' con contexto adicional')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['message']['mentions'][0]['employee_id'], str(self.bob.employee_id))
        self.assertEqual(Notification.objects.count(), 1)
        ChannelMessage.objects.get(pk=message['id']).delete()
        self.assertFalse(ResourceMention.objects.exists())

    def test_typed_unknown_code_url_and_self_mentions_do_not_send_notices(self):
        body = f'@missing@bold.gt `{self.token}` https://example.com/{self.token} @{self.alice.employee.user_account.email}'
        message = self.send(body).data['message']
        self.assertEqual(len(message['mentions']), 1, 'only the authorized self reference is stored')
        self.assertFalse(Notification.objects.exists())
        self.assertEqual(self.send(' '.join(f'@person{i}@bold.gt' for i in range(21))).status_code, 400)
        self.assertEqual(ChannelMessage.objects.count(), 1, 'validation rolls back the source and index')

    def test_picker_strict_input_current_mfa_and_pilot(self):
        url = self.url + 'mention-people/'
        for query in ({}, {'q':'x'}, {'q':'bob', 'employee_id':str(self.owner.employee_id)}):
            self.assertEqual(self.client.get(url, query).status_code, 400)
        self.assertEqual(APIClient().get(url, {'q':'bob'}).status_code, 401)
        with override_settings(MESSAGING_PILOT_ENABLED=True, MESSAGING_PILOT_UNIT_IDS=[str(self.it.pk)]):
            self.assertEqual(self.client.get(url, {'q':'bob'}).data['results'], [])
            self.assertEqual(self.send(self.token).data['message']['mentions'], [])
        permission = Permission.objects.get(code='slack.channel.read')
        permission.requires_step_up_mfa = True
        permission.save()
        self.assertEqual(self.client.get(url, {'q':'bob'}).status_code, 404)

    def test_fifty_message_flags_use_one_query_and_plain_text_uses_none(self):
        now = timezone.now()
        rows = [ChannelMessage(channel_id=self.channel_id, author=self.alice.employee, author_assignment=self.alice,
            department_name='IT', department_color='#4760A8', client_id=uuid.uuid4(), payload_digest='x'*64,
            sequence=i+1, body=self.token) for i in range(50)]
        ChannelMessage.objects.bulk_create(rows)
        docs = [SearchDocument(channel_message=message, text=message.body, created_at=now) for message in rows]
        SearchDocument.objects.bulk_create(docs)
        ResourceMention.objects.bulk_create([ResourceMention(document=doc, employee=self.bob.employee, token=self.token, name='bob') for doc in docs])
        with self.assertNumQueries(1):
            prime_channel_mentions(rows)
        self.assertTrue(all(row._mentions[0]['employee_id'] == str(self.bob.employee_id) for row in rows))
        for row in rows:
            row.body = 'Texto sin menciones'
        with self.assertNumQueries(0):
            prime_channel_mentions(rows)
