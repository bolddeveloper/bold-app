import base64
import uuid
from urllib.parse import parse_qs, urlsplit
from unittest.mock import patch

from django.test import TestCase, override_settings
from boldApp.core.authorization import resolve_access
from boldApp.core.models import JobRole, JobRolePermission, Permission
from boldApp.administrativo.models import SystemAuditEvent
from . import test_channels as base
from .channel_events import channel_event
from .models import ChannelAccessRule, ChannelMessage, DepartmentChannel


@override_settings(MESSAGING_PILOT_ENABLED=False)
class ChannelPrivacyTests(TestCase):
    root = base.DepartmentChannelTests.root
    setUp = base.DepartmentChannelTests.setUp
    identity = base.DepartmentChannelTests.identity
    as_person = base.DepartmentChannelTests.as_person
    deny = base.DepartmentChannelTests.deny

    def private(self, **extra):
        response = self.client.post(self.root, {"name": "Reservado", "visibility": "private", **extra}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        return response.data, self.root + response.data["id"] + "/"

    def rules(self, *pairs):
        return [{"employee_id": str(person.employee_id), "access": access} for person, access in pairs]

    def access(self, url, visibility, members, version=1, client=None):
        return (client or self.client).patch(url + "access/", {"visibility": visibility, "members": members, "version": version}, format="json")

    def send_to(self, url, client=None, **extra):
        return (client or self.client).post(url + "messages/", {"body": "Confidencial", "client_id": str(uuid.uuid4()), **extra}, format="json")

    def test_private_creation_invites_creator_but_not_owner_or_administrators(self):
        channel, url = self.private()
        self.assertEqual(ChannelAccessRule.objects.get(channel_id=channel["id"], employee=self.alice.employee).access, "write")
        sent = self.send_to(url).data["message"]
        for person in (self.bob, self.owner):
            peer = self.as_person(person)
            self.assertEqual(peer.get(url).status_code, 404)
            self.assertNotIn(channel["id"], [row["id"] for row in peer.get(self.root).data["results"]])
            self.assertNotIn(channel["id"], peer.get(self.root + "unread/").data["by_channel"])
            for suffix in ("messages/", "messages/"+sent["id"]+"/", "messages/"+sent["id"]+"/media/", "tasks/?q=secreto"):
                self.assertEqual(peer.get(url + suffix).status_code, 404)
            self.assertEqual(self.send_to(url, peer).status_code, 404)
            self.assertEqual(peer.post(url+"read/", {"message_id": sent["id"]}, format="json").status_code, 404)
            self.assertEqual(peer.put(url+"following/", {"following": True}, format="json").status_code, 404)
            self.assertIsNone(channel_event(person.pk, {"channel_id": channel["id"], "kind": "message.created"}))
            for code in ("slack.channel.read", "slack.message.create", "slack.channel.manage"):
                decision = resolve_access(person, Permission.objects.get(code=code), person.position.unit, resource_id=channel["id"])
                self.assertFalse(decision.allowed)
        # Owner can administer invitations, but the metadata projection contains
        # no history, files, descriptions, activity or unread information.
        data = self.as_person(self.owner).get(url+"access/")
        self.assertEqual(data.status_code, 200)
        self.assertEqual(set(data.data), {"id", "name", "department", "visibility", "version", "members"})

    def test_invited_reader_can_read_but_cannot_send_edit_or_rename(self):
        channel, url = self.private(members=self.rules((self.bob,"write")))
        peer = self.as_person(self.bob)
        sent = self.send_to(url, peer).data["message"]
        changed = self.access(url, "private", self.rules((self.alice,"write"), (self.bob,"read")))
        self.assertEqual(changed.status_code, 200, changed.data)
        self.assertEqual(peer.get(url+"messages/").status_code, 200)
        self.assertFalse(peer.get(url).data["can_send"])
        self.assertEqual(self.send_to(url,peer).status_code, 403)
        self.assertEqual(peer.patch(url+"messages/"+sent["id"]+"/", {"body":"No", "version":1}, format="json").status_code,403)
        self.assertEqual(peer.patch(url,{"name":"No", "version":2},format="json").status_code,403)
        self.assertEqual(peer.get(url+"access/").status_code,404)
        self.assertIsNotNone(channel_event(self.bob.pk,{"channel_id":channel["id"],"kind":"message.created"}))

    def test_department_defaults_and_selected_outsiders_and_blocking(self):
        peer=self.as_person(self.bob)
        result=self.access(self.url,"department",[])
        self.assertEqual(result.status_code,200,result.data)
        self.assertEqual(self.client.get(self.url).status_code,200)
        self.assertEqual(peer.get(self.url).status_code,404)
        self.assertEqual(self.access(self.url,"department",self.rules((self.bob,"write")),version=2).status_code,200)
        self.assertEqual(self.send_to(self.url,peer).status_code,201)
        self.assertEqual(self.access(self.url,"department",self.rules((self.bob,"blocked")),version=3).status_code,200)
        self.assertEqual(peer.get(self.url).status_code,404)
        # Block also wins in a public channel, including for the company owner.
        self.assertEqual(self.access(self.url,"public",self.rules((self.owner,"blocked")),version=4).status_code,200)
        self.assertEqual(self.as_person(self.owner).get(self.url).status_code,404)

    def test_department_uses_active_assignment_not_any_other_position(self):
        from boldApp.core.models import Position, PositionAssignment
        self.access(self.url,"department",[])
        second=PositionAssignment.objects.create(employee=self.bob.employee,position=Position.objects.create(unit=self.it,job_role=self.role))
        self.assertEqual(self.as_person(self.bob).get(self.url).status_code,404)
        self.assertEqual(self.as_person(second).get(self.url).status_code,200)

    def test_creator_can_remove_self_without_retaining_implicit_read(self):
        channel,url=self.private(members=self.rules((self.bob,"write")))
        self.assertEqual(self.access(url,"private",self.rules((self.bob,"write"))).status_code,200)
        self.assertEqual(self.client.get(url).status_code,404)
        self.assertEqual(self.client.get(url+"access/").status_code,200)
        self.assertIn(channel["id"],[row["id"] for row in self.client.get(self.root+"managed/").data["results"]])

    def test_access_management_is_scoped_explicit_and_not_a_read_grant(self):
        head=self.identity("head",self.it)
        role=JobRole.objects.create(title="Responsable designado")
        head.position.job_role=role;head.position.save()
        other=self.identity("external-head",self.marketing)
        other.position.job_role=role;other.position.save()
        channel,url=self.private(unit_id=str(self.it.pk))
        manager=self.as_person(head)
        self.assertEqual(manager.get(url+"access/").status_code,404)
        rule=JobRolePermission.objects.create(job_role=role,permission=Permission.objects.get(code="slack.channel.access"),effect="allow",scope_type="own_unit")
        self.assertEqual(manager.get(url+"access/").status_code,200)
        self.assertEqual(manager.get(url).status_code,404)
        independent,independent_url=self.private(name="Sin autoridad departamental")
        self.assertEqual(manager.get(independent_url+"access/").status_code,404,"own-unit authority does not apply to independent channels")
        self.assertEqual(self.as_person(other).get(url+"access/").status_code,404)
        self.assertEqual(self.access(url,"private",self.rules((self.alice,"write"),(self.bob,"read")),client=manager).status_code,200)
        self.assertEqual(manager.get(url).status_code,404)
        rule.effect="deny";rule.save()
        self.assertEqual(manager.get(url+"access/").status_code,404)
        self.deny("slack.channel.access")
        self.assertEqual(self.client.get(url+"access/").status_code,404,"an explicit deny also restricts the creator")

    def test_access_input_is_strict_atomic_versioned_and_has_a_reader(self):
        channel,url=self.private()
        for visibility,members in (("department",self.rules((self.alice,"write"))),
                ("private",[]),("private",self.rules((self.alice,"blocked"))),
                ("private",self.rules((self.alice,"write"),(self.alice,"read"))),
                ("private",[{"employee_id":str(uuid.uuid4()),"access":"write"}])):
            self.assertEqual(self.access(url,visibility,members).status_code,400)
        self.assertEqual(self.access(url,"private",self.rules((self.alice,"write")),version=999).status_code,409)
        self.assertEqual(DepartmentChannel.objects.get(pk=channel["id"]).version,1)
        self.assertEqual(ChannelAccessRule.objects.filter(channel_id=channel["id"]).count(),1)
        inactive=self.bob.employee;inactive.is_active=False;inactive.save()
        self.assertEqual(self.access(url,"private",self.rules((self.bob,"write"))).status_code,400)
        self.assertEqual(self.client.post(self.root,{"name":"Bad","visibility":"private","members":[{"employee_id":str(self.alice.employee_id),"access":"write","is_admin":True}]},format="json").status_code,400)

    def test_core_explicit_denials_remain_additional_gates(self):
        _,url=self.private(members=self.rules((self.bob,"write")))
        self.deny("slack.message.create")
        self.assertEqual(self.send_to(url,self.as_person(self.bob)).status_code,403)
        self.deny("slack.channel.read")
        self.assertEqual(self.as_person(self.bob).get(url).status_code,404)

    def test_pilot_restriction_wins_even_over_owner_invitation(self):
        _,url=self.private(members=self.rules((self.bob,"write"),(self.owner,"write")))
        with override_settings(MESSAGING_PILOT_ENABLED=True,MESSAGING_PILOT_UNIT_IDS=[str(self.it.pk)]):
            for person in (self.bob,self.owner):
                self.assertEqual(self.as_person(person).get(url).status_code,403)
                self.assertIsNone(channel_event(person.pk,{"channel_id":url.split("/")[-2],"kind":"channel.updated"}))
            self.assertEqual(self.client.get(url).status_code,200)

    def test_revocation_suppresses_old_notifications_socket_and_private_media(self):
        from .channel_notifications import notification_channel_readable
        from boldApp.notificaciones.models import Notification
        _,url=self.private(members=self.rules((self.bob,"write")))
        peer=self.as_person(self.bob)
        peer.put(url+"following/",{"following":True},format="json")
        message=self.send_to(url).data["message"]
        notice=Notification.objects.get(module="slack",recipient_assignment=self.bob)
        self.assertTrue(notification_channel_readable(self.bob,notice))
        with self.captureOnCommitCallbacks(execute=True),patch("boldApp.mensajeria.channel_access_views.dispatch_authorization_invalidation") as invalidate:
            self.assertEqual(self.access(url,"private",self.rules((self.alice,"write"))).status_code,200)
        self.assertTrue(invalidate.called)
        self.assertFalse(notification_channel_readable(self.bob,notice))
        self.assertEqual(peer.get(self.root+"unread/").data["total"],0)
        with patch("boldApp.mensajeria.channel_views.private_media_response") as download:
            self.assertEqual(peer.get(url+"messages/"+message["id"]+"/media/").status_code,404)
            download.assert_not_called()
        self.assertIsNone(channel_event(self.bob.pk,{"channel_id":notice.resource_id,"kind":"message.created"}))
        self.assertTrue(SystemAuditEvent.objects.filter(event_type="slack.channel.access_changed",target_id=notice.resource_id).exists())

    def test_private_names_never_enter_cursor_pagination(self):
        hidden,url=self.private(name="AAA secreto exclusivo")
        # A small page ensures a hidden leading name would have been encoded
        # in the previous paginate-then-filter implementation.
        peer=self.as_person(self.bob)
        DepartmentChannel.objects.create(unit=self.it,creator=self.alice,name="Visible dos")
        with patch("boldApp.mensajeria.channel_views.ChannelPages.page_size",1):
            page=peer.get(self.root)
            self.assertEqual(len(page.data["results"]),1)
            self.assertIsNotNone(page.data["next"])
            cursor=parse_qs(urlsplit(page.data["next"]).query)["cursor"][0]
            self.assertNotIn("secreto",base64.b64decode(cursor).decode())
            next_page=peer.get(page.data["next"])
            self.assertEqual(len(next_page.data["results"]),1)
            self.assertIsNone(next_page.data["next"])

    def test_people_search_requires_creation_or_access_administration(self):
        _,url=self.private()
        self.assertEqual(self.client.get(self.root+"people/?channel="+url.split("/")[-2]).status_code,200)
        self.assertEqual(self.as_person(self.bob).get(self.root+"people/?channel="+url.split("/")[-2]).status_code,404)
        self.deny("slack.channel.create")
        self.assertEqual(self.client.get(self.root+"people/?q=bob").status_code,403)

    def test_security_fingerprint_changes_on_revocation_and_read_only_but_has_no_content(self):
        from datetime import timedelta
        from django.utils import timezone
        from boldApp.autenticacion.models import AuthSession
        from boldApp.autenticacion.services import token_hash
        from boldApp.core.security_control import security_snapshot
        _,url=self.private(members=self.rules((self.bob,"write")))
        session=AuthSession.objects.create(user_account=self.bob.employee.user_account,token_hash=token_hash("synthetic-privacy-test"),
            credentials_version=1,expires_at=timezone.now()+timedelta(hours=1))
        before=security_snapshot(session.pk,self.bob.pk)
        self.client.post(self.root,{"name":"Otro canal público"},format="json")
        self.assertEqual(before["state"],security_snapshot(session.pk,self.bob.pk)["state"],"normal channel creation must not purge unrelated drafts")
        self.assertEqual(self.access(url,"private",self.rules((self.alice,"write"),(self.bob,"read"))).status_code,200)
        read_only=security_snapshot(session.pk,self.bob.pk)
        self.assertNotEqual(before["state"],read_only["state"])
        self.assertEqual(self.access(url,"private",self.rules((self.alice,"write")),version=2).status_code,200)
        removed=security_snapshot(session.pk,self.bob.pk)
        self.assertNotEqual(read_only["state"],removed["state"])
        self.assertEqual(before["revision"],removed["revision"],"membership does not need a global permission revision bump")
        self.assertNotIn("Reservado",str(removed))

    def test_access_recovery_marker_is_scoped_to_people_whose_effective_access_changes(self):
        from .models import ChannelAccessEpoch
        channel,url=self.private(members=self.rules((self.bob,"write")))
        self.assertEqual(self.access(url,"private",self.rules((self.alice,"write"),(self.bob,"read"))).status_code,200)
        self.assertEqual(ChannelAccessEpoch.objects.get(employee=self.bob.employee).revision,1)
        self.assertFalse(ChannelAccessEpoch.objects.filter(employee=self.alice.employee).exists())
        self.assertFalse(ChannelAccessEpoch.objects.filter(employee=self.owner.employee).exists())
        # Saving identical settings neither increments versions nor purges a
        # conversation/draft in this or an unrelated browser tab.
        same=self.access(url,"private",self.rules((self.alice,"write"),(self.bob,"read")),version=2)
        self.assertEqual(same.status_code,200)
        self.assertEqual(same.data["version"],2)
        self.assertEqual(ChannelAccessEpoch.objects.get(employee=self.bob.employee).revision,1)
