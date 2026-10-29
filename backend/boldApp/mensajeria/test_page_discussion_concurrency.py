"""Real PostgreSQL row-lock proof; no SQLite substitutes for concurrent writes."""
import base64
import uuid
from types import SimpleNamespace
from unittest import skipUnless
from django.db import connection
from django.test import TransactionTestCase, RequestFactory, override_settings
from boldApp.core.models import Permission
from boldApp.autenticacion.services import create_session
from . import test_channels as base
from . import test_channel_concurrency as concurrency
from .models import ChannelPage, PageRevision, PageDiscussion, PageDiscussionComment
from .page_collaboration import initial_state, commit_update
from .page_crdt import load_document, encode


@skipUnless(connection.vendor=='postgresql','Requires isolated PostgreSQL')
@override_settings(MESSAGING_PILOT_ENABLED=False)
class DiscussionConcurrencyTests(TransactionTestCase):
    root=base.DepartmentChannelTests.root
    identity=base.DepartmentChannelTests.identity
    as_person=base.DepartmentChannelTests.as_person
    parallel=concurrency.ChannelConcurrencyTests.parallel

    def setUp(self):
        for resource,actions in (('channel',('read','create','manage','access')),('message',('create','update')),
                                ('page',('read','create','update','manage')),('page_comment',('read','create','update','delete','manage'))):
            for action in actions:Permission.objects.get_or_create(code=f'slack.{resource}.{action}',defaults={'module_code':'slack','resource':resource,'action':action,'risk_level':'low'})
        base.DepartmentChannelTests.setUp(self)
        self.block=str(uuid.uuid4())
        response=self.client.post(self.url+'pages/',{'client_id':str(uuid.uuid4()),'title':'Prueba concurrente','blocks':[{'id':self.block,'type':'paragraph','text':'Texto intacto'}]},format='json')
        self.assertEqual(response.status_code,201,response.data)
        self.page_id=response.data['id'];self.detail=self.url+'pages/'+self.page_id+'/'

    def create(self,payload):return self.as_person(self.alice).post(self.detail+'discussions/',payload,format='json')

    def thread(self):
        result=self.create({'client_id':str(uuid.uuid4()),'body':'Comentario inicial','block_id':self.block})
        self.assertEqual(result.status_code,201,result.data);return result.data

    def test_same_root_attempt_creates_one_thread_and_comment(self):
        payload={'client_id':str(uuid.uuid4()),'body':'Mismo intento','block_id':self.block}
        results=self.parallel([lambda:self.create(payload),lambda:self.create(payload)])
        self.assertEqual(sorted(code for code,_ in results),[200,201]);self.assertEqual(PageDiscussion.objects.count(),1);self.assertEqual(PageDiscussionComment.objects.count(),1)
        self.assertEqual(ChannelPage.objects.get().version,1);self.assertEqual(PageRevision.objects.count(),1)

    def test_two_own_sessions_cannot_silently_overwrite_same_comment_version(self):
        result=self.thread();url=self.detail+'discussion-comments/'+result['comment']['id']+'/'
        def edit(body):return self.as_person(self.alice).put(url,{'client_id':str(uuid.uuid4()),'version':1,'body':body},format='json')
        results=self.parallel([lambda:edit('Uno'),lambda:edit('Dos')])
        self.assertEqual(sorted(code for code,_ in results),[200,409]);self.assertEqual(PageDiscussionComment.objects.get().version,2)
        self.assertEqual(ChannelPage.objects.get().version,1)

    def test_reply_and_resolution_serialize_without_reply_after_resolution(self):
        result=self.thread();thread=result['thread'];url=self.detail+'discussions/'+thread['id']+'/'
        results=self.parallel([
            lambda:self.as_person(self.alice).put(url+'resolution/',{'client_id':str(uuid.uuid4()),'version':1,'resolved':True},format='json'),
            lambda:self.as_person(self.bob).post(url+'comments/',{'client_id':str(uuid.uuid4()),'body':'Respuesta simultánea'},format='json'),
        ])
        self.assertEqual(results[0][0],200)
        self.assertIn(results[1][0],(201,409))
        discussion=PageDiscussion.objects.get();self.assertIsNotNone(discussion.resolved_at)
        for comment in discussion.comments.exclude(pk=discussion.root_id):self.assertLessEqual(comment.created_at,discussion.resolved_at)

    def test_crdt_and_comment_preserve_each_other_without_extra_page_revision(self):
        session=create_session(self.alice.employee.user_account,RequestFactory().get('/',REMOTE_ADDR='127.0.0.1'))[1]
        initial=initial_state(session.pk,self.alice.pk,self.page_id)
        doc=load_document(base64.b64decode(initial['update']));before=doc.get_state();doc['title']+=' / edición concurrente'
        payload={'type':'update','client_id':str(uuid.uuid4()),'epoch':initial['epoch'],'update':encode(doc.get_update(before)),'state':encode(doc.get_state())}
        def edit():return SimpleNamespace(status_code=200,data=commit_update(session.pk,self.alice.pk,self.page_id,payload,'comment-race'))
        results=self.parallel([edit,lambda:self.create({'client_id':str(uuid.uuid4()),'block_id':self.block,'body':'Comentario simultáneo'})])
        self.assertEqual([code for code,_ in results],[200,201])
        page=ChannelPage.objects.get();self.assertIn('edición concurrente',page.title);self.assertEqual(page.version,2)
        # CRDT keeps periodic checkpoints, not one revision per keystroke.
        # Comments must not introduce an extra content checkpoint either.
        self.assertEqual(PageRevision.objects.count(),1);self.assertEqual(PageDiscussion.objects.count(),1);self.assertEqual(page.blocks[0]['text'],'Texto intacto')
