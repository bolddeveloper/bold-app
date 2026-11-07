from uuid import uuid4

from django.test import TestCase, override_settings

from . import test_channels as base
from .channel_access import ChannelPolicy
from .channel_events import channel_event
from .models import ChannelAccessEpoch, ChannelMessage, ChannelPage, DepartmentChannel, PrivateServer, PrivateServerMember


@override_settings(MESSAGING_PILOT_ENABLED=False)
class ChannelDeletionTests(TestCase):
    root = base.DepartmentChannelTests.root
    setUp = base.DepartmentChannelTests.setUp
    identity = base.DepartmentChannelTests.identity
    as_person = base.DepartmentChannelTests.as_person
    deny = base.DepartmentChannelTests.deny
    send = base.DepartmentChannelTests.send

    def remove(self, url=None, version=1):
        return self.client.delete(url or self.url, {'version':version}, format='json')

    def test_delete_preserves_content_and_revokes_lists_direct_urls_and_owner_access(self):
        message = self.send().data['message']
        page = ChannelPage.objects.create(channel_id=self.channel_id, creator=self.alice.employee,
            updated_by=self.alice.employee, client_id=uuid4(), creation_digest='test', title='Conservar página')
        self.assertEqual(self.remove().status_code, 204)
        channel = DepartmentChannel.objects.get(pk=self.channel_id)
        self.assertIsNotNone(channel.deleted_at)
        self.assertEqual(channel.version, 2)
        self.assertTrue(ChannelMessage.objects.filter(pk=message['id']).exists())
        self.assertTrue(ChannelPage.objects.filter(pk=page.pk).exists())
        for person in (self.alice, self.bob, self.owner):
            client = self.as_person(person)
            for suffix in ('', '?archived=true', 'managed/'):
                self.assertNotIn(self.channel_id, [row['id'] for row in client.get(self.root+suffix).data['results']])
            for suffix in ('', 'messages/', 'pages/', 'access/', 'threads/'):
                self.assertEqual(client.get(self.url+suffix).status_code, 404, suffix)
            self.assertEqual(client.post(self.url+'messages/', {'client_id':str(uuid4()), 'body':'No'}, format='json').status_code, 404)
            self.assertFalse(ChannelPolicy(person).allows('slack.channel.read', self.it, self.channel_id))
            policy = ChannelPolicy(person)
            policy.prime([channel])
            self.assertFalse(policy.allows('slack.channel.access', self.it, self.channel_id))
            self.assertIsNone(channel_event(person.pk, {'channel_id':self.channel_id, 'kind':'message.created'}))
            self.assertGreater(ChannelAccessEpoch.objects.get(employee_id=person.employee_id).revision, 0)
        self.assertEqual(self.remove(version=2).status_code, 404)

    def test_delete_requires_current_version_and_management_permission(self):
        self.assertEqual(self.client.delete(self.url).status_code, 400)
        self.assertEqual(self.remove(version=9).status_code, 409)
        self.assertIsNone(DepartmentChannel.objects.get(pk=self.channel_id).deleted_at)
        self.deny('slack.channel.manage')
        self.assertEqual(self.remove().status_code, 403)
        self.assertIsNone(DepartmentChannel.objects.get(pk=self.channel_id).deleted_at)

    def test_deleted_names_can_be_reused_in_department_independent_and_server_scopes(self):
        server = PrivateServer.objects.create(name='Personal', creator=self.alice)
        PrivateServerMember.objects.create(server=server, employee=self.alice.employee, access='write')
        scopes = ({'unit_id':str(self.it.pk)}, {}, {'server_id':str(server.pk)})
        for scope in scopes:
            with self.subTest(scope=scope):
                created = self.client.post(self.root, {'name':'Reutilizable', **scope}, format='json')
                self.assertEqual(created.status_code, 201, created.data)
                channel_id = created.data['id']
                self.assertEqual(self.remove(self.root+channel_id+'/').status_code, 204)
                result = self.client.post(self.root, {'name':'reutilizable', **scope}, format='json')
                self.assertEqual(result.status_code, 201, result.data)
                self.assertNotEqual(result.data['id'], channel_id)
                self.assertTrue(DepartmentChannel.objects.filter(pk=channel_id).exists())
        self.assertTrue(PrivateServer.objects.filter(pk=server.pk, deleted_at__isnull=True).exists())

    def test_private_server_channel_only_its_creator_can_manage_and_other_channels_remain(self):
        server = PrivateServer.objects.create(name='Personal', creator=self.alice)
        for person in (self.alice, self.bob):
            PrivateServerMember.objects.create(server=server, employee=person.employee, access='write')
        channel = DepartmentChannel.objects.create(server=server, name='Eliminar', visibility='private', creator=self.alice)
        other = DepartmentChannel.objects.create(server=server, name='Conservar', visibility='private', creator=self.alice)
        url = self.root+str(channel.pk)+'/'
        self.assertEqual(self.as_person(self.bob).delete(url, {'version':1}, format='json').status_code, 403)
        self.assertEqual(self.as_person(self.owner).delete(url, {'version':1}, format='json').status_code, 404)
        self.assertEqual(self.remove(url).status_code, 204)
        self.assertEqual(self.as_person(self.bob).get(url).status_code, 404)
        self.assertEqual(self.as_person(self.bob).get(self.root+str(other.pk)+'/').status_code, 200)
        self.assertGreater(ChannelAccessEpoch.objects.get(employee_id=self.bob.employee_id).revision, 0)
