import base64
import copy
import uuid
from django.test import TestCase, override_settings
from django.test import RequestFactory
from rest_framework.exceptions import ValidationError
from boldApp.autenticacion.services import create_session
from . import test_pages as base
from .models import ChannelPage, PageRevision, ResourceMention
from .page_crdt import seed_document, document_content, load_document, encode
from .page_collaboration import initial_state, commit_update
from .page_formatting import read_text
from .search_text import page_text
from .page_mentions import page_mention_locations


@override_settings(MESSAGING_PILOT_ENABLED=False)
class PageFormattingTests(TestCase):
    root=base.ChannelPageTests.root
    identity=base.ChannelPageTests.identity
    as_person=base.ChannelPageTests.as_person
    deny=base.ChannelPageTests.deny
    send=base.ChannelPageTests.send
    blocks=base.ChannelPageTests.blocks
    setUp=base.ChannelPageTests.setUp
    save=base.ChannelPageTests.save

    def formatted(self):
        return {'id':str(uuid.uuid4()),'type':'paragraph','text':'😀 Acuerdo y enlace',
            'formats':[{'start':3,'end':10,'bold':True},{'start':13,'end':19,'href':'https://bold.gt/proceso','italic':True}]}

    def session(self,person=None):
        person=person or self.alice
        return create_session(person.employee.user_account,RequestFactory().get('/',REMOTE_ADDR='127.0.0.1'))[1]

    def test_rest_seed_roundtrip_uses_utf16_offsets_not_native_utf8(self):
        block=self.formatted();response=self.save(blocks=[block]);self.assertEqual(response.status_code,200,response.data)
        page=ChannelPage.objects.get(pk=self.page['id']);doc=seed_document(page)
        text,formats=read_text(doc['blocks'][block['id']]['text'])
        self.assertEqual(text,block['text']);self.assertEqual(formats,block['formats'])
        self.assertEqual(document_content(doc,page,self.alice,None)[2],[block])
        self.assertEqual(self.client.get(self.detail+'history/2/').data['blocks'],[block])

    def test_formats_are_strict_bounded_disjoint_and_safe(self):
        block=self.formatted()
        bad=[{'start':0,'end':1,'bold':True},{'start':0,'end':2,'html':'<b>'},{'start':0,'end':2,'bold':False},
            {'start':0,'end':2,'href':'javascript:alert(1)'},{'start':0,'end':2,'href':'data:text/html,x'},
            {'start':0,'end':2,'href':'https://user:pass@example.com'}, {'start':True,'end':2,'bold':True},
            {'start':0,'end':999,'bold':True}]
        for row in bad:
            response=self.save(blocks=[{**block,'formats':[row]}]);self.assertEqual(response.status_code,400,response.data)
        for rows in ([{'start':0,'end':4,'bold':True},{'start':3,'end':5,'italic':True}],block['formats']*101):
            self.assertEqual(self.save(blocks=[{**block,'formats':rows}]).status_code,400)
        self.assertEqual(ChannelPage.objects.get(pk=self.page['id']).version,1)

    def test_unknown_crdt_attributes_embeds_and_title_format_cannot_enter_room(self):
        session=self.session();initial=initial_state(session.pk,self.alice.pk,self.page['id'])
        for action in ('unknown','embed','title'):
            doc=load_document(base64.b64decode(initial['update']));state=doc.get_state()
            if action=='title':doc['title'].format(0,1,{'bold':True})
            else:
                text=doc['blocks'][self.page['blocks'][0]['id']]['text']
                if action=='unknown':text.format(0,1,{'onclick':'alert(1)'})
                else:text.insert_embed(0,{'html':'<script>x</script>'})
            with self.assertRaises(ValidationError):commit_update(session.pk,self.alice.pk,self.page['id'],{'type':'update','epoch':initial['epoch'],
                'client_id':str(uuid.uuid4()),'update':encode(doc.get_update(state)),'state':encode(doc.get_state())},'malformed-format')
        self.assertEqual(ChannelPage.objects.get(pk=self.page['id']).version,1)

    def test_code_is_literal_searchable_without_mentions_or_inline_formats(self):
        code={'id':str(uuid.uuid4()),'type':'code','text':'<script>alert(1)</script> @person@bold.gt','language':'javascript'}
        response=self.save(blocks=[code]);self.assertEqual(response.status_code,200,response.data)
        page=ChannelPage.objects.get(pk=self.page['id']);self.assertIn('<script>',page_text(page))
        self.assertNotIn('@person',page_text(page,include_code=False));self.assertEqual(page_mention_locations(page),{})
        self.assertFalse(ResourceMention.objects.filter(document__page=page).exists())
        doc=seed_document(page);self.assertEqual(document_content(doc,page,self.alice,None)[2],[code])
        self.assertEqual(self.save(version=2,blocks=[{**code,'language':'eval'}]).status_code,400)
        self.assertEqual(self.save(version=2,blocks=[{**code,'formats':[{'start':0,'end':1,'bold':True}]}]).status_code,400)

    def test_inline_code_suppresses_mentions_without_hiding_search_text(self):
        token='@'+self.bob.employee.user_account.email
        block={'id':str(uuid.uuid4()),'type':'paragraph','text':'Ejemplo '+token,'formats':[{'start':8,'end':8+len(token),'code':True}]}
        response=self.save(blocks=[block]);self.assertEqual(response.status_code,200,response.data)
        page=ChannelPage.objects.get(pk=self.page['id']);self.assertEqual(page_mention_locations(page),{})
        self.assertIn(token,page_text(page));self.assertFalse(ResourceMention.objects.filter(document__page=page).exists())

    def test_formats_do_not_bypass_page_update_permission(self):
        self.deny('slack.page.update')
        self.assertEqual(self.save(blocks=[self.formatted()]).status_code,403)
        self.assertEqual(ChannelPage.objects.get(pk=self.page['id']).version,1)

    def test_revision_restore_and_templates_preserve_formats_with_fresh_block_ids(self):
        block=self.formatted();self.assertEqual(self.save(blocks=[block]).status_code,200)
        templates=self.url+'templates/'
        response=self.client.post(templates,{'client_id':str(uuid.uuid4()),'page_id':self.page['id'],'page_version':2,'name':'Proceso con formato'},format='json')
        self.assertEqual(response.status_code,201,response.data)
        copied=self.client.post(templates+response.data['id']+'/pages/',{'client_id':str(uuid.uuid4())},format='json')
        self.assertEqual(copied.status_code,201,copied.data)
        self.assertNotEqual(copied.data['blocks'][0]['id'],block['id']);self.assertEqual(copied.data['blocks'][0]['formats'],block['formats'])
        self.assertEqual(self.save(version=2,blocks=self.blocks('Sin formato')).status_code,200)
        restored=self.client.patch(self.detail,{'client_id':str(uuid.uuid4()),'version':3,'restore_version':2},format='json')
        self.assertEqual(restored.status_code,200,restored.data);self.assertEqual(restored.data['blocks'],[block])

    def test_crdt_formatting_has_idempotent_receipts_and_does_not_change_plain_text(self):
        session=self.session();initial=initial_state(session.pk,self.alice.pk,self.page['id'])
        doc=load_document(base64.b64decode(initial['update']));state=doc.get_state();text=doc['blocks'][self.page['blocks'][0]['id']]['text']
        text.format(0,6,{'bold':True,'href':'https://bold.gt'})
        payload={'type':'update','epoch':initial['epoch'],'client_id':str(uuid.uuid4()),'update':encode(doc.get_update(state)),'state':encode(doc.get_state())}
        ack=commit_update(session.pk,self.alice.pk,self.page['id'],payload,'format');retry=commit_update(session.pk,self.alice.pk,self.page['id'],payload,'format')
        self.assertEqual(ack['version'],retry['version']);page=ChannelPage.objects.get(pk=self.page['id'])
        self.assertEqual(page.blocks[0]['text'],self.page['blocks'][0]['text']);self.assertTrue(page.blocks[0]['formats'][0]['bold'])
        self.assertEqual(PageRevision.objects.filter(page=page).count(),1)
