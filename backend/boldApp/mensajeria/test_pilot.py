import uuid
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from boldApp.core.models import Employee, UserAccount, OrganizationalUnit, JobRole, Position, PositionAssignment
from boldApp.core.serializers import AssignmentDirectorySerializer
from .models import DirectConversation, DirectMessage


@override_settings(MESSAGING_PILOT_ENABLED=True)
class ChatPilotTests(TestCase):
    root = "/api/v2/messaging/conversations/"

    def setUp(self):
        cache.clear()
        self.it = OrganizationalUnit.objects.create(name="IT", unit_type="department", sensitivity_level="low")
        self.outside = OrganizationalUnit.objects.create(name="Dirección", unit_type="department", sensitivity_level="low")
        self.role = JobRole.objects.create(title="Prueba")
        self.alice = self.person("alfa", self.it)
        self.bob = self.person("beta", self.it)
        self.owner = self.person("propietario", self.outside, True)
        self.employee = self.person("fuera", self.outside)
        self.pilot = override_settings(MESSAGING_PILOT_UNIT_IDS=(str(self.it.pk),))
        self.pilot.enable(); self.addCleanup(self.pilot.disable)

    def person(self, name, unit, owner=False):
        employee = Employee.objects.create(full_name=name)
        UserAccount.objects.create_user(employee=employee, email=f"pilot.{name}@bold.gt", is_superuser=owner)
        return PositionAssignment.objects.create(employee=employee, position=Position.objects.create(unit=unit, job_role=self.role))

    def client_for(self, assignment):
        client = APIClient(); client.force_authenticate(assignment.employee.user_account)
        client.credentials(HTTP_X_ASSIGNMENT_ID=str(assignment.pk))
        return client

    def test_it_can_open_send_and_read_while_other_departments_and_owner_cannot(self):
        client = self.client_for(self.alice)
        response = client.post(self.root, {"employee_id": str(self.bob.employee_id)}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        detail = f"{self.root}{response.data['id']}/"
        sent = client.post(detail + "messages/", {"body": "Piloto", "client_id": str(uuid.uuid4())}, format="json")
        self.assertEqual(sent.status_code, 201)
        self.assertEqual(self.client_for(self.bob).get(detail + "messages/").status_code, 200)
        for outsider in (self.owner, self.employee):
            other = self.client_for(outsider)
            for url in (self.root, detail, detail + "messages/", "/api/v2/messaging/preferences/"):
                self.assertEqual(other.get(url).status_code, 403)
            self.assertEqual(other.post(self.root, {"employee_id": str(self.alice.employee_id)}, format="json").status_code, 403)
            self.assertEqual(other.post(detail + "receipts/", {"message_ids": [sent.data['message']['id']], "state": "read"}, format="json").status_code, 403)
            self.assertEqual(other.patch(detail + "messages/" + sent.data['message']['id'] + "/", {"body": "No", "version": 1}, format="json").status_code, 403)

    def test_pilot_restricts_both_participants_and_directory_uses_server_flag(self):
        client = self.client_for(self.alice)
        self.assertTrue(AssignmentDirectorySerializer(self.alice).data["chat_enabled"])
        self.assertFalse(AssignmentDirectorySerializer(self.owner).data["chat_enabled"])
        self.assertEqual(client.post(self.root, {"employee_id": str(self.owner.employee_id)}, format="json").status_code, 404)
        self.assertEqual(DirectConversation.objects.count(), 0)

    def test_empty_allowlist_fails_closed_even_for_it(self):
        with self.settings(MESSAGING_PILOT_UNIT_IDS=()):
            self.assertEqual(self.client_for(self.alice).get(self.root).status_code, 403)
            self.assertFalse(AssignmentDirectorySerializer(self.alice).data["chat_enabled"])

    def test_active_assignment_controls_pilot_even_if_employee_has_an_it_role(self):
        other_role = PositionAssignment.objects.create(employee=self.alice.employee, position=Position.objects.create(unit=self.outside, job_role=self.role))
        self.assertEqual(self.client_for(other_role).get(self.root).status_code, 403)
        self.assertEqual(self.client_for(self.alice).get(self.root).status_code, 200)

    def test_departed_peer_is_hidden_without_deleting_their_history(self):
        client = self.client_for(self.alice)
        result = client.post(self.root, {"employee_id": str(self.bob.employee_id)}, format="json")
        conversation = DirectConversation.objects.get(pk=result.data["id"])
        DirectMessage.objects.create(conversation=conversation, author=self.alice.employee, body="Conservar", client_id=uuid.uuid4())
        self.bob.position.unit = self.outside; self.bob.position.save(update_fields=["unit"])
        self.assertEqual(client.get(self.root).data["results"], [])
        self.assertEqual(client.get(f"{self.root}{conversation.pk}/messages/").status_code, 404)
        self.assertEqual(DirectMessage.objects.count(), 1)

    def test_explicit_public_switch_preserves_private_chat_contract(self):
        with self.settings(MESSAGING_PILOT_ENABLED=False):
            self.assertTrue(AssignmentDirectorySerializer(self.owner).data["chat_enabled"])
            response = self.client_for(self.alice).post(self.root, {"employee_id": str(self.employee.employee_id)}, format="json")
            self.assertEqual(response.status_code, 201)
