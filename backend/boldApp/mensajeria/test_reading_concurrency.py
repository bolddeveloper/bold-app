"""Personal reminder serialization must be certified on isolated PostgreSQL."""
import uuid
from unittest import skipUnless
from django.db import connection
from django.test import TransactionTestCase,override_settings
from . import test_channel_concurrency as base
from . import test_history_search as history
from .models import DirectConversation,ReadingReminder,ReadingReminderClock


@skipUnless(connection.vendor=='postgresql','Requires isolated PostgreSQL row locks')
@override_settings(MESSAGING_PILOT_ENABLED=False)
class ReadingConcurrencyTests(TransactionTestCase):
    root=base.ChannelConcurrencyTests.root
    identity=base.ChannelConcurrencyTests.identity
    as_person=base.ChannelConcurrencyTests.as_person
    parallel=base.ChannelConcurrencyTests.parallel
    direct=history.HistorySearchTests.direct
    channel_message=history.HistorySearchTests.channel_message
    endpoint='/api/v2/messaging/reading-reminders/'

    def setUp(self):
        base.ChannelConcurrencyTests.setUp(self)
        self.chat=DirectConversation.objects.create(**dict(zip(('first_employee_id','second_employee_id'),sorted([self.alice.employee_id,self.bob.employee_id]))))

    def mark(self,message,token,kind='chat'):
        return self.as_person(self.alice).put(self.endpoint,{'kind':kind,'source_id':str(message.pk),'version':0,'client_id':str(token)},format='json')

    def test_parallel_identical_attempt_is_one_mark_and_one_clock_tick(self):
        message=self.direct('Reintento');token=uuid.uuid4()
        results=self.parallel([lambda:self.mark(message,token),lambda:self.mark(message,token)])
        self.assertEqual([code for code,_ in results],[200,200])
        self.assertEqual(ReadingReminder.objects.count(),1)
        self.assertEqual(ReadingReminderClock.objects.get(employee=self.alice.employee).version,1)

    def test_two_stale_writers_for_one_scope_accept_exactly_one_anchor(self):
        first=self.direct('Uno');second=self.direct('Dos')
        results=self.parallel([lambda:self.mark(first,uuid.uuid4()),lambda:self.mark(second,uuid.uuid4())])
        self.assertEqual(sorted(code for code,_ in results),[200,409])
        self.assertEqual(ReadingReminder.objects.count(),1)
        self.assertEqual(ReadingReminderClock.objects.get(employee=self.alice.employee).version,1)

    def test_different_scopes_keep_both_marks_and_monotone_collection_versions(self):
        direct=self.direct('Privado');channel=self.channel_message('Canal')
        results=self.parallel([lambda:self.mark(direct,uuid.uuid4()),lambda:self.mark(channel,uuid.uuid4(),'channel')])
        self.assertEqual([code for code,_ in results],[200,200])
        self.assertEqual(ReadingReminder.objects.filter(document__isnull=False).count(),2)
        self.assertEqual(sorted(data['reading']['version'] for _,data in results),[1,2])
