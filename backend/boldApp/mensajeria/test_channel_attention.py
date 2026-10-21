import uuid
from datetime import timedelta
from unittest.mock import patch

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from boldApp.core.models import AccessGrant, Permission
from boldApp.notificaciones.models import Notification
from boldApp.notificaciones.consumers import notification_resource_is_readable
from . import test_channels as base
from .models import ChannelMessage, ChannelReadState, ChannelSubscription, ChannelThreadReadState, DepartmentChannel

# TestCase owns an uncommitted atomic transaction. The Channels async adapter
# closes old connections on entry, which invalidates it on PostgreSQL. Exercise
# its synchronous policy here; TransactionTestCase socket tests cover the adapter.
resource_is_readable = notification_resource_is_readable.__wrapped__


@override_settings(MESSAGING_PILOT_ENABLED=False)
class ChannelAttentionTests(TestCase):
    root = base.DepartmentChannelTests.root
    setUp = base.DepartmentChannelTests.setUp
    identity = base.DepartmentChannelTests.identity
    as_person = base.DepartmentChannelTests.as_person
    send = base.DepartmentChannelTests.send

    def follow(self, client, value=True):
        return client.put(self.url+"following/", {"following":value}, format="json")

    def unread(self, client):
        result=client.get(self.root+"unread/")
        self.assertEqual(result.status_code,200,result.data)
        return result.data["total"]

    def test_following_is_explicit_personal_and_shared_between_assignments_not_a_grant(self):
        bob=self.as_person(self.bob)
        self.assertFalse(bob.get(self.url).data["following"])
        self.assertTrue(self.follow(bob).data["following"])
        self.assertFalse(self.client.get(self.url).data["following"])
        second=self.identity("alternate",self.it)
        second.employee=self.bob.employee;second.save()
        self.assertTrue(self.as_person(second).get(self.url).data["following"])
        self.assertEqual(AccessGrant.objects.count(),0)
        self.follow(bob,False)
        self.assertEqual(bob.get(self.url).status_code,200)
        self.assertEqual(ChannelSubscription.objects.count(),1)

    def test_only_followers_receive_private_content_free_deduplicated_notices(self):
        bob=self.as_person(self.bob)
        self.send("Antes de seguir")
        self.assertEqual(Notification.objects.count(),0)
        self.follow(bob);self.follow(self.client)
        token=str(uuid.uuid4());message=self.send("Contenido confidencial",client_id=token).data["message"]
        notification=Notification.objects.get()
        self.assertEqual(notification.recipient_assignment,self.bob)
        self.assertNotIn("Contenido",notification.title+notification.body)
        self.assertEqual(notification.route,{"module":"slack","channel_id":self.channel_id,"parent_id":None})
        self.assertEqual(notification.metadata["message_id"],message["id"])
        self.assertEqual(self.send("Contenido confidencial",client_id=token).status_code,200)
        self.client.patch(self.url+"messages/"+message["id"]+"/",{"body":"Editado","version":1},format="json")
        self.assertEqual(Notification.objects.count(),1)
        self.assertTrue(resource_is_readable(str(self.bob.pk),str(notification.pk)))

    def test_unfollowing_stops_new_notices_without_erasing_unread_or_history(self):
        bob=self.as_person(self.bob);self.follow(bob)
        self.send();self.assertEqual(self.unread(bob),1)
        self.assertFalse(Notification.objects.get().is_read)
        self.follow(bob,False)
        self.assertTrue(Notification.objects.get().is_read)
        self.send();self.assertEqual(Notification.objects.count(),1)
        self.assertEqual(self.unread(bob),2)
        self.assertEqual(len(bob.get(self.url+"messages/").data["results"]),2)

    def test_event_preference_can_mute_a_followed_channel_without_changing_unread(self):
        bob=self.as_person(self.bob);self.follow(bob)
        account=self.bob.employee.user_account
        account.notification_settings={"events":{"slack.message_created":False}};account.save()
        self.send();self.assertEqual(Notification.objects.count(),0)
        self.assertEqual(self.unread(bob),1)

    def test_roots_and_threads_have_independent_monotone_read_cursors(self):
        bob=self.as_person(self.bob);self.follow(bob)
        first=self.send("Raíz uno").data["message"]
        reply=self.send("Respuesta oculta",parent_id=first["id"]).data["message"]
        second=self.send("Raíz dos").data["message"]
        self.assertEqual(self.unread(bob),3)
        history=bob.get(self.url+"messages/")
        self.assertEqual(history.data["channel"]["unread_count"],3)
        self.assertEqual(next(row for row in history.data["results"] if row["id"]==first["id"])["unread_reply_count"],1)
        self.assertEqual(self.unread(bob),3,"a GET never marks a channel read")
        read=lambda message: bob.post(self.url+"read/",{"message_id":message["id"]},format="json")
        self.assertEqual(read(second).data["read_sequence"],3)
        self.assertEqual(self.unread(bob),1,"reading roots cannot acknowledge unseen replies")
        self.assertEqual(Notification.objects.filter(is_read=False).get().metadata["message_id"],reply["id"])
        self.assertEqual(read(first).data["read_sequence"],3)
        self.assertEqual(ChannelReadState.objects.get().sequence,3)
        self.assertEqual(read(reply).data["parent_id"],first["id"])
        self.assertEqual(ChannelThreadReadState.objects.get().sequence,2)
        self.assertEqual(self.unread(bob),0)
        self.assertEqual(Notification.objects.filter(is_read=False).count(),0)
        self.client=bob;self.send("Mi propio mensaje")
        self.assertEqual(self.unread(bob),0)

    def test_private_state_push_targets_only_the_readers_employee_group(self):
        bob=self.as_person(self.bob);message=self.send().data["message"]
        with patch("boldApp.mensajeria.channel_events.get_channel_layer") as layer, self.captureOnCommitCallbacks(execute=True):
            async def send(group,event):
                self.assertEqual(group,f"messaging_employee_{self.bob.employee_id}")
                self.assertEqual(event["kind"],"state.changed")
                self.assertNotIn("body",event)
            layer.return_value.group_send=send
            bob.post(self.url+"read/",{"message_id":message["id"]},format="json")

    def test_revoked_access_filters_summary_rest_and_delayed_socket_notification(self):
        bob=self.as_person(self.bob);self.follow(bob);self.send()
        notification=Notification.objects.get()
        self.assertTrue(bob.get("/api/v2/notifications/").data["results"])
        AccessGrant.objects.create(grantee_assignment=self.bob,permission=Permission.objects.get(code="slack.channel.read"),effect="deny",
            scope_type="specific_unit",target_unit=self.it,granted_by_assignment=self.owner,valid_from=timezone.now()-timedelta(seconds=1),reason="test",source="override")
        self.assertEqual(self.unread(bob),0)
        self.assertEqual(bob.get("/api/v2/notifications/").data["results"],[])
        self.assertFalse(resource_is_readable(str(self.bob.pk),str(notification.pk)))
        self.assertEqual(self.follow(bob).status_code,404)
        self.assertEqual(bob.post(self.url+"read/",{"message_id":str(uuid.uuid4())},format="json").status_code,404)

    def test_pilot_and_mfa_still_gate_personal_state_and_notifications(self):
        bob=self.as_person(self.bob);self.follow(bob);self.send()
        notification=Notification.objects.get()
        permission=Permission.objects.get(code="slack.channel.read");permission.requires_step_up_mfa=True;permission.save()
        self.assertEqual(self.unread(bob),0)
        self.assertEqual(bob.get("/api/v2/notifications/").data["results"],[])
        self.assertFalse(resource_is_readable(str(self.bob.pk),str(notification.pk)))
        with self.settings(MESSAGING_PILOT_ENABLED=True,MESSAGING_PILOT_UNIT_IDS=(str(self.it.pk),)):
            self.assertEqual(self.follow(self.as_person(self.owner)).status_code,403)
            self.assertEqual(self.as_person(self.owner).get(self.root+"unread/").status_code,403)

    def test_spoofed_follow_targets_wrong_channel_reads_and_anonymous_requests_fail(self):
        self.assertEqual(self.client.put(self.url+"following/",{"following":True,"employee_id":str(self.bob.employee_id)},format="json").status_code,400)
        self.assertEqual(ChannelSubscription.objects.count(),0)
        other=DepartmentChannel.objects.create(unit=self.it,name="Otro",creator=self.alice)
        message=self.send().data["message"]
        self.assertEqual(self.client.post(self.root+str(other.pk)+"/read/",{"message_id":message["id"]},format="json").status_code,404)
        self.assertEqual(APIClient().get(self.root+"unread/").status_code,401)
