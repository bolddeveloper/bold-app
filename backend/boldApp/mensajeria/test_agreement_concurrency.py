import uuid
from unittest import skipUnless
from django.db import connection
from django.test import TransactionTestCase, override_settings
from boldApp.core.models import Permission
from . import test_agreements as fixture
from . import test_channel_concurrency as concurrent
from .models import MessageAgreement, ChannelPage


@skipUnless(connection.vendor=='postgresql','Requires isolated PostgreSQL row locks')
@override_settings(MESSAGING_PILOT_ENABLED=False,AUTH_ENCRYPTION_KEY='agreement-concurrency-test-only')
class AgreementConcurrencyTests(TransactionTestCase):
    root=fixture.AgreementTests.root
    identity=fixture.AgreementTests.identity
    as_person=fixture.AgreementTests.as_person
    blocks=fixture.AgreementTests.blocks
    direct=fixture.AgreementTests.direct
    channel_message=fixture.AgreementTests.channel_message
    create=fixture.AgreementTests.create
    parallel=concurrent.ChannelConcurrencyTests.parallel

    def setUp(self):
        for resource,action in (('channel','read'),('channel','create'),('channel','manage'),('channel','access'),('message','create'),('message','update'),('page','read'),('page','create'),('page','update'),('page','manage')):
            Permission.objects.get_or_create(code=f'slack.{resource}.{action}',defaults={'module_code':'slack','resource':resource,'action':action,'risk_level':'low'})
        fixture.AgreementTests.setUp(self)

    def test_same_attempt_creates_one_page_and_one_initial_revision(self):
        count=ChannelPage.objects.count()
        results=self.parallel([lambda:self.create(self.as_person(self.alice)),lambda:self.create(self.as_person(self.alice))])
        self.assertEqual(sorted(code for code,_ in results),[200,201])
        self.assertEqual(len({data['page']['id'] for _,data in results}),1)
        self.assertEqual(ChannelPage.objects.count(),count+1);self.assertEqual(MessageAgreement.objects.count(),1)
        self.assertEqual(MessageAgreement.objects.get().page.revisions.count(),1)

    def test_same_identifier_cannot_accept_different_content(self):
        results=self.parallel([lambda:self.create(self.as_person(self.alice)),lambda:self.create(self.as_person(self.alice),title='Otro acuerdo')])
        self.assertEqual(sorted(code for code,_ in results),[201,409]);self.assertEqual(MessageAgreement.objects.count(),1)

    def test_cross_channel_creations_acquire_locks_in_one_order(self):
        other=self.client.post(self.root,{'name':'Segundo canal','unit_id':str(self.it.pk)},format='json');self.assertEqual(other.status_code,201,other.data)
        first=self.channel_message('Origen A')
        from .models import ChannelMessage
        second=ChannelMessage.objects.create(channel_id=other.data['id'],author=self.bob.employee,author_assignment=self.bob,
            department_name='Marketing',department_color='#9250A3',sequence=1,client_id=uuid.uuid4(),payload_digest='concurrent-fixture',body='Origen B')
        def convert(actor,source,destination,message):
            return self.as_person(actor).post(f'/api/v2/messaging/channels/{source}/agreements/',{**self.values,
                'client_id':str(uuid.uuid4()),'destination_channel_id':str(destination),
                'entries':[{'message_id':str(message.pk),'source_version':1,'text':message.body}]},format='json')
        results=self.parallel([lambda:convert(self.alice,self.channel_id,other.data['id'],first),lambda:convert(self.bob,other.data['id'],self.channel_id,second)])
        self.assertEqual([code for code,_ in results],[201,201]);self.assertEqual(MessageAgreement.objects.count(),2)
