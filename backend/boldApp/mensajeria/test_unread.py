import uuid
from unittest.mock import patch
from django.core.cache import cache
from django.test import TestCase, override_settings
from boldApp.core.models import Employee, UserAccount, OrganizationalUnit, JobRole, Position, PositionAssignment
from boldApp.notificaciones.models import Notification
from .events import private_event
from .models import DirectConversation, DirectMessage
from rest_framework.test import APIClient


@override_settings(MESSAGING_PILOT_ENABLED=True)
class UnreadChatTests(TestCase):
    root = "/api/v2/messaging/"

    def setUp(self):
        cache.clear()
        self.it = OrganizationalUnit.objects.create(name="IT", unit_type="department", sensitivity_level="low")
        self.outside = OrganizationalUnit.objects.create(name="Otro", unit_type="department", sensitivity_level="low")
        self.role = JobRole.objects.create(title="Prueba")
        self.pilot = override_settings(MESSAGING_PILOT_UNIT_IDS=(str(self.it.pk),))
        self.pilot.enable(); self.addCleanup(self.pilot.disable)
        self.alice = self.person("alfa", self.it)
        self.bob = self.person("beta", self.it)
        self.eve = self.person("tercero", self.it)
        self.owner = self.person("propietario", self.outside, True)
        self.chat = self.api_client(self.alice).post(self.root+"conversations/", {"employee_id":str(self.bob.employee_id)}, format="json").data["id"]

    def person(self, name, unit, owner=False):
        employee = Employee.objects.create(full_name=name)
        UserAccount.objects.create_user(employee=employee, email=f"unread.{name}@bold.gt", is_superuser=owner)
        return PositionAssignment.objects.create(employee=employee, position=Position.objects.create(unit=unit, job_role=self.role))

    def api_client(self, assignment):
        client = APIClient(); client.force_authenticate(assignment.employee.user_account)
        client.credentials(HTTP_X_ASSIGNMENT_ID=str(assignment.pk)); return client

    def send(self, retry_id=None):
        return self.api_client(self.alice).post(f"{self.root}conversations/{self.chat}/messages/",
            {"body":"Contenido privado que no debe filtrarse", "client_id":str(retry_id or uuid.uuid4())}, format="json")

    def summary(self, who):
        response = self.api_client(who).get(self.root+"unread/")
        self.assertEqual(response.status_code,200,response.data)
        return response.data["conversations"]

    def test_summary_is_private_persistent_and_delivery_does_not_clear_unread(self):
        sent = self.send(); self.assertEqual(sent.status_code,201,sent.data)
        message_id = sent.data["message"]["id"]
        row = self.summary(self.bob)[0]
        self.assertEqual((row["count"],row["version"],row["employee_id"]),(1,1,str(self.alice.employee_id)))
        self.assertEqual(self.summary(self.alice)[0]["count"],0)
        self.assertEqual(self.summary(self.eve),[])
        self.assertEqual(self.api_client(self.owner).get(self.root+"unread/").status_code,403)
        receipt = f"{self.root}conversations/{self.chat}/receipts/"
        self.assertEqual(self.api_client(self.bob).post(receipt,{"message_ids":[message_id],"state":"delivered"},format="json").status_code,200)
        self.assertEqual(self.summary(self.bob)[0]["count"],1)
        self.assertFalse(Notification.objects.get(recipient_assignment=self.bob).is_read)
        read = self.api_client(self.bob).post(receipt,{"message_ids":[message_id],"state":"read"},format="json")
        self.assertEqual(read.status_code,200,read.data)
        self.assertEqual((read.data["unread"]["count"],read.data["unread"]["version"]),(0,2))
        self.assertEqual(self.summary(self.bob)[0]["count"],0)
        self.assertTrue(Notification.objects.get(recipient_assignment=self.bob).is_read)

    def test_notice_is_deduplicated_generic_and_only_addressed_to_recipient(self):
        retry_id=uuid.uuid4(); self.send(retry_id); self.send(retry_id)
        self.assertEqual(Notification.objects.count(),1)
        notice=Notification.objects.get()
        self.assertEqual(notice.recipient_assignment,self.bob)
        self.assertEqual(notice.route["employee_id"],str(self.alice.employee_id))
        self.assertEqual(notice.resource_id,uuid.UUID(self.chat))
        self.assertNotIn("Contenido privado",notice.body)
        self.assertEqual(DirectMessage.objects.count(),1)
        self.assertEqual(self.summary(self.bob)[0]["version"],1)

    def test_event_count_is_recipient_specific_and_other_people_cannot_receive_it(self):
        sent=self.send(); message_id=sent.data["message"]["id"]
        event={"conversation_id":self.chat,"kind":"message.created","message_ids":[message_id]}
        recipient=private_event(self.bob.employee_id,event)
        author=private_event(self.alice.employee_id,event)
        self.assertEqual(recipient["payload"]["unread"]["count"],1)
        self.assertEqual(author["payload"]["unread"]["count"],0)
        self.assertIsNone(private_event(self.eve.employee_id,event))

    def test_user_can_disable_chat_notices_without_losing_unread_badges(self):
        account=self.bob.employee.user_account
        account.notification_settings={"events":{"messaging.message_created":False}}
        account.save(update_fields=["notification_settings"])
        self.send()
        self.assertFalse(Notification.objects.exists())
        self.assertEqual(self.summary(self.bob)[0]["count"],1)

    def test_departure_removes_summary_and_notices_without_deleting_history(self):
        self.send()
        self.bob.position.unit=self.outside; self.bob.position.save(update_fields=["unit"])
        self.assertEqual(self.summary(self.alice),[])
        response=self.api_client(self.bob).get("/api/v2/notifications/")
        self.assertEqual(response.status_code,200,response.data)
        self.assertEqual(response.data["results"],[])
        self.assertTrue(DirectConversation.objects.exists())

    def test_notice_push_outage_never_turns_a_committed_message_into_an_error(self):
        with patch("boldApp.notificaciones.events.get_channel_layer", side_effect=RuntimeError("simulated push outage")):
            with self.assertLogs(level="ERROR"):
                with self.captureOnCommitCallbacks(execute=True):
                    response = self.send()
        self.assertEqual(response.status_code,201,response.data)
        self.assertEqual(DirectMessage.objects.count(),1)
        self.assertEqual(Notification.objects.count(),1)
