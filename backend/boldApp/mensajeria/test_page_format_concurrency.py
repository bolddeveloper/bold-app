import base64
import uuid
from types import SimpleNamespace
from unittest import skipUnless
from django.db import connection
from django.test import TransactionTestCase, RequestFactory, override_settings
from boldApp.autenticacion.services import create_session
from . import test_page_concurrency as base
from .models import ChannelPage
from .page_collaboration import initial_state, commit_update
from .page_crdt import encode, load_document


@skipUnless(connection.vendor=='postgresql','Requires isolated PostgreSQL')
@override_settings(MESSAGING_PILOT_ENABLED=False)
class PageFormatConcurrencyTests(TransactionTestCase):
    root=base.PageConcurrencyTests.root
    identity=base.PageConcurrencyTests.identity
    as_person=base.PageConcurrencyTests.as_person
    parallel=base.PageConcurrencyTests.parallel
    setUp=base.PageConcurrencyTests.setUp

    def test_concurrent_style_and_peer_typing_merge_without_losing_either(self):
        page=ChannelPage.objects.get();block=str(uuid.uuid4());page.blocks=[{'id':block,'type':'paragraph','text':'😀 acuerdo'}];page.save()
        sessions=[create_session(person.employee.user_account,RequestFactory().get('/',REMOTE_ADDR='127.0.0.1'))[1] for person in (self.alice,self.bob)]
        initial=initial_state(sessions[0].pk,self.alice.pk,page.pk)
        documents=[load_document(base64.b64decode(initial['update'])) for _ in range(2)];state=documents[0].get_state()
        documents[0]['blocks'][block]['text'].format(5,12,{'bold':True})
        documents[1]['blocks'][block]['text'].insert(0,'Nota: ')
        def apply(index):
            doc=documents[index];person=(self.alice,self.bob)[index]
            return SimpleNamespace(status_code=200,data=commit_update(sessions[index].pk,person.pk,page.pk,{'type':'update','epoch':initial['epoch'],
                'client_id':str(uuid.uuid4()),'update':encode(doc.get_update(state)),'state':encode(doc.get_state())},'concurrent-format'))
        results=self.parallel([lambda:apply(0),lambda:apply(1)]);self.assertEqual([code for code,_ in results],[200,200])
        page.refresh_from_db();self.assertEqual(page.blocks[0]['text'],'Nota: 😀 acuerdo');self.assertEqual(page.blocks[0]['formats'],[{'start':9,'end':16,'bold':True}])
