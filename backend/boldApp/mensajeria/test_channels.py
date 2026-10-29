import uuid
from datetime import timedelta
from unittest.mock import patch

from django.core.cache import cache
from django.db import IntegrityError, transaction
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from boldApp.core.authorization import resolve_access
from boldApp.core.models import AccessGrant, Employee, UserAccount, Position, PositionAssignment, JobRole, OrganizationalUnit, Permission, JobRolePermission
from .channel_access import ChannelPolicy
from .channel_events import channel_event
from .models import DepartmentChannel, ChannelMessage, ChannelReadState, DirectConversation


@override_settings(MESSAGING_PILOT_ENABLED=False)
class DepartmentChannelTests(TestCase):
    root = "/api/v2/messaging/channels/"

    def setUp(self):
        cache.clear()
        self.role = JobRole.objects.create(title="Equipo")
        self.it = OrganizationalUnit.objects.create(name="IT", unit_type="department", sensitivity_level="low")
        self.marketing = OrganizationalUnit.objects.create(name="Marketing", unit_type="department", sensitivity_level="low", color_hex="#9250A3")
        self.alice = self.identity("alice", self.it)
        self.bob = self.identity("bob", self.marketing)
        self.owner = self.identity("owner", self.marketing, owner=True)
        self.client = self.as_person(self.alice)
        result = self.client.post(self.root, {"unit_id": str(self.it.pk), "name": "General"}, format="json")
        self.assertEqual(result.status_code, 201, result.data)
        self.channel_id = result.data["id"]
        self.url = self.root + self.channel_id + "/"

    def identity(self, name, unit, owner=False):
        person = Employee.objects.create(full_name=name)
        UserAccount.objects.create_user(employee=person, email=f"channel-test-{name}@bold.gt", is_superuser=owner)
        return PositionAssignment.objects.create(employee=person, position=Position.objects.create(unit=unit, job_role=self.role))

    def as_person(self, assignment):
        client = APIClient()
        client.force_authenticate(assignment.employee.user_account)
        client.credentials(HTTP_X_ASSIGNMENT_ID=str(assignment.pk))
        return client

    def send(self, body="Hola equipo", **extra):
        return self.client.post(self.url + "messages/", {"body": body, "client_id": str(uuid.uuid4()), **extra}, format="json")

    def deny(self, code, *, scope="global", unit=None):
        return JobRolePermission.objects.create(job_role=self.role, permission=Permission.objects.get(code=code),
            scope_type=scope, target_unit=unit, effect="deny")

    def test_company_wide_read_write_and_department_snapshot(self):
        self.client = self.as_person(self.bob)
        self.assertEqual(self.client.get(self.url).status_code, 200)
        response = self.send()
        self.assertEqual(response.status_code, 201, response.data)
        message = response.data["message"]
        self.assertEqual(message["author"]["employee_id"], str(self.bob.employee_id))
        self.assertEqual(message["department"], {"name": "Marketing", "color": "#9250A3"})
        self.marketing.name = "Renombrado"
        self.marketing.save()
        self.client = self.as_person(self.alice)
        history = self.client.get(self.url + "messages/")
        self.assertEqual(history.data["results"][0]["department"]["name"], "Marketing")
        self.assertFalse(history.data["results"][0]["can_edit"])
        self.assertEqual(DirectConversation.objects.count(), 0)

    def test_any_employee_can_manage_but_restrictions_are_configurable(self):
        self.client = self.as_person(self.bob)
        response = self.client.patch(self.url, {"name": "Organización", "version": 1}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.deny("slack.channel.manage")
        self.assertFalse(self.client.get(self.url).data["can_manage"])
        self.assertEqual(self.client.patch(self.url, {"version": 2, "name": "No"}, format="json").status_code, 403)
        self.assertEqual(DepartmentChannel.objects.get(pk=self.channel_id).name, "Organización")

    def test_default_permission_is_visible_to_core_and_unknown_stays_denied(self):
        permission = Permission.objects.get(code="slack.message.create")
        self.assertEqual(resolve_access(self.alice, permission, self.it).reason_code, "slack_employee_default")
        self.assertFalse(ChannelPolicy(self.alice).allows("slack.channel.delete", self.it))
        permission.is_active = False
        permission.save()
        self.assertFalse(ChannelPolicy(self.alice).allows(permission.code, self.it))
        self.assertEqual(self.send().status_code, 403)

    def test_individual_restriction_wins_over_employee_default_without_affecting_colleague(self):
        AccessGrant.objects.create(grantee_assignment=self.alice, permission=Permission.objects.get(code="slack.message.create"),
            effect="deny", scope_type="specific_unit", target_unit=self.it, granted_by_assignment=self.owner,
            valid_from=timezone.now() - timedelta(seconds=1), reason="Restricción de prueba", source="override")
        self.assertEqual(self.send().status_code, 403)
        self.client = self.as_person(self.bob)
        self.assertEqual(self.send().status_code, 201)

    def test_configured_session_assurance_is_not_bypassed_by_channel_api_or_socket(self):
        permission = Permission.objects.get(code="slack.channel.read")
        permission.requires_step_up_mfa = True
        permission.save()
        self.assertEqual(self.client.get(self.url).status_code, 404)
        self.assertIsNone(channel_event(self.alice.pk, {"channel_id": self.channel_id, "kind": "message.created"}))

    def test_own_unit_deny_does_not_mix_other_assignments_or_target_departments(self):
        self.deny("slack.message.create", scope="own_unit")
        self.assertEqual(self.send().status_code, 403)
        self.client = self.as_person(self.bob)
        self.assertEqual(self.send().status_code, 201)
        extra = PositionAssignment.objects.create(employee=self.alice.employee, position=Position.objects.create(unit=self.marketing, job_role=self.role))
        self.client = self.as_person(extra)
        self.assertEqual(self.send().status_code, 201)

    def test_denied_read_hides_channel_history_threads_and_push(self):
        message = self.send().data["message"]
        self.deny("slack.channel.read", scope="specific_unit", unit=self.it)
        self.assertEqual(self.client.get(self.root).data["results"], [])
        self.assertEqual(self.client.get(self.url).status_code, 404)
        self.assertEqual(self.client.get(self.url + "messages/").status_code, 404)
        self.assertEqual(self.send(parent_id=message["id"]).status_code, 404)
        self.assertIsNone(channel_event(self.alice.pk, {"channel_id": self.channel_id, "kind": "message.created"}))

    def test_pilot_is_enforced_before_owner_override_and_both_http_and_core(self):
        with override_settings(MESSAGING_PILOT_ENABLED=True, MESSAGING_PILOT_UNIT_IDS=[str(self.it.pk)]):
            self.assertEqual(self.client.get(self.url).status_code, 200)
            for person in (self.bob, self.owner):
                client = self.as_person(person)
                self.assertEqual(client.get(self.url).status_code, 403)
                self.assertEqual(client.post(self.root, {"unit_id": str(self.it.pk), "name": "No"}, format="json").status_code, 403)
                result = resolve_access(person, Permission.objects.get(code="slack.channel.read"), self.it)
                self.assertFalse(result.allowed)
                self.assertEqual(result.reason_code, "slack_pilot_restricted")
                self.assertIsNone(channel_event(person.pk, {"channel_id": self.channel_id, "kind": "message.created"}))

    def test_inactive_assignment_and_foreign_assignment_are_rejected(self):
        self.client.credentials(HTTP_X_ASSIGNMENT_ID=str(self.bob.pk))
        self.assertEqual(self.client.get(self.url).status_code, 403)
        self.client = self.as_person(self.alice)
        self.alice.is_active = False
        self.alice.released_at = timezone.now()
        self.alice.save()
        self.assertEqual(self.client.get(self.root).status_code, 403)
        self.assertIsNone(channel_event(self.alice.pk, {"channel_id": self.channel_id, "kind": "message.created"}))

    def test_duplicate_names_and_stale_management_edits_do_not_overwrite(self):
        response = self.client.post(self.root, {"unit_id": str(self.it.pk), "name": "gEnErAl"}, format="json")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.client.patch(self.url, {"version": 1, "description": "Contexto"}, format="json").status_code, 200)
        self.assertEqual(self.client.patch(self.url, {"version": 1, "description": "Obsoleto"}, format="json").status_code, 409)
        self.assertEqual(self.client.get(self.url).data["description"], "Contexto")

    def test_archive_preserves_history_and_can_be_restored(self):
        self.send()
        archived = self.client.patch(self.url, {"version": 1, "archived": True}, format="json")
        self.assertEqual(archived.status_code, 200)
        self.assertEqual(self.client.get(self.root).data["results"], [])
        self.assertEqual(len(self.client.get(self.root + "?archived=true").data["results"]), 1)
        self.assertEqual(len(self.client.get(self.url + "messages/").data["results"]), 1)
        self.assertEqual(self.send().status_code, 409)
        self.assertEqual(self.client.patch(self.url, {"version": 2, "archived": False}, format="json").status_code, 200)
        self.assertEqual(self.send().status_code, 201)
        self.assertEqual(self.client.delete(self.url).status_code, 405)

    def test_retry_is_idempotent_even_after_message_was_edited(self):
        token = str(uuid.uuid4())
        first = self.send(client_id=token)
        message = first.data["message"]
        self.assertEqual(first.status_code, 201)
        url = self.url + "messages/" + message["id"] + "/"
        edited = self.client.patch(url, {"body": "Corregido", "version": 1}, format="json")
        self.assertEqual(edited.status_code, 200)
        retry = self.send(client_id=token)
        self.assertEqual(retry.status_code, 200)
        self.assertEqual(retry.data["message"]["body"], "Corregido")
        self.assertEqual(self.send("Distinto", client_id=token).status_code, 409)
        self.assertEqual(ChannelMessage.objects.count(), 1)
        self.assertEqual(DepartmentChannel.objects.get(pk=self.channel_id).activity_version, 1)

    def test_only_author_can_edit_strict_ten_minutes_and_versions(self):
        message = self.send().data["message"]
        url = self.url + "messages/" + message["id"] + "/"
        for other in (self.bob, self.owner):
            self.assertEqual(self.as_person(other).patch(url, {"body": "Ajeno", "version": 1}, format="json").status_code, 403)
        self.assertEqual(self.client.patch(url, {"body": "Primera", "version": 1}, format="json").status_code, 200)
        self.assertEqual(self.client.patch(url, {"body": "Obsoleta", "version": 1}, format="json").status_code, 409)
        record = ChannelMessage.objects.get(pk=message["id"])
        with patch("boldApp.mensajeria.channel_views.timezone.now", return_value=record.created_at + timedelta(minutes=10)):
            self.assertEqual(self.client.patch(url, {"body": "Tarde", "version": 2}, format="json").status_code, 403)

    def test_threads_belong_to_channel_and_cannot_nest_or_leak(self):
        parent = self.send().data["message"]
        reply = self.send("Respuesta", parent_id=parent["id"]).data["message"]
        roots = self.client.get(self.url + "messages/").data["results"]
        self.assertEqual([row["id"] for row in roots], [parent["id"]])
        self.assertEqual(roots[0]["reply_count"], 1)
        self.assertEqual(self.client.get(self.url + "messages/?parent=" + parent["id"]).data["results"][0]["id"], reply["id"])
        self.assertEqual(self.send(parent_id=reply["id"]).status_code, 404)
        other = self.client.post(self.root, {"unit_id": str(self.it.pk), "name": "Otro"}, format="json").data["id"]
        self.assertEqual(self.client.get(self.root + other + "/messages/?parent=" + parent["id"]).status_code, 404)
        self.assertEqual(self.client.post(self.root + other + "/messages/", {"body": "No", "client_id": str(uuid.uuid4()), "parent_id": parent["id"]}, format="json").status_code, 404)

    def test_spoofed_identity_unknown_fields_invalid_parent_and_empty_body_rejected(self):
        for extra in ({"author_id": str(self.bob.employee_id)}, {"department_name": "Falso"}, {"sequence": 999}):
            self.assertEqual(self.send(**extra).status_code, 400)
        self.assertEqual(self.send(file='fake').status_code,409,'direct file publication is explicitly retired')
        self.assertEqual(self.send("   ").status_code, 400)
        self.assertEqual(self.client.get(self.url + "messages/?parent=invalid").status_code, 400)
        self.assertEqual(self.client.get(self.root + "?unit=invalid").status_code, 400)

    def test_read_cursor_only_accepts_existing_channel_messages_and_never_regresses(self):
        first = self.send().data["message"]
        second = self.send("Otro").data["message"]
        read = lambda message: self.client.post(self.url + "read/", {"message_id": message}, format="json")
        self.assertEqual(read(second["id"]).data["read_sequence"], 2)
        self.assertEqual(read(first["id"]).data["read_sequence"], 2)
        self.assertEqual(read(str(uuid.uuid4())).status_code, 404)
        self.assertEqual(ChannelReadState.objects.get().sequence, 2)

    def test_pagination_is_bounded_without_missing_messages(self):
        with patch("boldApp.mensajeria.channel_views.publish_channel"):
            for number in range(53):
                self.assertEqual(self.send(str(number)).status_code, 201)
        first = self.client.get(self.url + "messages/")
        self.assertEqual(len(first.data["results"]), 50)
        second = self.client.get(first.data["next"])
        self.assertEqual(len(second.data["results"]), 3)
        self.assertFalse(set(row["id"] for row in first.data["results"]) & set(row["id"] for row in second.data["results"]))

    def test_database_rejects_duplicate_sequence_and_reads(self):
        message = ChannelMessage.objects.get(pk=self.send().data["message"]["id"])
        with self.assertRaises(IntegrityError), transaction.atomic():
            ChannelMessage.objects.create(channel=message.channel, author=message.author, author_assignment=self.alice,
                department_name="IT", department_color="#123456", sequence=message.sequence,
                body="Duplicado", client_id=uuid.uuid4(), payload_digest="x" * 64)

    def test_push_hint_has_no_body_or_author_and_revalidates_policy(self):
        self.send("Contenido privado del canal")
        event = channel_event(self.bob.pk, {"channel_id": self.channel_id, "kind": "message.created"})
        self.assertEqual(event["event_type"], "slack.changed")
        self.assertNotIn("Contenido privado", str(event))
        self.assertNotIn("author", event["payload"])
        self.assertEqual(event["payload"]["activity_version"], 1)

    def test_channel_responses_are_never_publicly_cacheable(self):
        response = self.client.get(self.url)
        self.assertEqual(response["Cache-Control"], "private, no-store")
        self.assertEqual(APIClient().get(self.url).status_code, 401)
