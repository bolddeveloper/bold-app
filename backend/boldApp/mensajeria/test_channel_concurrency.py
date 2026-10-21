"""Executable lock checks, intentionally NOT certified by the SQLite suite.

Run with config.settings_test_postgres and an isolated BOLD_TEST_DATABASE_URL.
"""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest import skipUnless
import uuid

from django.db import close_old_connections, connection, connections
from django.test import TransactionTestCase, override_settings
from boldApp.core.models import Permission
from . import test_channels as base
from .models import ChannelMessage, ChannelReadState, ChannelSubscription, DepartmentChannel


@skipUnless(connection.vendor=="postgresql", "Requires isolated PostgreSQL; SQLite cannot prove row locks")
@override_settings(MESSAGING_PILOT_ENABLED=False)
class ChannelConcurrencyTests(TransactionTestCase):
    root=base.DepartmentChannelTests.root
    identity=base.DepartmentChannelTests.identity
    as_person=base.DepartmentChannelTests.as_person
    send=base.DepartmentChannelTests.send

    def setUp(self):
        # TransactionTestCase flushes catalog migration rows between methods.
        for resource,action in (("channel","read"),("channel","create"),("channel","manage"),("message","create"),("message","update")):
            Permission.objects.get_or_create(code=f"slack.{resource}.{action}",defaults={"module_code":"slack","resource":resource,"action":action,"risk_level":"low"})
        base.DepartmentChannelTests.setUp(self)

    def parallel(self, actions):
        barrier=Barrier(len(actions),timeout=10)
        def work(action):
            close_old_connections()
            try:
                barrier.wait()
                response=action()
                return response.status_code,response.data
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=len(actions)) as pool:
            futures=[pool.submit(work,action) for action in actions]
            return [future.result(timeout=20) for future in futures]

    def post(self,assignment,token,**extra):
        return self.as_person(assignment).post(self.url+"messages/",{"body":"Envío concurrente","client_id":str(token),**extra},format="json")

    def test_same_send_in_two_sessions_commits_once_and_replays_the_other_response(self):
        token=uuid.uuid4()
        results=self.parallel([lambda:self.post(self.alice,token),lambda:self.post(self.alice,token)])
        self.assertEqual(sorted(code for code,data in results),[200,201])
        self.assertEqual(len({data["message"]["id"] for code,data in results}),1)
        self.assertEqual(ChannelMessage.objects.count(),1)
        self.assertEqual(DepartmentChannel.objects.get(pk=self.channel_id).activity_version,1)

    def test_different_authors_get_distinct_monotone_reply_sequences(self):
        parent=self.send().data["message"]
        results=self.parallel([lambda:self.post(self.alice,uuid.uuid4(),parent_id=parent["id"]),lambda:self.post(self.bob,uuid.uuid4(),parent_id=parent["id"])])
        self.assertEqual([code for code,data in results],[201,201])
        self.assertEqual(list(ChannelMessage.objects.order_by("sequence").values_list("sequence",flat=True)),[1,2,3])
        self.assertEqual(DepartmentChannel.objects.get(pk=self.channel_id).activity_version,3)

    def test_following_and_reading_cannot_lose_each_others_personal_revision(self):
        message=self.send().data["message"]
        results=self.parallel([
            lambda:self.as_person(self.bob).put(self.url+"following/",{"following":True},format="json"),
            lambda:self.as_person(self.bob).post(self.url+"read/",{"message_id":message["id"]},format="json"),
        ])
        self.assertEqual([code for code,data in results],[200,200])
        state=ChannelSubscription.objects.get(channel_id=self.channel_id,employee=self.bob.employee)
        self.assertTrue(state.following)
        self.assertEqual(state.revision,2)
        self.assertEqual(ChannelReadState.objects.get(channel_id=self.channel_id,employee=self.bob.employee).sequence,1)
