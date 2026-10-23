"""Run on isolated PostgreSQL; SQLite does not certify the row-lock protocol."""
import uuid
from unittest import skipUnless
from django.db import connection
from django.test import TransactionTestCase, override_settings
from boldApp.core.models import Permission
from . import test_channel_concurrency as concurrency
from . import test_channels as base
from .models import ChannelPage, PageRevision


@skipUnless(connection.vendor == "postgresql", "Requires isolated PostgreSQL; SQLite cannot prove row locks")
@override_settings(MESSAGING_PILOT_ENABLED=False)
class PageConcurrencyTests(TransactionTestCase):
    root = base.DepartmentChannelTests.root
    identity = base.DepartmentChannelTests.identity
    as_person = base.DepartmentChannelTests.as_person
    parallel = concurrency.ChannelConcurrencyTests.parallel

    def setUp(self):
        for resource, actions in (("channel", ("read", "create", "manage", "access")), ("message", ("create", "update")),
                                  ("page", ("read", "create", "update", "manage"))):
            for action in actions:
                Permission.objects.get_or_create(code=f"slack.{resource}.{action}", defaults={"module_code": "slack", "resource": resource, "action": action, "risk_level": "low"})
        base.DepartmentChannelTests.setUp(self)
        result = self.client.post(self.url+"pages/", {"client_id":str(uuid.uuid4()), "title":"Documento concurrente"}, format="json")
        self.assertEqual(result.status_code, 201, result.data)
        self.detail = self.url+"pages/"+result.data["id"]+"/"

    def put(self, assignment, token, title):
        return self.as_person(assignment).put(self.detail, {"client_id":str(token), "version":1, "title":title, "blocks":[], "icon":"note"}, format="json")

    def test_two_writers_same_revision_accept_exactly_one_without_losing_history(self):
        results = self.parallel([lambda:self.put(self.alice,uuid.uuid4(),"Uno"), lambda:self.put(self.bob,uuid.uuid4(),"Dos")])
        self.assertEqual(sorted(code for code,_ in results), [200,409])
        self.assertEqual(ChannelPage.objects.get().version, 2)
        self.assertEqual(PageRevision.objects.count(), 2)

    def test_same_operation_retries_create_exactly_one_revision(self):
        token=uuid.uuid4()
        results=self.parallel([lambda:self.put(self.alice,token,"Uno"),lambda:self.put(self.alice,token,"Uno")])
        self.assertEqual([code for code,_ in results],[200,200])
        self.assertEqual(ChannelPage.objects.get().version, 2)
        self.assertEqual(PageRevision.objects.count(), 2)
