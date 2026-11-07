"""Exercise real row claims on the production database engine."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest import skipUnless

from django.db import close_old_connections, connection
from django.test import TransactionTestCase, override_settings
from boldApp.core.models import Permission

from .models import SupportRequest
from .support_bot import process
from . import test_support_bot as base_support


@skipUnless(connection.vendor == 'postgresql', 'Requires PostgreSQL row locking.')
@override_settings(DEBUG=True, MESSAGING_PILOT_ENABLED=False, BOLD_SUPPORT_ENABLED=True,
                   BOLD_SUPPORT_DAILY_LIMIT=100, BOLD_SUPPORT_USER_DAILY_LIMIT=20)
class SupportConcurrencyTests(TransactionTestCase):
    root = base_support.SupportTests.root
    identity = base_support.SupportTests.identity
    as_person = base_support.SupportTests.as_person
    deny = base_support.SupportTests.deny
    send = base_support.SupportTests.send
    ask = base_support.SupportTests.ask

    def setUp(self):
        for resource, action in (('channel','read'),('channel','create'),('channel','manage'),('message','create'),('message','update')):
            Permission.objects.get_or_create(code=f'slack.{resource}.{action}', defaults={
                'module_code':'slack','resource':resource,'action':action,'risk_level':'low'})
        base_support.SupportTests.setUp(self)

    def test_two_workers_claim_a_question_once(self):
        source = self.ask()
        request_id = SupportRequest.objects.get(source=source).pk
        gate = Barrier(2)

        def run():
            close_old_connections()
            try:
                gate.wait(timeout=10)
                return process(request_id)
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: run(), range(2)))
        self.assertEqual(sorted(results), [False, True])
        self.model.assert_called_once()
        self.assertEqual(SupportRequest.objects.get(pk=request_id).state, 'completed')
