import uuid
from unittest import skipUnless
from django.db import connection
from django.test import TransactionTestCase,override_settings
from . import test_channel_concurrency as base
from . import test_history_search as history
from .models import DirectConversation,MessageReaction,SearchDocument


@skipUnless(connection.vendor=='postgresql','Requires isolated PostgreSQL row locks')
@override_settings(MESSAGING_PILOT_ENABLED=False)
class ReactionConcurrencyTests(TransactionTestCase):
    root=base.ChannelConcurrencyTests.root
    identity=base.ChannelConcurrencyTests.identity
    as_person=base.ChannelConcurrencyTests.as_person
    parallel=base.ChannelConcurrencyTests.parallel
    direct=history.HistorySearchTests.direct

    def setUp(self):
        base.ChannelConcurrencyTests.setUp(self)
        self.chat=DirectConversation.objects.create(**dict(zip(('first_employee_id','second_employee_id'),sorted([self.alice.employee_id,self.bob.employee_id]))))

    def react(self,message,actor,token,key='thumbs_up'):
        return self.as_person(actor).put(f'/api/v2/messaging/conversations/{self.chat.pk}/messages/{message.pk}/reactions/',
            {'key':key,'active':True,'version':0,'client_id':str(token)},format='json')

    def test_identical_concurrent_retry_is_one_reaction_and_one_tick(self):
        message=self.direct('Uno');token=uuid.uuid4()
        results=self.parallel([lambda:self.react(message,self.alice,token),lambda:self.react(message,self.alice,token)])
        self.assertEqual([code for code,_ in results],[200,200])
        self.assertEqual(MessageReaction.objects.count(),1)
        self.assertEqual(SearchDocument.objects.get(direct=message).reaction_version,1)

    def test_two_people_do_not_conflict_or_lose_counts(self):
        message=self.direct('Ambos')
        results=self.parallel([lambda:self.react(message,self.alice,uuid.uuid4()),lambda:self.react(message,self.bob,uuid.uuid4())])
        self.assertEqual([code for code,_ in results],[200,200])
        self.assertEqual(MessageReaction.objects.count(),2)
        self.assertEqual(SearchDocument.objects.get(direct=message).reaction_version,2)

    def test_same_actor_stale_writers_do_not_silently_overwrite(self):
        message=self.direct('Una decisión')
        results=self.parallel([lambda:self.react(message,self.alice,uuid.uuid4()),lambda:self.react(message,self.alice,uuid.uuid4(),'heart')])
        self.assertEqual(sorted(code for code,_ in results),[200,409])
        self.assertEqual(MessageReaction.objects.count(),1)
