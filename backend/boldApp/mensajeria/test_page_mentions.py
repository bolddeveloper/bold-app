import base64
import uuid

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework.exceptions import APIException
from boldApp.core.models import JobRole, JobRolePermission, Permission
from boldApp.notificaciones.models import Notification
from boldApp.notificaciones.consumers import notification_resource_is_readable
from . import test_pages as base, test_page_crdt as collab
from .models import ChannelAccessRule, ChannelPage, ChannelReadState, ChannelSubscription, PageRevision, PageUpdateReceipt, ResourceMention
from .page_collaboration import authorized_event, synchronize
from .page_crdt import load_document
from .page_mentions import page_mentions

readable = notification_resource_is_readable.__wrapped__


@override_settings(MESSAGING_PILOT_ENABLED=False)
class PageMentionTests(TestCase):
    root = base.ChannelPageTests.root
    identity = base.ChannelPageTests.identity
    as_person = base.ChannelPageTests.as_person
    deny = base.ChannelPageTests.deny
    blocks = base.ChannelPageTests.blocks
    setUp = base.ChannelPageTests.setUp
    save = base.ChannelPageTests.save

    @property
    def token(self):
        return '@' + self.bob.employee.user_account.email

    def write(self, text):
        result = self.save(blocks=[{**self.page['blocks'][0], 'text':text}])
        self.assertEqual(result.status_code, 200, result.data)
        self.page = result.data
        return result.data

    def test_first_save_notifies_unfollowed_reader_and_retries_edits_never_duplicate(self):
        page = self.write('Contexto reservado ' + self.token)
        self.assertEqual(page['mentions'][0]['employee_id'], str(self.bob.employee_id))
        notice = Notification.objects.get()
        self.assertEqual(notice.type, 'slack.mentioned')
        self.assertEqual(notice.resource_type, 'slack_page')
        self.assertEqual(notice.route['page_id'], page['id'])
        self.assertEqual(notice.route['block_id'], page['blocks'][0]['id'])
        self.assertNotIn('reservado', notice.body)
        self.assertNotIn(page['title'], notice.title + notice.body)
        self.assertTrue(readable(str(self.bob.pk), str(notice.pk)))
        self.assertFalse(ChannelReadState.objects.exists())
        self.assertFalse(ChannelSubscription.objects.exists())
        self.assertFalse(ChannelAccessRule.objects.exists())
        self.write('Detalles posteriores ' + self.token)
        self.write('Referencia retirada')
        self.assertFalse(readable(str(self.bob.pk), str(notice.pk)))
        self.write(self.token)
        self.assertEqual(Notification.objects.count(), 1)
        bob = self.as_person(self.bob)
        listing = bob.get('/api/v2/notifications/')
        self.assertEqual(listing.status_code, 200)
        self.assertIn(str(notice.pk), [row['id'] for row in listing.data['results']])
        self.assertEqual(bob.post(f'/api/v2/notifications/{notice.pk}/mark-read/').status_code, 200)
        self.assertFalse(readable(str(self.bob.pk), str(notice.pk)))

    def test_page_permission_is_required_in_addition_to_channel_permission(self):
        role = JobRole.objects.create(title='Sin lectura de páginas')
        self.bob.position.job_role = role
        self.bob.position.save(update_fields=['job_role'])
        denial = JobRolePermission.objects.create(job_role=role, permission=Permission.objects.get(code='slack.page.read'), scope_type='global', effect='deny')
        picker = self.detail + 'mention-people/'
        self.assertEqual(self.client.get(picker, {'q':'bob'}).data['results'], [])
        self.assertEqual(self.write(self.token)['mentions'], [])
        self.assertFalse(Notification.objects.exists())
        denial.delete()
        self.write(self.token + ' nueva comprobación')
        self.assertFalse(Notification.objects.exists(), 'new access does not retrospectively notify an unchanged reference')
        self.write('Sin referencia')
        self.write(self.token)
        notice = Notification.objects.get()
        self.assertTrue(readable(str(self.bob.pk), str(notice.pk)))
        JobRolePermission.objects.create(job_role=role, permission=Permission.objects.get(code='slack.page.read'), scope_type='global', effect='deny')
        self.assertFalse(readable(str(self.bob.pk), str(notice.pk)))
        bob = self.as_person(self.bob)
        self.assertEqual(bob.get(self.url).status_code, 200)
        self.assertEqual(bob.get('/api/v2/notifications/').data['results'], [])

    def test_private_mfa_and_revocation_hide_picker_notice_and_page(self):
        channel = ChannelPage.objects.get(pk=self.page['id']).channel
        channel.visibility = 'private';channel.save()
        ChannelAccessRule.objects.create(channel=channel,employee=self.alice.employee,access='write')
        picker = self.detail + 'mention-people/'
        self.assertEqual(self.client.get(picker, {'q':'bob'}).data['results'], [])
        self.assertEqual(self.as_person(self.owner).get(picker, {'q':'bob'}).status_code, 404)
        self.assertEqual(self.write(self.token)['mentions'], [])
        rule = ChannelAccessRule.objects.create(channel=channel,employee=self.bob.employee,access='read')
        self.assertEqual(self.client.get(picker, {'q':'bob'}).data['results'][0]['token'], self.token)
        self.write('Nueva invitación, sin referencia')
        self.write(self.token + ' con invitación')
        notice = Notification.objects.get()
        permission = Permission.objects.get(code='slack.page.read')
        permission.requires_step_up_mfa=True;permission.save()
        self.assertFalse(readable(str(self.bob.pk), str(notice.pk)))
        permission.requires_step_up_mfa=False;permission.save()
        rule.delete()
        self.assertFalse(readable(str(self.bob.pk), str(notice.pk)))
        self.assertEqual(self.as_person(self.bob).get('/api/v2/notifications/').data['results'], [])

    def test_personal_opt_out_and_archiving_stop_push_without_granting_access(self):
        bob = self.as_person(self.bob)
        self.assertEqual(bob.patch('/api/v2/auth/notification-settings/', {'events':{'slack.mentioned':False}},format='json').status_code, 200)
        self.write(self.token)
        self.assertFalse(Notification.objects.exists())
        bob.patch('/api/v2/auth/notification-settings/', {'events':{'slack.mentioned':True}},format='json')
        self.write(self.token + ' editada')
        self.assertFalse(Notification.objects.exists(), 'no retrospective notice when enabling the preference')
        other = self.client.post(self.collection,{**self.input,'client_id':str(uuid.uuid4()),'blocks':self.blocks(self.token)},format='json')
        self.assertEqual(other.status_code,201,other.data)
        notice = Notification.objects.get()
        self.assertTrue(readable(str(self.bob.pk),str(notice.pk)))
        response = self.client.patch(self.collection + other.data['id'] + '/',{'version':1,'client_id':str(uuid.uuid4()),'archived':True},format='json')
        self.assertEqual(response.status_code,200,response.data)
        self.assertFalse(readable(str(self.bob.pk),str(notice.pk)))

    def test_new_blocks_can_notify_again_but_one_save_coalesces_each_recipient(self):
        self.write(self.token)
        first = Notification.objects.get()
        second, third = self.blocks(self.token)[0], self.blocks(self.token)[0]
        response = self.save(blocks=[*self.page['blocks'],second,third])
        self.assertEqual(response.status_code,200,response.data);self.page=response.data
        self.assertEqual(Notification.objects.count(),2, 'two newly mentioned blocks in one save produce one new notice')
        notice=Notification.objects.exclude(pk=first.pk).get()
        self.assertEqual(notice.route['block_id'],second['id'])
        second['text']='Referencia retirada de este bloque'
        response=self.save(blocks=[self.page['blocks'][0],second,third])
        self.assertEqual(response.status_code,200,response.data);self.page=response.data
        self.assertFalse(readable(str(self.bob.pk),str(notice.pk)), 'a mention elsewhere cannot validate a removed source reference')
        self.assertTrue(readable(str(self.bob.pk),str(first.pk)))
        second['text']=self.token
        response=self.save(blocks=[self.page['blocks'][0],second,third])
        self.assertEqual(response.status_code,200,response.data)
        self.assertEqual(Notification.objects.count(),2, 'reintroducing a previously notified block does not repeat its notice')

    def test_restoration_and_template_instantiation_do_not_notify_retroactively(self):
        page = self.write(self.token)
        self.write('Sin referencia actual')
        before = Notification.objects.count()
        restored = self.client.patch(self.detail,{'version':self.page['version'],'client_id':str(uuid.uuid4()),'restore_version':page['version']},format='json')
        self.assertEqual(restored.status_code,200,restored.data)
        self.assertEqual(restored.data['mentions'][0]['employee_id'],str(self.bob.employee_id))
        self.assertEqual(Notification.objects.count(),before)
        template = self.client.post(self.url + 'templates/',{'client_id':str(uuid.uuid4()),'page_id':page['id'],
            'page_version':restored.data['version'],'name':'Plantilla con contexto','description':''},format='json')
        self.assertEqual(template.status_code,201,template.data)
        copied = self.client.post(self.url + 'templates/' + template.data['id'] + '/pages/',{'client_id':str(uuid.uuid4())},format='json')
        self.assertEqual(copied.status_code,201,copied.data)
        self.assertEqual(copied.data['mentions'][0]['employee_id'],str(self.bob.employee_id))
        self.assertEqual(Notification.objects.count(),before)
        self.assertEqual(self.client.get(self.detail + f"history/{page['version']}/").data['mentions'][0]['employee_id'],str(self.bob.employee_id))

    def test_reference_survives_rename_archive_and_ordinary_reads_are_query_free(self):
        original = self.token
        self.write(original)
        account = self.bob.employee.user_account;account.email='renamed-page-person@bold.gt';account.save(update_fields=['email'])
        self.assertEqual(self.write(original + ' revisada')['mentions'][0]['employee_id'],str(self.bob.employee_id))
        source = ChannelPage.objects.get(pk=self.page['id'])
        with self.assertNumQueries(1):
            self.assertEqual(page_mentions(source)[0]['employee_id'],str(self.bob.employee_id))
        source.blocks=[]
        with self.assertNumQueries(0):
            self.assertEqual(page_mentions(source),[])
        source.refresh_from_db();source.archived_at=timezone.now();source.save()
        self.assertTrue(ResourceMention.objects.exists(), 'archiving preserves references and history')
        self.assertTrue(PageRevision.objects.filter(page=source).exists())
        self.assertFalse(readable(str(self.bob.pk),str(Notification.objects.get().pk)))

    def test_picker_strict_input_limits_and_literals_do_not_create_false_mentions(self):
        picker = self.detail + 'mention-people/'
        for query in ({},{'q':'x'},{'q':'bob','page_id':self.page['id']}):
            self.assertEqual(self.client.get(picker,query).status_code,400)
        self.assertEqual(APIClient().get(picker,{'q':'bob'}).status_code,401)
        self.assertEqual(self.write(f'`{self.token}` https://example.com/{self.token} normal@bold.gt')['mentions'],[])
        response = self.save(blocks=self.blocks(' '.join(f'@person{i}@bold.gt' for i in range(51))))
        self.assertEqual(response.status_code,400)
        self.assertEqual(ChannelPage.objects.get(pk=self.page['id']).version,self.page['version'])


