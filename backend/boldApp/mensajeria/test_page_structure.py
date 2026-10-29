import uuid
from unittest import skipUnless
from django.db import connection
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from .test_pages import ChannelPageTests
from .test_page_concurrency import PageConcurrencyTests
from .models import ChannelPage, DepartmentChannel, ChannelAccessRule
from .page_models import PageStructureReceipt


@override_settings(MESSAGING_PILOT_ENABLED=False)
class PageStructureTests(TestCase):
    root = ChannelPageTests.root
    identity = ChannelPageTests.identity
    as_person = ChannelPageTests.as_person
    deny = ChannelPageTests.deny
    send = ChannelPageTests.send
    setUp = ChannelPageTests.setUp
    blocks = ChannelPageTests.blocks
    save = ChannelPageTests.save

    def child(self, parent=None, title='Subpágina'):
        result=self.client.post(self.collection, {'client_id':str(uuid.uuid4()), 'title':title, 'parent_id':parent}, format='json')
        self.assertEqual(result.status_code,201,result.data)
        return result.data

    def move(self, page, parent, version=1, token=None, client=None):
        return (client or self.client).put(self.collection+page+'/structure/', {'parent_id':parent,
            'version':version,'client_id':token or str(uuid.uuid4())}, format='json')

    def ids(self, query=''):
        result=self.client.get(self.collection+query)
        self.assertEqual(result.status_code,200,result.data)
        return [row['id'] for row in result.data['results']]

    def test_child_create_retry_hierarchy_and_legacy_list(self):
        values={'client_id':str(uuid.uuid4()),'title':'Hija','parent_id':self.page['id']}
        created=self.client.post(self.collection,values,format='json')
        self.assertEqual(created.status_code,201,created.data)
        again=self.client.post(self.collection,values,format='json')
        self.assertEqual(again.status_code,200,again.data)
        child=created.data
        self.assertEqual(child['parent_id'],self.page['id'])
        self.assertEqual(set(self.ids()),{self.page['id'],child['id']})
        self.assertEqual(self.ids('?parent=root'),[self.page['id']])
        self.assertEqual(self.ids('?parent='+self.page['id']),[child['id']])
        root=self.client.get(self.collection+'?parent=root').data['results'][0]
        self.assertTrue(root['has_children'])
        self.assertNotIn('blocks',root)
        structure=self.client.get(self.collection+child['id']+'/structure/').data
        self.assertEqual([p['id'] for p in structure['ancestors']],[self.page['id']])
        self.assertEqual(self.client.post(self.collection,{**values,'parent_id':None},format='json').status_code,409)

    def test_move_has_independent_version_and_retry_receipt(self):
        child=self.child(self.page['id'])
        token=str(uuid.uuid4())
        result=self.move(child['id'],None,token=token)
        self.assertEqual(result.status_code,200,result.data)
        self.assertEqual(result.data['structure_version'],2)
        self.assertEqual(self.move(child['id'],None,token=token).status_code,200)
        self.assertEqual(PageStructureReceipt.objects.count(),1)
        self.assertEqual(self.move(child['id'],self.page['id'],token=token).status_code,409)
        stale=self.move(child['id'],self.page['id'])
        self.assertEqual(stale.status_code,409)
        self.assertEqual(stale.data['current']['parent_id'],None)
        self.assertEqual(self.move(child['id'],self.page['id'],version=2).status_code,200)
        old=self.move(child['id'],None,token=token)
        self.assertEqual(old.data['accepted_version'],2)
        self.assertEqual(old.data['structure_version'],3)
        self.assertEqual(old.data['parent_id'],self.page['id'])
        row=ChannelPage.objects.get(pk=child['id'])
        self.assertEqual(row.version,1)
        self.assertEqual(row.revisions.count(),1)
        self.assertEqual(row.updated_at,child['updated_at'])

    def test_cycles_cross_channel_and_missing_parent_are_rejected(self):
        child=self.child(self.page['id'])
        grandchild=self.child(child['id'])
        for parent in (self.page['id'],child['id'],grandchild['id']):
            self.assertEqual(self.move(self.page['id'],parent).status_code,400)
        other=self.client.post(self.root,{'unit_id':str(self.it.pk),'name':'Otro canal'},format='json').data
        alien=self.client.post(self.root+other['id']+'/pages/',{'client_id':str(uuid.uuid4()),'title':'Ajena'},format='json').data
        for parent in (alien['id'],str(uuid.uuid4())):
            self.assertEqual(self.move(self.page['id'],parent).status_code,400)
            bad=self.client.post(self.collection,{'client_id':str(uuid.uuid4()),'title':'No','parent_id':parent},format='json')
            self.assertEqual(bad.status_code,400,bad.data)
        self.assertEqual(self.client.get(self.collection+'?parent='+alien['id']).status_code,404)
        self.assertEqual(self.client.get(self.collection+'?parent=invalid').status_code,400)

    def test_archived_parent_does_not_hide_active_descendants(self):
        child=self.child(self.page['id'])
        grandchild=self.child(child['id'])
        result=self.client.patch(self.detail,{'version':1,'client_id':str(uuid.uuid4()),'archived':True},format='json')
        self.assertEqual(result.status_code,200,result.data)
        self.assertEqual(self.ids('?parent=root'),[child['id']])
        self.assertEqual(self.ids('?parent=root&archived=true'),[self.page['id']])
        self.assertEqual(self.ids('?parent='+child['id']),[grandchild['id']])
        self.assertEqual(self.move(child['id'],self.page['id']).status_code,400)
        structure=self.client.get(self.collection+grandchild['id']+'/structure/').data
        self.assertTrue(structure['ancestors'][0]['archived'])

    def test_parent_catalog_excludes_entire_branch_and_is_bounded(self):
        child=self.child(self.page['id'])
        self.child(child['id'])
        other=self.child(None,'Elegible')
        endpoint=self.detail+'parent-options/'
        result=self.client.get(endpoint)
        self.assertEqual([row['id'] for row in result.data['results']],[other['id']])
        self.assertEqual(set(result.data['results'][0]),{'id','title','icon'})
        self.assertEqual(self.client.get(endpoint+'?q=zz').data['results'],[])
        self.assertEqual(self.client.get(endpoint+'?q='+'x'*81).status_code,400)

    def test_manage_restriction_read_only_and_private_no_owner_bypass(self):
        channel=DepartmentChannel.objects.get(pk=self.channel_id)
        channel.visibility='private';channel.save()
        for person in (self.owner,self.bob):
            client=self.as_person(person)
            self.assertEqual(client.get(self.detail+'structure/').status_code,404)
            self.assertEqual(client.get(self.detail+'parent-options/').status_code,404)
            self.assertEqual(self.move(self.page['id'],None,client=client).status_code,404)
        ChannelAccessRule.objects.create(channel=channel,employee=self.bob.employee,access='read')
        client=self.as_person(self.bob)
        self.assertEqual(client.get(self.detail+'structure/').status_code,200)
        self.assertEqual(self.move(self.page['id'],None,client=client).status_code,403)
        channel.visibility='public';channel.save()
        self.deny('slack.page.manage')
        self.assertEqual(self.move(self.page['id'],None).status_code,403)
        self.assertEqual(self.client.get(self.detail+'parent-options/').status_code,403)

    def test_archived_channel_readable_but_not_movable(self):
        DepartmentChannel.objects.filter(pk=self.channel_id).update(archived_at=timezone.now())
        self.assertEqual(self.client.get(self.detail+'structure/').status_code,200)
        self.assertEqual(self.move(self.page['id'],None).status_code,409)

    def test_content_save_cannot_reparent_and_move_does_not_reset_collaboration(self):
        from .page_collaboration import room_for
        row=ChannelPage.objects.get(pk=self.page['id'])
        room=room_for(row)
        epoch=room.epoch
        child=self.child()
        self.assertEqual(self.save(parent_id=child['id']).status_code,400)
        self.assertEqual(self.move(self.page['id'],child['id']).status_code,200)
        row.refresh_from_db();room.refresh_from_db()
        self.assertEqual(room.epoch,epoch)
        result=self.save(title='Edición tras mover')
        self.assertEqual(result.status_code,200,result.data)
        self.assertEqual(result.data['parent_id'],child['id'])

    def test_depth_limit_includes_moved_subtree(self):
        parent=self.page['id']
        for _ in range(19):
            parent=self.child(parent)['id']
        result=self.client.post(self.collection,{'client_id':str(uuid.uuid4()),'title':'Demasiado','parent_id':parent},format='json')
        self.assertEqual(result.status_code,400,result.data)
        branch=self.child()
        self.child(branch['id'])
        self.assertEqual(self.move(branch['id'],parent).status_code,400)


