import base64
import json
import uuid
from django.test import TestCase, RequestFactory, override_settings
from pycrdt import Map, Text
from rest_framework.exceptions import APIException
from boldApp.autenticacion.services import create_session
from . import test_pages as base
from .models import ChannelPage, PageLink, PageTemplate, DepartmentChannel, ChannelAccessRule
from .page_collaboration import initial_state, commit_update, authorized_event, synchronize
from .page_crdt import encode, load_document, seed_document
from .channel_events import channel_event


@override_settings(MESSAGING_PILOT_ENABLED=False)
class PageLinkTests(TestCase):
    root=base.ChannelPageTests.root
    identity=base.ChannelPageTests.identity
    as_person=base.ChannelPageTests.as_person
    deny=base.ChannelPageTests.deny
    send=base.ChannelPageTests.send
    blocks=base.ChannelPageTests.blocks
    setUp=base.ChannelPageTests.setUp
    save=base.ChannelPageTests.save

    def other(self, *, private=False, title='Destino del enlace'):
        response=self.client.post(self.root,{'unit_id':str(self.it.pk),'name':'Privado' if private else 'Otro canal',
            'visibility':'private' if private else 'public'},format='json')
        self.assertEqual(response.status_code,201,response.data)
        url=self.root+response.data['id']+'/pages/'
        page=self.client.post(url,{'client_id':str(uuid.uuid4()),'title':title},format='json')
        self.assertEqual(page.status_code,201,page.data)
        return page.data,url

    def link(self, page, alias=''):
        return {'id':str(uuid.uuid4()),'type':'page','page_id':page['id'],'text':alias}

    def session(self, person):
        return create_session(person.employee.user_account,RequestFactory().get('/',REMOTE_ADDR='127.0.0.1'))[1]

    def test_live_reference_alias_and_backlink_are_not_snapshots_or_grants(self):
        target,url=self.other()
        link=self.link(target)
        result=self.save(blocks=[link])
        self.assertEqual(result.status_code,200,result.data)
        row=result.data['blocks'][0]
        self.assertEqual(row['page']['title'],target['title'])
        self.assertEqual(row['text'],'')
        self.assertEqual(PageLink.objects.get().target_id,uuid.UUID(target['id']))
        reverse=self.client.get(url+target['id']+'/backlinks/')
        self.assertEqual([p['id'] for p in reverse.data['results']],[self.page['id']])
        self.assertEqual(reverse.data['results'][0]['block_ids'],[link['id']])
        self.assertNotIn('blocks',reverse.data['results'][0])
        ChannelPage.objects.filter(pk=target['id']).update(title='Título actual')
        self.assertEqual(self.client.get(self.detail).data['blocks'][0]['page']['title'],'Título actual')
        stored=ChannelPage.objects.get(pk=self.page['id'])
        self.assertEqual(stored.blocks,[link])
        shared=json.dumps(seed_document(stored)['blocks'].to_py())
        for hidden in (target['id'],target['title'],'Título actual',target['channel_id']):
            self.assertNotIn(hidden,shared)

    def test_private_target_is_hidden_even_from_owner_and_in_history(self):
        target,url=self.other(private=True,title='Destino reservado confidencial')
        link=self.link(target,'Alias aprobado')
        self.assertEqual(self.save(blocks=[link]).status_code,200)
        for person in (self.bob,self.owner):
            client=self.as_person(person)
            for endpoint in (self.detail,self.detail+'history/2/'):
                result=client.get(endpoint)
                self.assertEqual(result.status_code,200,result.data)
                self.assertEqual(result.data['blocks'],[{'id':link['id'],'type':'page','text':'Alias aprobado','page':{'available':False}}])
                for hidden in (target['id'],target['title'],target['channel_id']):
                    self.assertNotIn(hidden,json.dumps(result.data,default=str))
            self.assertEqual(client.get(url+target['id']+'/backlinks/').status_code,404)
        ChannelAccessRule.objects.create(channel_id=target['channel_id'],employee=self.bob.employee,access='read')
        self.assertTrue(self.as_person(self.bob).get(self.detail).data['blocks'][0]['page']['available'])

    def test_unauthorized_new_references_cannot_replace_opaque_existing_blocks(self):
        target,_=self.other(private=True)
        link=self.link(target)
        self.assertEqual(self.save(blocks=[link]).status_code,200)
        bob=self.as_person(self.bob)
        opaque={'id':link['id'],'type':'page','text':'Mi alias'}
        preserved=self.save(bob,version=2,blocks=[opaque])
        self.assertEqual(preserved.status_code,200,preserved.data)
        self.assertFalse(preserved.data['blocks'][0]['page']['available'])
        forged=self.save(bob,version=3,blocks=[self.link(target)])
        self.assertEqual(forged.status_code,404)
        self.assertEqual(ChannelPage.objects.get(pk=self.page['id']).version,3)
        self.assertEqual(PageLink.objects.count(),1)
        self.assertEqual(self.save(version=3,blocks=[{**link,'text':'x'*161}]).status_code,400)
        self.assertEqual(self.save(version=3,blocks=[{**link,'page':{'title':'Injected'}}]).status_code,400)

    def test_backlinks_filter_private_source_before_rows_pagination_and_counts(self):
        target,url=self.other()
        public_link=self.link(target)
        self.assertEqual(self.save(blocks=[public_link]).status_code,200)
        private,private_url=self.other(private=True,title='Origen reservado nunca visible')
        response=self.client.put(private_url+private['id']+'/',{'client_id':str(uuid.uuid4()),'version':1,
            'title':private['title'],'blocks':[self.link(target),self.link(target)],'icon':'note'},format='json')
        self.assertEqual(response.status_code,200,response.data)
        endpoint=url+target['id']+'/backlinks/'
        for person in (self.bob,self.owner):
            data=self.as_person(person).get(endpoint).data
            self.assertEqual([row['id'] for row in data['results']],[self.page['id']])
            self.assertNotIn('count',data)
            self.assertNotIn(private['id'],json.dumps(data))
            self.assertNotIn(private['title'],json.dumps(data))
        rule=ChannelAccessRule.objects.create(channel_id=private['channel_id'],employee=self.bob.employee,access='read')
        data=self.as_person(self.bob).get(endpoint).data
        self.assertEqual(len(data['results']),2)
        self.assertEqual(len(next(row for row in data['results'] if row['id']==private['id'])['block_ids']),2)
        rule.delete()
        self.assertEqual(len(self.as_person(self.bob).get(endpoint).data['results']),1)

    def test_removal_and_revision_restore_reconcile_the_index_atomically(self):
        target,url=self.other();link=self.link(target)
        self.assertEqual(self.save(blocks=[link]).status_code,200)
        self.assertEqual(self.save(version=2,blocks=[]).status_code,200)
        self.assertEqual(PageLink.objects.count(),0)
        response=self.client.patch(self.detail,{'client_id':str(uuid.uuid4()),'version':3,'restore_version':2},format='json')
        self.assertEqual(response.status_code,200,response.data)
        self.assertEqual(PageLink.objects.count(),1)
        self.assertEqual(self.client.get(url+target['id']+'/backlinks/').data['results'][0]['id'],self.page['id'])

    def test_templates_copy_links_with_fresh_blocks_and_live_filtered_projections(self):
        target,_=self.other(private=True,title='Secreto no copiado al CRDT')
        link=self.link(target)
        self.assertEqual(self.save(blocks=[link]).status_code,200)
        captured=self.client.post(self.url+'templates/',{'client_id':str(uuid.uuid4()),'page_id':self.page['id'],
            'page_version':2,'name':'Procedimiento','description':''},format='json')
        self.assertEqual(captured.status_code,201,captured.data)
        copied=self.as_person(self.bob).post(self.url+'templates/'+captured.data['id']+'/pages/',
            {'client_id':str(uuid.uuid4())},format='json')
        self.assertEqual(copied.status_code,201,copied.data)
        self.assertNotEqual(copied.data['blocks'][0]['id'],link['id'])
        self.assertFalse(copied.data['blocks'][0]['page']['available'])
        self.assertEqual(PageLink.objects.count(),2)
        self.assertNotIn(target['title'],json.dumps(copied.data,default=str))

    def test_discovery_checks_source_edit_and_filters_inaccessible_archived_targets(self):
        public,_=self.other(title='Buscable público')
        private,_=self.other(private=True,title='Buscable privado')
        endpoint=self.detail+'link-options/'
        data=self.as_person(self.bob).get(endpoint+'?q=Buscable').data
        self.assertEqual([row['id'] for row in data['results']],[public['id']])
        self.assertNotIn(private['id'],json.dumps(data))
        self.assertEqual(self.client.get(endpoint+'?q=Buscable&q=otro').status_code,400)
        self.assertEqual(self.client.get(endpoint+'?q='+'x'*81).status_code,400)
        self.assertEqual(self.client.get(endpoint+'?parent=bad').status_code,400)
        self.deny('slack.page.update')
        self.assertEqual(self.client.get(endpoint).status_code,403)
        self.assertEqual(self.client.get(self.detail+'backlinks/').status_code,200)

    def test_archival_changes_live_labels_without_breaking_existing_links(self):
        target,url=self.other();link=self.link(target)
        self.assertEqual(self.save(blocks=[link]).status_code,200)
        result=self.client.patch(url+target['id']+'/',{'client_id':str(uuid.uuid4()),'version':1,'archived':True},format='json')
        self.assertEqual(result.status_code,200,result.data)
        data=self.client.get(self.detail).data['blocks'][0]['page']
        self.assertTrue(data['available']);self.assertTrue(data['archived'])
        self.assertNotIn(target['id'],[row['id'] for row in self.client.get(self.detail+'link-options/').data['results']])

    def test_socket_projects_page_metadata_separately_for_each_recipient(self):
        target,_=self.other(private=True,title='Dato reservado del destino')
        a,b=self.session(self.alice),self.session(self.bob)
        initial=initial_state(a.pk,self.alice.pk,self.page['id'])
        doc=load_document(base64.b64decode(initial['update']));before=doc.get_state();block=str(uuid.uuid4())
        doc['blocks'][block]=Map({'type':'page','text':Text('')});doc['order'].append(block)
        update=doc.get_update(before)
        payload={'type':'update','epoch':initial['epoch'],'client_id':str(uuid.uuid4()),'update':encode(update),
                 'state':encode(doc.get_state()),'references':{block:target['id']}}
        ack=commit_update(a.pk,self.alice.pk,self.page['id'],payload,'writer')
        self.assertTrue(ack['tasks'][0]['page']['available'])
        event={'epoch':initial['epoch'],'version':2,'update':encode(update),'references_changed':True}
        received=authorized_event(b.pk,self.bob.pk,self.page['id'],event)
        self.assertEqual(received['tasks'],[{'id':block,'type':'page','text':'','page':{'available':False}}])
        for packet in (received,synchronize(b.pk,self.bob.pk,self.page['id'],{'epoch':initial['epoch'],'state':encode(doc.get_state())})):
            self.assertNotIn(target['id'],json.dumps(packet))
            self.assertNotIn(target['title'],json.dumps(packet))
        shared=json.dumps(load_document(base64.b64decode(ack['update']))['blocks'].to_py())
        self.assertNotIn(target['id'],shared);self.assertNotIn(target['title'],shared)
        self.assertEqual(PageLink.objects.count(),1)

    def test_protected_id_cannot_be_smuggled_into_yjs_fields(self):
        target,_=self.other();session=self.session(self.alice)
        initial=initial_state(session.pk,self.alice.pk,self.page['id'])
        doc=load_document(base64.b64decode(initial['update']));before=doc.get_state();block=str(uuid.uuid4())
        doc['blocks'][block]=Map({'type':'page','text':Text(''),'page_id':target['id']});doc['order'].append(block)
        payload={'type':'update','epoch':initial['epoch'],'client_id':str(uuid.uuid4()),'update':encode(doc.get_update(before)),
                 'state':encode(doc.get_state())}
        with self.assertRaises(APIException):
            commit_update(session.pk,self.alice.pk,self.page['id'],payload,'forged')
        self.assertEqual(PageLink.objects.count(),0)
        self.assertEqual(ChannelPage.objects.get(pk=self.page['id']).version,1)

    def test_cross_channel_hints_do_not_reveal_private_sources_even_to_owner(self):
        private,_=self.other(private=True)
        event={'channel_id':self.channel_id,'related_channel_id':private['channel_id'],'kind':'page.links_changed'}
        for person in (self.bob,self.owner):
            self.assertIsNone(channel_event(person.pk,event))
        visible=channel_event(self.alice.pk,event)
        self.assertIsNotNone(visible)
        self.assertNotIn(private['channel_id'],json.dumps(visible,default=str))

    def test_link_endpoints_are_private_no_store(self):
        for endpoint in (self.detail+'link-options/',self.detail+'backlinks/'):
            response=self.client.get(endpoint)
            self.assertEqual(response.status_code,200,response.data)
            self.assertIn('no-store',response['Cache-Control'])
