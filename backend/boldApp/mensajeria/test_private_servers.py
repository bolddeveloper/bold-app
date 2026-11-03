import uuid

from django.test import TestCase, override_settings
from boldApp.core.authorization import resolve_access
from boldApp.core.models import Permission
from . import test_channels as base
from .channel_events import channel_event
from .models import ChannelAccessEpoch, PrivateServer, DepartmentChannel


@override_settings(MESSAGING_PILOT_ENABLED=False)
class PrivateServerTests(TestCase):
    root = base.DepartmentChannelTests.root
    setUp = base.DepartmentChannelTests.setUp
    identity = base.DepartmentChannelTests.identity
    as_person = base.DepartmentChannelTests.as_person
    deny = base.DepartmentChannelTests.deny
    servers = '/api/v2/messaging/servers/'

    def create(self, name='Equipo privado', access='write'):
        response = self.client.post(self.servers, {'name':name, 'members':[
            {'employee_id':str(self.bob.employee_id),'access':access}]}, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        server = response.data
        result = self.client.post(self.root, {'name':'general','server_id':server['id']}, format='json')
        self.assertEqual(result.status_code, 201, result.data)
        return server, result.data, self.root + result.data['id'] + '/'

    def test_private_boundary_in_lists_direct_urls_push_and_core(self):
        server, channel, url = self.create()
        outsider = self.as_person(self.owner)
        self.assertEqual(outsider.get(self.servers).data['results'], [])
        self.assertEqual(outsider.get(self.servers + server['id'] + '/').status_code,404)
        self.assertNotIn(channel['id'], [row['id'] for row in outsider.get(self.root).data['results']])
        self.assertEqual(outsider.get(url).status_code,404)
        self.assertEqual(outsider.get(url+'messages/').status_code,404)
        self.assertIsNone(channel_event(self.owner.pk, {'channel_id':channel['id'],'kind':'message.created'}))
        self.assertFalse(resolve_access(self.owner, Permission.objects.get(code='slack.channel.read'), self.marketing, resource_id=channel['id']).allowed)
        peer = self.as_person(self.bob)
        self.assertEqual(peer.get(url).status_code,200)
        sent = peer.post(url+'messages/',{'body':'Hola','client_id':str(uuid.uuid4())},format='json')
        self.assertEqual(sent.status_code,201)
        self.assertEqual(outsider.get(url+'messages/'+sent.data['message']['id']+'/context/').status_code,404)
        self.assertEqual(outsider.get('/api/v2/messaging/search/?q=hola').data['results'],[])
        self.assertFalse(peer.get(url).data['can_manage'])
        self.assertEqual(peer.post(self.root,{'name':'otro','server_id':server['id']},format='json').status_code,404)
        self.assertEqual(peer.patch(url,{'name':'No','version':1},format='json').status_code,403)

    def test_revocation_is_inherited_and_versioned_without_deleting_messages(self):
        server, channel, url = self.create()
        peer=self.as_person(self.bob)
        peer.post(url+'messages/',{'body':'Conservar','client_id':str(uuid.uuid4())},format='json')
        endpoint=self.servers+server['id']+'/'
        self.assertEqual(self.client.patch(url+'access/',{'visibility':'public','members':[],'version':1},format='json').status_code,400)
        changed=self.client.patch(endpoint,{'name':server['name'],'members':[],'version':server['version']},format='json')
        self.assertEqual(changed.status_code,200,changed.data)
        self.assertEqual(peer.get(url).status_code,404)
        self.assertEqual(peer.get(self.servers).data['results'],[])
        self.assertEqual(ChannelAccessEpoch.objects.get(employee_id=self.bob.employee_id).revision,1)
        self.assertEqual(DepartmentChannel.objects.get(pk=channel['id']).messages.count(),1)
        self.assertEqual(self.client.patch(endpoint,{'name':'Viejo','members':[],'version':1},format='json').status_code,409)

    def test_readonly_and_core_restrictions_apply_in_server_channels(self):
        server, channel, url=self.create(access='read')
        peer=self.as_person(self.bob)
        self.assertFalse(peer.get(url).data['can_send'])
        self.assertEqual(peer.post(url+'messages/',{'body':'No','client_id':str(uuid.uuid4())},format='json').status_code,403)
        self.deny('slack.channel.read')
        self.assertEqual(peer.get(url).status_code,404)
        self.assertEqual(peer.get(self.servers).status_code,403)

    def test_names_are_scoped_to_server_and_channels_cannot_mix_departments(self):
        first, channel, _=self.create()
        second, other, _=self.create('Otro servidor')
        self.assertNotEqual(channel['id'],other['id'])
        self.assertEqual(self.client.get(self.root+'?server='+first['id']).data['results'][0]['id'],channel['id'])
        self.assertEqual(self.client.post(self.root,{'name':'general','server_id':first['id']},format='json').status_code,409)
        self.assertEqual(self.client.post(self.root,{'name':'No','server_id':first['id'],'unit_id':str(self.it.pk)},format='json').status_code,400)
        self.assertNotIn(channel['id'],[row['id'] for row in self.client.get(self.root+'?unit=independent').data['results']])
        self.assertEqual(PrivateServer.objects.count(),2)

    def test_server_search_finds_only_invited_groups_and_preserves_pagination(self):
        server, _, _=self.create('Revisión Privada')
        outsider=self.as_person(self.owner)
        self.assertEqual(outsider.get(self.servers+'?q=revision').data['results'],[])
        self.assertEqual([row['id'] for row in self.client.get(self.servers+'?q=revision').data['results']],[server['id']])
        self.assertEqual([row['id'] for row in self.as_person(self.bob).get(self.servers+'?q=privada').data['results']],[server['id']])
