import base64
import uuid
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from . import test_pages as fixtures
from .models import ChannelAccessEpoch, ChannelAccessRule, DepartmentChannel, DirectConversation


@override_settings(MESSAGING_PILOT_ENABLED=False, AUTH_ENCRYPTION_KEY="draft-grant-test-secret")
class DraftGrantTests(TestCase):
    root = fixtures.ChannelPageTests.root
    identity = fixtures.ChannelPageTests.identity
    as_person = fixtures.ChannelPageTests.as_person
    blocks = fixtures.ChannelPageTests.blocks
    deny = fixtures.ChannelPageTests.deny
    endpoint = "/api/v2/messaging/draft-grants/"

    def setUp(self):
        fixtures.ChannelPageTests.setUp(self)
        self.scope = {"kind": "page", "resource_id": self.page["id"], "channel_id": self.channel_id}

    def grant(self, scope=None, client=None):
        return (client or self.client).post(self.endpoint, scope or self.scope, format="json")

    def test_resource_account_assignment_bound_and_private(self):
        first, again = self.grant(), self.grant()
        self.assertEqual(first.status_code, 200, first.data)
        self.assertEqual(len(base64.b64decode(first.data["key"])), 32)
        self.assertEqual(first.data["key"], again.data["key"])
        self.assertIn("no-store", first["Cache-Control"])
        self.assertTrue(first.data["can_write"])
        self.assertNotIn("title", first.data)
        self.assertEqual(first.data["scope"]["assignment_id"], str(self.alice.pk))
        bob = self.grant(client=self.as_person(self.bob))
        self.assertEqual(bob.status_code, 200)
        self.assertNotEqual(first.data["key"], bob.data["key"])
        channel = self.grant({"kind": "channel", "resource_id": self.channel_id})
        self.assertNotEqual(first.data["key"], channel.data["key"])

    @override_settings(MESSAGING_AUTOMATIONS_ENABLED=True)
    def test_automation_review_is_separate_current_permission_scoped_and_fail_closed(self):
        scope={'kind':'channel-automations','resource_id':self.channel_id}
        result=self.grant(scope);self.assertEqual(result.status_code,200,result.data)
        self.assertTrue(result.data['can_write'])
        self.assertNotEqual(result.data['key'],self.grant({'kind':'channel','resource_id':self.channel_id}).data['key'])
        self.deny('slack.automation.manage');self.assertFalse(self.grant(scope).data['can_write'])
        self.deny('slack.automation.read');self.assertEqual(self.grant(scope).status_code,403)
        with override_settings(MESSAGING_AUTOMATIONS_ENABLED=False):
            self.assertEqual(self.grant(scope).status_code,403)

    @override_settings(MESSAGING_AUTOMATIONS_ENABLED=True)
    def test_automation_grant_has_no_extra_scope_or_owner_private_channel_bypass(self):
        scope={'kind':'channel-automations','resource_id':self.channel_id}
        for extra in ({'parent_id':str(uuid.uuid4())},{'channel_id':self.channel_id},{'container_id':str(uuid.uuid4())}):
            self.assertEqual(self.grant({**scope,**extra}).status_code,400)
        DepartmentChannel.objects.filter(pk=self.channel_id).update(visibility='private')
        self.assertEqual(self.grant(scope,client=self.as_person(self.owner)).status_code,404)

    def test_fresh_page_permissions_and_epoch_and_credentials_rotation(self):
        original = self.grant().data["key"]
        self.deny("slack.page.update")
        self.assertFalse(self.grant().data["can_write"])
        self.deny("slack.page.read")
        self.assertEqual(self.grant().status_code, 403)
        # A channel grant does not bypass page permissions, but has its own scope.
        scope = {"kind": "channel", "resource_id": self.channel_id}
        old = self.grant(scope).data["key"]
        ChannelAccessEpoch.objects.create(employee=self.alice.employee, revision=1)
        self.assertNotEqual(old, self.grant(scope).data["key"])
        old = self.grant(scope).data["key"]
        account = self.alice.employee.user_account
        account.credentials_version += 1
        account.save(update_fields=["credentials_version"])
        self.client = self.as_person(self.alice)
        self.assertNotEqual(old, self.grant(scope).data["key"])
        self.assertNotEqual(original, old)

    def test_private_channels_have_no_owner_override_and_page_must_belong(self):
        DepartmentChannel.objects.filter(pk=self.channel_id).update(visibility="private")
        self.assertEqual(self.grant(client=self.as_person(self.owner)).status_code, 404)
        self.assertEqual(self.grant(client=self.as_person(self.bob)).status_code, 404)
        ChannelAccessRule.objects.create(channel_id=self.channel_id, employee=self.bob.employee, access="read")
        self.assertEqual(self.grant(client=self.as_person(self.bob)).status_code, 200)
        self.assertEqual(self.grant({**self.scope, "resource_id": str(uuid.uuid4())}).status_code, 404)

    def test_direct_conversation_membership_and_pilot_cannot_be_bypassed(self):
        first, second = sorted([self.alice.employee_id, self.bob.employee_id])
        conversation = DirectConversation.objects.create(first_employee_id=first, second_employee_id=second)
        scope = {"kind": "conversation", "resource_id": str(conversation.pk)}
        self.assertEqual(self.grant(scope).status_code, 200)
        self.assertEqual(self.grant(scope, self.as_person(self.owner)).status_code, 404)
        with override_settings(MESSAGING_PILOT_ENABLED=True, MESSAGING_PILOT_UNIT_IDS=[str(self.it.pk)]):
            self.assertEqual(self.grant(scope, self.as_person(self.bob)).status_code, 403)

    def test_forward_review_has_own_key_and_same_participant_boundary(self):
        first,second=sorted([self.alice.employee_id,self.bob.employee_id])
        conversation=DirectConversation.objects.create(first_employee_id=first,second_employee_id=second)
        scope={'kind':'conversation-forward','resource_id':str(conversation.pk)}
        result=self.grant(scope);self.assertEqual(result.status_code,200,result.data)
        self.assertNotEqual(result.data['key'],self.grant({**scope,'kind':'conversation'}).data['key'])
        self.assertEqual(self.grant(scope,self.as_person(self.owner)).status_code,404)
        self.assertEqual(self.grant({**scope,'parent_id':str(uuid.uuid4())}).status_code,400)
        with override_settings(MESSAGING_PILOT_ENABLED=True,MESSAGING_PILOT_UNIT_IDS=[str(self.it.pk)]):
            self.assertEqual(self.grant(scope,self.as_person(self.bob)).status_code,403)

    def test_strict_scope_validation_and_no_production_secret_fallback(self):
        for invalid in ({**self.scope, "key": "attacker"}, {"kind": "page", "resource_id": self.page["id"]},
                        {**self.scope, "parent_id": str(uuid.uuid4())}):
            self.assertEqual(self.grant(invalid).status_code, 400)
        with override_settings(DEBUG=False, AUTH_ENCRYPTION_KEY=""):
            with self.assertRaisesRegex(RuntimeError, "AUTH_ENCRYPTION_KEY"):
                self.grant()

    def test_thread_scope_is_exact_and_foreign_assignments_cannot_acquire_keys(self):
        root = self.client.post(self.url + "messages/", {"body": "Raíz", "client_id": str(uuid.uuid4())}, format="json").data["message"]
        reply = self.client.post(self.url + "messages/", {"body": "Respuesta", "client_id": str(uuid.uuid4()), "parent_id": root["id"]}, format="json").data["message"]
        scope = {"kind": "channel", "resource_id": self.channel_id}
        thread = self.grant({**scope, "parent_id": root["id"]})
        self.assertEqual(thread.status_code, 200, thread.data)
        self.assertNotEqual(thread.data["key"], self.grant(scope).data["key"])
        self.assertEqual(self.grant({**scope, "parent_id": reply["id"]}).status_code, 404)
        self.client.credentials(HTTP_X_ASSIGNMENT_ID=str(self.bob.pk))
        self.assertEqual(self.grant(scope).status_code, 403)

    def test_real_sessions_and_csrf_with_two_accounts_and_logout(self):
        clients = []
        for assignment in (self.alice, self.bob):
            account = assignment.employee.user_account
            account.set_password("Synthetic-Draft-Only-2026!")
            account.save(update_fields=["password"])
            client = APIClient(enforce_csrf_checks=True)
            csrf = client.get("/api/v2/auth/session/").data["csrf_token"]
            login = client.post("/api/v2/auth/login/", {"email": account.email, "password": "Synthetic-Draft-Only-2026!"}, format="json", HTTP_X_CSRFTOKEN=csrf)
            self.assertEqual(login.status_code, 200, login.data)
            self.assertTrue(login.data["authenticated"])
            csrf = client.get("/api/v2/auth/session/").data["csrf_token"]
            client.credentials(HTTP_X_ASSIGNMENT_ID=str(assignment.pk), HTTP_X_CSRFTOKEN=csrf)
            clients.append(client)
        first, second = [self.grant(client=client) for client in clients]
        self.assertEqual(first.status_code, 200, first.data)
        self.assertEqual(second.status_code, 200, second.data)
        self.assertNotEqual(first.data["key"], second.data["key"])
        clients[0].credentials(HTTP_X_ASSIGNMENT_ID=str(self.alice.pk))
        self.assertEqual(self.grant(client=clients[0]).status_code, 403, "CSRF is required for acquiring a key")
        csrf = clients[0].get("/api/v2/auth/session/").data["csrf_token"]
        clients[0].credentials(HTTP_X_ASSIGNMENT_ID=str(self.alice.pk), HTTP_X_CSRFTOKEN=csrf)
        logout = clients[0].post("/api/v2/auth/logout/", {}, format="json")
        self.assertIn(logout.status_code, (200, 204))
        denied = self.grant(client=clients[0])
        self.assertIn(denied.status_code, (401, 403))
        self.assertNotIn("key", denied.data)