@override_settings(MESSAGING_PILOT_ENABLED=False)
class PageMentionCRDTTests(TestCase):
    root=collab.PageCRDTTests.root
    identity=collab.PageCRDTTests.identity
    as_person=collab.PageCRDTTests.as_person
    deny=collab.PageCRDTTests.deny
    blocks=collab.PageCRDTTests.blocks
    setUp=collab.PageCRDTTests.setUp
    session=collab.PageCRDTTests.session
    update=collab.PageCRDTTests.update

    def test_live_ack_reconnect_and_peer_events_contain_verified_refs_once(self):
        token='@'+self.bob.employee.user_account.email
        doc=load_document(base64.b64decode(self.initial['update']));state=doc.get_state()
        text=doc['blocks'][self.page['blocks'][0]['id']]['text'];text.insert(len(text),' '+token)
        self.assertIn(token,str(doc['blocks'][self.page['blocks'][0]['id']]['text']))
        request_id=str(uuid.uuid4());delta=doc.get_update(state)
        result=self.update(self.alice,delta,doc.get_state(),client_id=request_id)
        self.assertEqual(result['mentions'][0]['employee_id'],str(self.bob.employee_id))
        self.assertEqual(self.update(self.alice,delta,doc.get_state(),client_id=request_id)['mentions'],result['mentions'])
        self.assertEqual(Notification.objects.count(),1)
        self.assertEqual(PageUpdateReceipt.objects.count(),1)
        event={'epoch':self.initial['epoch'],'update':result['update'],'version':result['version'],'mentions_changed':True}
        received=authorized_event(self.session(self.bob).pk,self.bob.pk,self.page['id'],event)
        self.assertEqual(received['mentions'],result['mentions'])
        state=synchronize(self.session(self.bob).pk,self.bob.pk,self.page['id'],{'epoch':self.initial['epoch'],'state':self.initial['state']})
        self.assertEqual(state['mentions'],result['mentions'])
        literal=base64.b64decode(self.initial['update'])
        self.assertNotIn(self.bob.employee.full_name.encode(),literal,'verified identity is not copied into the shared CRDT')

    def test_excess_references_roll_back_document_state_receipt_and_notices(self):
        doc=load_document(base64.b64decode(self.initial['update']));state=doc.get_state()
        text=doc['blocks'][self.page['blocks'][0]['id']]['text'];text.insert(len(text),' '+' '.join(f'@person{i}@bold.gt' for i in range(51)))
        with self.assertRaises(APIException):
            self.update(self.alice,doc.get_update(state),doc.get_state())
        self.assertEqual(ChannelPage.objects.get(pk=self.page['id']).version,1)
        self.assertFalse(PageUpdateReceipt.objects.exists())
        self.assertFalse(ResourceMention.objects.exists())
        self.assertFalse(Notification.objects.exists())
