import uuid
from datetime import timedelta
from unittest.mock import patch

from django.core.cache import cache
from django.db import IntegrityError, transaction
from django.conf import settings
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from boldApp.core.models import Employee, JobRole, OrganizationalUnit, Position, PositionAssignment, UserAccount
from .models import DirectConversation, DirectMessage


@override_settings(MESSAGING_PILOT_ENABLED=False)
class DirectChatTests(TestCase):
    root = "/api/v2/messaging/conversations/"

    def setUp(self):
        cache.clear()
        self.role = JobRole.objects.create(title="Equipo")
        self.unit = OrganizationalUnit.objects.create(name="IT", unit_type="department", sensitivity_level="low")
        self.other_unit = OrganizationalUnit.objects.create(name="Marketing", unit_type="department", sensitivity_level="low")
        self.alice = self.identity("alice")
        self.bob = self.identity("bob", unit=self.other_unit)
        self.owner = self.identity("owner", owner=True)
        self.eve = self.identity("eve")
        self.client = self.as_person(self.alice)

    def identity(self, name, *, owner=False, unit=None):
        person = Employee.objects.create(full_name=name)
        UserAccount.objects.create_user(employee=person, email=f"{name}@bold.gt", is_superuser=owner, is_staff=owner)
        return PositionAssignment.objects.create(employee=person, position=Position.objects.create(unit=unit or self.unit, job_role=self.role))

    def as_person(self, assignment):
        client = APIClient()
        client.force_authenticate(assignment.employee.user_account)
        client.credentials(HTTP_X_ASSIGNMENT_ID=str(assignment.pk))
        return client

    def open(self, peer=None):
        response = self.client.post(self.root, {"employee_id": str((peer or self.bob).employee_id)}, format="json")
        self.assertIn(response.status_code, [200, 201], response.data)
        return response.data["id"]

    def send(self, conversation=None, body="Hola 👋", client_id=None):
        conversation = conversation or self.open()
        response = self.client.post(f"{self.root}{conversation}/messages/", {"body": body, "client_id": str(client_id or uuid.uuid4())}, format="json")
        self.assertIn(response.status_code, [200, 201], response.data)
        return response.data["message"]

    def edit(self, conversation, message, **data):
        return self.client.patch(f"{self.root}{conversation}/messages/{message['id']}/", {"body": "Corregido", "version": message["version"], **data}, format="json")

    def test_pair_is_shared_across_departments_roles_and_opening_direction(self):
        conversation = self.open()
        self.client = self.as_person(self.bob)
        self.assertEqual(self.open(self.alice), conversation)
        extra = PositionAssignment.objects.create(employee=self.alice.employee, position=Position.objects.create(unit=self.other_unit, job_role=self.role))
        self.client = self.as_person(extra)
        self.assertEqual(self.open(), conversation)
        self.assertEqual(DirectConversation.objects.count(), 1)

    def test_owner_and_outsider_cannot_list_read_send_or_edit_private_chat(self):
        conversation = self.open()
        message = self.send(conversation)
        for outsider in (self.owner, self.eve):
            self.client = self.as_person(outsider)
            self.assertEqual(self.client.get(self.root).data["results"], [])
            url = f"{self.root}{conversation}/"
            self.assertEqual(self.client.get(url).status_code, 404)
            self.assertEqual(self.client.get(url + "messages/").status_code, 404)
            self.assertEqual(self.client.post(url + "messages/", {"body": "Intrusión", "client_id": str(uuid.uuid4())}, format="json").status_code, 404)
            self.assertEqual(self.edit(conversation, message).status_code, 404)
        self.assertEqual(DirectMessage.objects.count(), 1)

    def test_only_author_can_edit_even_when_recipient_is_owner(self):
        conversation = self.open(self.owner)
        message = self.send(conversation)
        self.client = self.as_person(self.owner)
        self.assertEqual(self.edit(conversation, message).status_code, 403)
        self.client = self.as_person(self.alice)
        response = self.edit(conversation, message)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["message"]["version"], 2)
        self.assertIsNotNone(response.data["message"]["edited_at"])

    def test_ten_minute_window_is_strict_and_edit_does_not_restart_it(self):
        conversation = self.open()
        message = self.send(conversation)
        record = DirectMessage.objects.get(pk=message["id"])
        created = record.created_at
        with patch("boldApp.mensajeria.views.timezone.now", return_value=created + timedelta(minutes=9, seconds=59)):
            edited = self.edit(conversation, message)
            self.assertEqual(edited.status_code, 200)
        self.assertEqual(DirectMessage.objects.get(pk=record.pk).created_at, created)
        with patch("boldApp.mensajeria.views.timezone.now", return_value=created + timedelta(minutes=10)):
            self.assertEqual(self.edit(conversation, edited.data["message"]).status_code, 403)

    def test_stale_edit_conflicts_without_overwriting_newer_text(self):
        conversation = self.open()
        message = self.send(conversation)
        self.assertEqual(self.edit(conversation, message).status_code, 200)
        self.assertEqual(self.edit(conversation, message, body="Obsoleto").status_code, 409)
        self.assertEqual(DirectMessage.objects.get(pk=message["id"]).body, "Corregido")

    def test_send_retry_is_idempotent_and_changed_retry_conflicts(self):
        conversation = self.open()
        token = uuid.uuid4()
        first = self.send(conversation, client_id=token)
        self.assertEqual(self.send(conversation, client_id=token)["id"], first["id"])
        response = self.client.post(f"{self.root}{conversation}/messages/", {"body": "Distinto", "client_id": str(token)}, format="json")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(DirectMessage.objects.count(), 1)

    def test_spoofed_author_and_unknown_fields_rejected(self):
        conversation = self.open()
        response = self.client.post(f"{self.root}{conversation}/messages/", {"body": "Falso", "client_id": str(uuid.uuid4()), "author_id": str(self.owner.employee_id)}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(DirectMessage.objects.count(), 0)

    def test_inactive_recipient_retains_history_but_cannot_receive(self):
        conversation = self.open()
        self.send(conversation)
        account = self.bob.employee.user_account
        account.is_active = False
        account.save()
        self.assertFalse(self.client.get(f"{self.root}{conversation}/").data["peer"]["available"])
        self.assertEqual(len(self.client.get(f"{self.root}{conversation}/messages/").data["results"]), 1)
        self.assertEqual(self.client.post(f"{self.root}{conversation}/messages/", {"body": "No", "client_id": str(uuid.uuid4())}, format="json").status_code, 403)
        self.assertEqual(self.client.post(self.root, {"employee_id": str(self.bob.employee_id)}, format="json").status_code, 400)

    def test_inactive_employee_or_released_assignment_cannot_read(self):
        conversation = self.open()
        self.alice.employee.is_active = False
        self.alice.employee.save()
        self.assertEqual(self.client.get(f"{self.root}{conversation}/").status_code, 403)
        self.alice.employee.is_active = True
        self.alice.employee.save()
        self.alice.is_active = False
        self.alice.released_at = timezone.now()
        self.alice.save()
        self.assertEqual(self.client.get(self.root).status_code, 403)

    def test_assignment_and_authentication_required(self):
        self.assertIn(APIClient().get(self.root).status_code, [401, 403])
        self.client.credentials()
        self.assertEqual(self.client.get(self.root).status_code, 403)
        self.client.credentials(HTTP_X_ASSIGNMENT_ID=str(self.owner.pk))
        self.assertEqual(self.client.get(self.root).status_code, 403)

    def test_self_chat_unknown_person_and_invalid_body_are_rejected(self):
        for person in (self.alice.employee_id, uuid.uuid4(), "bad-id"):
            self.assertIn(self.client.post(self.root, {"employee_id": str(person)}, format="json").status_code, [400, 404])
        conversation = self.open()
        for body in ("   ", "x" * 5001, None):
            self.assertEqual(self.client.post(f"{self.root}{conversation}/messages/", {"body": body, "client_id": str(uuid.uuid4())}, format="json").status_code, 400)

    def test_message_cannot_be_edited_through_a_different_conversation(self):
        first = self.open()
        message = self.send(first)
        second = self.open(self.eve)
        self.assertEqual(self.edit(second, message).status_code, 404)

    def test_pagination_is_bounded_has_no_duplicates_and_hides_secrets(self):
        conversation = self.open()
        DirectMessage.objects.bulk_create([DirectMessage(conversation_id=conversation, author=self.alice.employee, client_id=uuid.uuid4(), body=f"Mensaje {i}") for i in range(63)])
        response = self.client.get(f"{self.root}{conversation}/messages/?page_size=999999")
        self.assertEqual(len(response.data["results"]), 50)
        from urllib.parse import urlsplit
        next_url = urlsplit(response.data["next"])
        older = self.client.get(next_url.path + "?" + next_url.query)
        self.assertEqual(len(older.data["results"]), 13)
        ids = [row["id"] for row in response.data["results"] + older.data["results"]]
        self.assertEqual(len(set(ids)), 63)
        self.assertIsNone(older.data["next"])
        detail = self.client.get(f"{self.root}{conversation}/")
        self.assertNotIn("email", detail.data["peer"])
        self.assertNotIn("password", str(detail.data))

    def test_database_rejects_self_or_noncanonical_pairs(self):
        for first, second in [(self.alice.employee_id, self.alice.employee_id), tuple(sorted([self.alice.employee_id, self.bob.employee_id], reverse=True))]:
            with self.assertRaises(IntegrityError), transaction.atomic():
                DirectConversation.objects.create(first_employee_id=first, second_employee_id=second)

    def test_plain_text_preserved_and_private_responses_not_cached(self):
        conversation = self.open()
        text = '<script>alert("no")</script> https://example.com/ 👋'
        self.assertEqual(self.send(conversation, body=text)["body"], text)
        response = self.client.get(f"{self.root}{conversation}/messages/")
        self.assertIn("no-store", response["Cache-Control"])

    def test_write_throttle_limits_burst(self):
        conversation = self.open()
        with patch.object(__import__("boldApp.mensajeria.views", fromlist=["MessagingWriteThrottle"]).MessagingWriteThrottle, "rate", "2/min"):
            self.send(conversation)
            self.send(conversation)
            response = self.client.post(f"{self.root}{conversation}/messages/", {"body": "Demasiado", "client_id": str(uuid.uuid4())}, format="json")
            self.assertEqual(response.status_code, 429)

    @override_settings(AUTH_MFA_REQUIRED=False)
    def test_real_cookie_authentication_requires_csrf_and_honors_revocation(self):
        from boldApp.autenticacion.models import AuthSession
        from boldApp.autenticacion.services import token_hash
        raw = uuid.uuid4().hex
        session = AuthSession.objects.create(user_account=self.alice.employee.user_account, token_hash=token_hash(raw), credentials_version=1, expires_at=timezone.now() + timedelta(hours=1))
        client = APIClient(enforce_csrf_checks=True)
        client.cookies[settings.AUTH_SESSION_COOKIE_NAME] = raw
        client.credentials(HTTP_X_ASSIGNMENT_ID=str(self.alice.pk))
        self.assertEqual(client.get(self.root).status_code, 200)
        body = {"employee_id": str(self.bob.employee_id)}
        self.assertEqual(client.post(self.root, body, format="json").status_code, 403)
        csrf = "a" * 32
        client.cookies[settings.CSRF_COOKIE_NAME] = csrf
        client.credentials(HTTP_X_ASSIGNMENT_ID=str(self.alice.pk), HTTP_X_CSRFTOKEN=csrf)
        self.assertEqual(client.post(self.root, body, format="json").status_code, 201)
        session.revoked_at = timezone.now()
        session.save(update_fields=["revoked_at"])
        self.assertEqual(client.get(self.root).status_code, 401)

    def test_list_query_count_does_not_grow_per_conversation(self):
        from django.db import connection
        from django.test.utils import CaptureQueriesContext
        for number in range(8):
            self.open(self.identity(f"peer{number}"))
        with CaptureQueriesContext(connection) as queries:
            response = self.client.get(self.root)
        self.assertEqual(len(response.data["results"]), 8)
        self.assertLessEqual(len(queries), 5, "List must prefetch participants/units instead of querying per row")
