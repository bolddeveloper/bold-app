import json
import uuid
from django.test import TestCase, override_settings
from . import test_pages as base
from .models import ChannelPage, PageRevision, PageDiscussion, PageDiscussionComment, PageDiscussionReceipt, DepartmentChannel, ChannelAccessRule
from boldApp.core.models import Permission
from .channel_events import channel_event


@override_settings(MESSAGING_PILOT_ENABLED=False, AUTH_ENCRYPTION_KEY='page-discussions-test-only')
class PageDiscussionTests(TestCase):
    root=base.ChannelPageTests.root
    identity=base.ChannelPageTests.identity
    as_person=base.ChannelPageTests.as_person
    deny=base.ChannelPageTests.deny
    send=base.ChannelPageTests.send
    blocks=base.ChannelPageTests.blocks
    setUp=base.ChannelPageTests.setUp
    save=base.ChannelPageTests.save

    def discussion(self, client=None, **extra):
        result=(client or self.client).post(self.detail+'discussions/',{'client_id':str(uuid.uuid4()),
            'block_id':self.page['blocks'][0]['id'],'body':'Revisar este acuerdo',**extra},format='json')
        self.assertEqual(result.status_code,201,result.data)
        return result.data

    def comments(self, thread):
        return self.detail+'discussions/'+thread['id']+'/comments/'

    def resolution(self, thread):
        return self.detail+'discussions/'+thread['id']+'/resolution/'

    def comment(self, row):
        return self.detail+'discussion-comments/'+row['id']+'/'

    def test_comments_do_not_change_page_or_revisions_and_have_no_block_snapshot(self):
        before=ChannelPage.objects.get(pk=self.page['id']);count=PageRevision.objects.count()
        result=self.discussion();thread=result['thread']
        response=self.client.get(self.comments(thread))
        self.assertEqual(len(response.data['results']),1)
        self.assertTrue(response.data['results'][0]['can_edit'])
        summary=self.client.get(self.detail+'discussions/summary/')
        self.assertEqual(summary.data['blocks'],[{'id':self.page['blocks'][0]['id'],'open':1,'resolved':0}])
        self.assertNotIn('Primer acuerdo',json.dumps(summary.data))
        after=ChannelPage.objects.get(pk=before.pk)
        self.assertEqual((after.blocks,after.version,after.updated_at),(before.blocks,before.version,before.updated_at))
        self.assertEqual(PageRevision.objects.count(),count)
        self.assertEqual(self.client.get(self.detail).data['blocks'],self.page['blocks'])

    def test_foreign_comments_cannot_be_edited_deleted_even_by_owner(self):
        result=self.discussion();row=result['comment']
        for assignment in (self.bob,self.owner):
            client=self.as_person(assignment)
            projected=client.get(self.comments(result['thread'])).data['results'][0]
            self.assertFalse(projected['can_edit']);self.assertFalse(projected['can_delete'])
            for method,url,payload in ((client.put,self.comment(row),{'body':'Cambio ajeno'}),
                (client.post,self.comment(row)+'delete/',{})):
                response=method(url,{'client_id':str(uuid.uuid4()),'version':999,**payload},format='json')
                self.assertEqual(response.status_code,403,response.data)
                self.assertNotIn('current_comment',response.data)
        self.assertEqual(PageDiscussionComment.objects.get(pk=row['id']).body,row['body'])

    def test_own_edit_conflict_tombstone_and_retries(self):
        result=self.discussion();row=result['comment'];url=self.comment(row)
        attempt={'client_id':str(uuid.uuid4()),'version':1,'body':'Nuevo https://bold.gt'}
        self.assertEqual(self.client.put(url,attempt,format='json').status_code,200)
        stale=self.client.put(url,{**attempt,'client_id':str(uuid.uuid4()),'body':'No pisar'},format='json')
        self.assertEqual(stale.status_code,409);self.assertEqual(stale.data['current_comment']['version'],2)
        deletion={'client_id':str(uuid.uuid4()),'version':2}
        self.assertEqual(self.client.post(url+'delete/',deletion,format='json').status_code,200)
        retry=self.client.put(url,attempt,format='json')
        self.assertEqual(retry.status_code,200);self.assertEqual(retry.data['accepted_version'],2)
        self.assertEqual(retry.data['comment']['body'],'');self.assertIsNotNone(retry.data['comment']['deleted_at'])
        self.assertEqual(self.client.post(url+'delete/',deletion,format='json').status_code,200)
        row=PageDiscussionComment.objects.get(pk=row['id']);self.assertEqual(row.version,3);self.assertEqual(row.body,'')
        self.assertEqual(self.client.delete(url).status_code,405)

    def test_create_retry_cannot_change_body_block_or_action(self):
        payload={'client_id':str(uuid.uuid4()),'block_id':self.page['blocks'][0]['id'],'body':'Mismo intento'}
        first=self.client.post(self.detail+'discussions/',payload,format='json')
        self.assertEqual(first.status_code,201,first.data)
        for _ in range(2):self.assertEqual(self.client.post(self.detail+'discussions/',payload,format='json').status_code,200)
        for extra in ({'body':'Otro'}, {'block_id':str(uuid.uuid4())}):
            self.assertEqual(self.client.post(self.detail+'discussions/',{**payload,**extra},format='json').status_code,409)
        self.assertEqual(self.client.post(self.comments(first.data['thread']),{'client_id':payload['client_id'],'body':payload['body']},format='json').status_code,409)
        self.assertEqual(PageDiscussion.objects.count(),1);self.assertEqual(PageDiscussionReceipt.objects.count(),1)

    def test_resolution_versions_reply_retry_and_root_delete_preserves_foreign_reply(self):
        result=self.discussion();thread=result['thread'];bob=self.as_person(self.bob)
        payload={'client_id':str(uuid.uuid4()),'body':'Respuesta del colega'}
        reply=bob.post(self.comments(thread),payload,format='json');self.assertEqual(reply.status_code,201,reply.data)
        action={'client_id':str(uuid.uuid4()),'version':1,'resolved':True}
        resolved=self.client.put(self.resolution(thread),action,format='json');self.assertEqual(resolved.status_code,200,resolved.data)
        self.assertEqual(bob.post(self.comments(thread),payload,format='json').status_code,200)
        self.assertEqual(bob.post(self.comments(thread),{**payload,'client_id':str(uuid.uuid4())},format='json').status_code,409)
        self.assertEqual(self.client.put(self.resolution(thread),{**action,'client_id':str(uuid.uuid4()),'resolved':False},format='json').status_code,409)
        self.assertEqual(self.client.post(self.comment(result['comment'])+'delete/',{'client_id':str(uuid.uuid4()),'version':1},format='json').status_code,200)
        comments=list(reversed(bob.get(self.comments(thread)).data['results']))
        self.assertEqual(comments[0]['body'],'');self.assertEqual(comments[1]['body'],payload['body'])
        reopened=self.client.put(self.resolution(thread),{**action,'version':2,'client_id':str(uuid.uuid4()),'resolved':False},format='json')
        self.assertEqual(reopened.status_code,200);self.assertTrue(reopened.data['thread']['can_reply'])

    def test_comment_permissions_independent_of_page_edit_and_resolution(self):
        result=self.discussion(self.as_person(self.bob));thread=result['thread']
        self.deny('slack.page.update')
        self.assertEqual(self.save(title='No').status_code,403)
        own=self.discussion();self.assertTrue(own['thread']['can_resolve'])
        self.assertEqual(self.client.put(self.resolution(thread),{'client_id':str(uuid.uuid4()),'version':1,'resolved':True},format='json').status_code,403)
        self.deny('slack.page_comment.create')
        self.assertEqual(self.client.post(self.comments(thread),{'client_id':str(uuid.uuid4()),'body':'No'},format='json').status_code,403)
        self.assertEqual(self.client.get(self.comments(thread)).status_code,200)
        self.deny('slack.page_comment.read')
        response=self.client.get(self.comments(thread));self.assertEqual(response.status_code,403)
        self.assertEqual(response.data['resource'],'page_comments');self.assertEqual(self.client.get(self.detail).status_code,200)
        self.assertFalse(self.client.get(self.detail).data['can_read_comments'])

    def test_private_invitation_archival_and_other_page_boundaries(self):
        result=self.discussion();thread=result['thread'];bob=self.as_person(self.bob)
        channel=DepartmentChannel.objects.get(pk=self.channel_id);channel.visibility='private';channel.save()
        ChannelAccessRule.objects.create(channel=channel,employee=self.alice.employee,access='write')
        self.assertEqual(bob.get(self.comments(thread)).status_code,404)
        self.assertEqual(self.as_person(self.owner).get(self.comments(thread)).status_code,404)
        ChannelAccessRule.objects.create(channel=channel,employee=self.bob.employee,access='read')
        self.assertEqual(bob.get(self.comments(thread)).status_code,200)
        self.assertEqual(bob.post(self.comments(thread),{'client_id':str(uuid.uuid4()),'body':'No'},format='json').status_code,403)
        channel.archived_at=base.timezone.now();channel.save()
        self.assertFalse(self.client.get(self.comments(thread)).data['thread']['can_resolve'])
        self.assertEqual(self.client.put(self.comment(result['comment']),{'client_id':str(uuid.uuid4()),'version':1,'body':'No'},format='json').status_code,409)

    def test_removed_block_keeps_historical_thread_without_recreating_block(self):
        result=self.discussion();thread=result['thread'];block=self.page['blocks'][0]['id']
        self.assertEqual(self.save(blocks=[]).status_code,200)
        read=self.client.get(self.comments(thread));self.assertFalse(read.data['thread']['anchor_present'])
        self.assertEqual(self.client.post(self.comments(thread),{'client_id':str(uuid.uuid4()),'body':'Aclaración sobre el bloque retirado'},format='json').status_code,201)
        self.assertEqual(self.client.post(self.detail+'discussions/',{'client_id':str(uuid.uuid4()),'block_id':block,'body':'No recrear'},format='json').status_code,409)
        self.assertEqual(ChannelPage.objects.get(pk=self.page['id']).blocks,[])
        self.assertEqual(self.client.patch(self.detail,{'client_id':str(uuid.uuid4()),'version':2,'restore_version':1},format='json').status_code,200)
        self.assertTrue(self.client.get(self.comments(thread)).data['thread']['anchor_present'])

    def test_validation_pagination_filtering_and_foreign_ids(self):
        result=self.discussion();thread=result['thread']
        for values in ({'body':''},{'body':'x'*4001},{'unknown':True},{'block_id':str(uuid.uuid4())}):
            response=self.client.post(self.detail+'discussions/',{'client_id':str(uuid.uuid4()),'block_id':self.page['blocks'][0]['id'],'body':'Seguro',**values},format='json')
            self.assertEqual(response.status_code,409 if 'block_id' in values else 400,response.data)
        for suffix in ('?state=bad','?state=open&state=all','?block=bad','?q=hidden'):
            self.assertEqual(self.client.get(self.detail+'discussions/'+suffix).status_code,400)
        self.assertEqual(self.client.get(self.comments({'id':str(uuid.uuid4())})).status_code,404)
        self.assertEqual(self.client.get(self.detail+'discussions/?block='+str(uuid.uuid4())).data['results'],[])
        for i in range(26):PageDiscussionComment.objects.create(thread_id=thread['id'],author=self.bob.employee,body=str(i))
        first=self.client.get(self.comments(thread));self.assertEqual(len(first.data['results']),25)
        last=self.client.get(first.data['next']);self.assertEqual(len(last.data['results']),2)
        self.assertIn('no-store',first['Cache-Control'])

    def test_draft_grants_bound_to_author_mode_and_live_access(self):
        result=self.discussion();thread=result['thread'];row=result['comment'];grant='/api/v2/messaging/draft-grants/'
        scope={'kind':'page-discussion','channel_id':self.channel_id,'resource_id':self.page['id'],'mode':'edit','parent_id':row['id']}
        own=self.client.post(grant,scope,format='json');self.assertEqual(own.status_code,200,own.data)
        self.assertTrue(own.data['can_write'])
        for person in (self.bob,self.owner):self.assertEqual(self.as_person(person).post(grant,scope,format='json').status_code,404)
        root={**scope,'mode':'root','parent_id':thread['block_id']}
        self.assertNotEqual(own.data['key_id'],self.client.post(grant,root,format='json').data['key_id'])
        self.assertEqual(self.save(blocks=[]).status_code,200)
        recovered=self.client.post(grant,root,format='json');self.assertEqual(recovered.status_code,200);self.assertFalse(recovered.data['can_write'])
        self.deny('slack.page_comment.read');self.assertEqual(self.client.post(grant,root,format='json').status_code,403)

    def test_realtime_hint_requires_comment_and_page_access_and_contains_no_body(self):
        result=self.discussion();event={'channel_id':self.channel_id,'kind':'page.comments_changed'}
        visible=channel_event(self.bob.pk,event);self.assertIsNotNone(visible)
        for secret in (result['thread']['id'],result['comment']['body'],self.page['id']):self.assertNotIn(secret,json.dumps(visible,default=str))
        self.deny('slack.page_comment.read');self.assertIsNone(channel_event(self.bob.pk,event))

    def test_individual_comment_actions_and_session_assurance_are_enforced(self):
        result=self.discussion();row=result['comment']
        self.deny('slack.page_comment.update');self.deny('slack.page_comment.delete')
        self.assertEqual(self.client.put(self.comment(row),{'client_id':str(uuid.uuid4()),'version':1,'body':'No'},format='json').status_code,403)
        self.assertEqual(self.client.post(self.comment(row)+'delete/',{'client_id':str(uuid.uuid4()),'version':1},format='json').status_code,403)
        self.discussion(body='Crear sigue permitido')
        permission=Permission.objects.get(code='slack.page_comment.read');permission.requires_step_up_mfa=True;permission.save()
        response=self.client.get(self.detail+'discussions/');self.assertEqual(response.status_code,403,response.data)
        self.assertIsNone(channel_event(self.bob.pk,{'channel_id':self.channel_id,'kind':'page.comments_changed'}))
        self.assertEqual(self.client.get(self.detail).status_code,200)