@skipUnless(connection.vendor=='postgresql','Requires isolated PostgreSQL row locks')
@override_settings(MESSAGING_PILOT_ENABLED=False)
class PageStructureConcurrencyTests(TransactionTestCase):
    root=PageConcurrencyTests.root
    identity=PageConcurrencyTests.identity
    as_person=PageConcurrencyTests.as_person
    parallel=PageConcurrencyTests.parallel
    setUp=PageConcurrencyTests.setUp

    def move(self, assignment, page, parent, token=None):
        return self.as_person(assignment).put(self.url+'pages/'+str(page)+'/structure/',
            {'version':1,'client_id':token or str(uuid.uuid4()),'parent_id':str(parent) if parent else None},format='json')

    def other(self):
        result=self.client.post(self.url+'pages/',{'client_id':str(uuid.uuid4()),'title':'Otra raíz'},format='json')
        self.assertEqual(result.status_code,201,result.data)
        return result.data['id']

    def test_cross_moves_cannot_create_cycle(self):
        first=ChannelPage.objects.get().pk;second=self.other()
        result=self.parallel([lambda:self.move(self.alice,first,second),lambda:self.move(self.bob,second,first)])
        self.assertEqual(sorted(code for code,_ in result),[200,400])

    def test_same_move_is_idempotent_under_race(self):
        first=ChannelPage.objects.get().pk;second=self.other();token=str(uuid.uuid4())
        result=self.parallel([lambda:self.move(self.alice,first,second,token),lambda:self.move(self.alice,first,second,token)])
        self.assertEqual([code for code,_ in result],[200,200])
        self.assertEqual(PageStructureReceipt.objects.count(),1)
        self.assertEqual(ChannelPage.objects.get(pk=first).structure_version,2)

    def test_two_destinations_require_review_of_new_structure(self):
        first=ChannelPage.objects.get().pk;second=self.other();third=self.other()
        result=self.parallel([lambda:self.move(self.alice,first,second),lambda:self.move(self.bob,first,third)])
        self.assertEqual(sorted(code for code,_ in result),[200,409])

    def test_move_and_live_text_edit_preserve_both_without_resetting_epoch(self):
        import base64
        from types import SimpleNamespace
        from django.test import RequestFactory
        from boldApp.autenticacion.services import create_session
        from .page_collaboration import initial_state, commit_update
        from .page_crdt import load_document, encode
        first=ChannelPage.objects.get().pk;second=self.other()
        _,session=create_session(self.alice.employee.user_account,RequestFactory().get('/',REMOTE_ADDR='127.0.0.1'))
        snapshot=initial_state(session.pk,self.alice.pk,first)
        doc=load_document(base64.b64decode(snapshot['update']));state=doc.get_state()
        doc['title'] += ' / Sigue editándose'
        operation={'type':'update','epoch':snapshot['epoch'],'client_id':str(uuid.uuid4()),
                   'update':encode(doc.get_update(state)),'state':encode(doc.get_state())}
        def edit():
            return SimpleNamespace(status_code=200,data=commit_update(session.pk,self.alice.pk,first,operation,'move-concurrency'))
        results=self.parallel([edit,lambda:self.move(self.bob,first,second)])
        self.assertEqual([code for code,_ in results],[200,200])
        page=ChannelPage.objects.get(pk=first)
        self.assertEqual((str(page.parent_id),page.version,page.structure_version),(second,2,2))
        self.assertIn('Sigue editándose',page.title)
        self.assertEqual(str(page.collaboration.epoch),snapshot['epoch'])
