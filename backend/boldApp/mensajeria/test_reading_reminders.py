import uuid
from unittest.mock import patch

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from boldApp.core.models import Permission
from boldApp.notificaciones.models import Notification
from . import test_saved_items as fixtures
from .models import ChannelAccessRule, ChannelReadState, ChannelThreadReadState, ReadingReminder, ReadingReminderClock


@override_settings(MESSAGING_PILOT_ENABLED=False)
class ReadingReminderTests(TestCase):
    root = fixtures.SavedItemTests.root
    identity = fixtures.SavedItemTests.identity
    as_person = fixtures.SavedItemTests.as_person
    blocks = fixtures.SavedItemTests.blocks
    deny = fixtures.SavedItemTests.deny
    direct = fixtures.SavedItemTests.direct
    channel_message = fixtures.SavedItemTests.channel_message
    setUp = fixtures.SavedItemTests.setUp
    endpoint = "/api/v2/messaging/reading-reminders/"

    def state(self, message, kind="chat", client=None):
        response = (client or self.client).get(self.endpoint, {"kind":kind, "source_id":str(message.pk)})
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def mark(self, message, kind="chat", client=None, **overrides):
        data = {"kind":kind, "source_id":str(message.pk), "version":self.state(message, kind, client)["version"], "client_id":str(uuid.uuid4()), **overrides}
        return (client or self.client).put(self.endpoint, data, format="json")

    def snapshot(self, client=None):
        result = (client or self.client).get("/api/v2/messaging/unread/")
        self.assertEqual(result.status_code, 200, result.data)
        self.assertIn("no-store", result["Cache-Control"])
        return result.data["reading"]

    def clear(self, result, client=None, **overrides):
        return (client or self.client).put(self.endpoint + result["id"] + "/", {
            "version":result["version"], "client_id":str(uuid.uuid4()), **overrides}, format="json")

    def test_mark_and_clear_are_personal_and_leave_truthful_receipts_untouched(self):
        message = self.direct("Pendiente privado", author=self.bob.employee_id)
        message.delivered_at = message.read_at = timezone.now();message.save()
        result = self.mark(message)
        self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual(result.data["reading"]["items"][0]["target"]["message_id"], str(message.pk))
        original = (message.delivered_at, message.read_at)
        self.assertEqual(self.snapshot(self.as_person(self.bob))["items"], [])
        self.assertEqual(self.clear(result.data).status_code, 200)
        self.assertEqual(self.snapshot()["items"], [])
        message.refresh_from_db();self.chat.refresh_from_db()
        self.assertEqual((message.delivered_at, message.read_at), original)
        self.assertEqual(self.chat.activity_version, 0)
        self.assertFalse(Notification.objects.exists())
        self.assertFalse(ChannelReadState.objects.exists())
        self.assertFalse(ChannelThreadReadState.objects.exists())

    def test_scopes_are_independent_and_retargeting_one_scope_does_not_duplicate(self):
        direct = self.direct("DM")
        root = self.channel_message("Raíz")
        reply = self.channel_message("Respuesta", parent=root)
        later = self.channel_message("Otra raíz")
        for message, kind in ((direct,"chat"),(root,"channel"),(reply,"channel")):
            response = self.mark(message, kind)
            self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(self.snapshot()["items"]), 3)
        response = self.mark(later, "channel")
        self.assertEqual(response.status_code, 200, response.data)
        items = self.snapshot()["items"]
        self.assertEqual(len(items), 3)
        self.assertIn(str(later.pk), [row["target"]["message_id"] for row in items])
        self.assertNotIn(str(root.pk), [row["target"]["message_id"] for row in items])

    def test_retries_are_immutable_and_stale_operations_cannot_resurrect_cleared_state(self):
        message = self.direct("Intento")
        client_id = str(uuid.uuid4())
        marked = self.mark(message, client_id=client_id, version=0)
        self.assertEqual(marked.status_code, 200, marked.data)
        replay = self.mark(message, client_id=client_id, version=0)
        self.assertEqual(replay.data, marked.data)
        cleared = self.clear(marked.data)
        self.assertEqual(cleared.status_code, 200, cleared.data)
        late = self.mark(message, client_id=client_id, version=0)
        self.assertEqual(late.status_code, 409)
        self.assertEqual(self.snapshot()["items"], [])
        self.assertEqual(self.mark(message).status_code, 200, 'current state permits a deliberate new mark after clearing')

    def test_owner_foreign_ids_and_private_channel_revocation_cannot_disclose_markers(self):
        message = self.direct("Solo participantes")
        owner = self.as_person(self.owner)
        self.assertEqual(owner.get(self.endpoint,{"kind":"chat","source_id":str(message.pk)}).status_code,404)
        own = self.mark(message).data
        self.assertEqual(self.clear(own, owner).status_code,404)
        channel = self.channel_message("Canal privado")
        channel.channel.visibility="private";channel.channel.save()
        rule=ChannelAccessRule.objects.create(channel=channel.channel,employee=self.bob.employee,access="read")
        bob=self.as_person(self.bob)
        marked=self.mark(channel,"channel",bob)
        self.assertEqual(marked.status_code,200,marked.data)
        rule.access="blocked";rule.save()
        self.assertEqual(self.snapshot(bob)["items"],[])
        hidden=bob.get('/api/v2/messaging/search/',{'marked_unread':'true','archived':'true'})
        self.assertEqual(hidden.data['results'],[])
        self.assertEqual(self.clear(marked.data,bob).status_code,200,'one may remove a personal unavailable reminder without reading its old source')

    def test_search_finds_old_marked_anchors_without_reading_and_other_people_do_not_see_them(self):
        message=self.direct("Referencia histórica")
        self.mark(message)
        rows=self.client.get('/api/v2/messaging/search/',{'marked_unread':'true'})
        self.assertEqual(rows.status_code,200,rows.data)
        self.assertEqual([row['source_id'] for row in rows.data['results']],[str(message.pk)])
        self.assertEqual(self.as_person(self.bob).get('/api/v2/messaging/search/',{'marked_unread':'true'}).data['results'],[])
        message.refresh_from_db();self.assertIsNone(message.read_at)
        self.assertEqual(self.client.get('/api/v2/messaging/search/',{'marked_unread':'true','kind':'page'}).status_code,400)

    def test_source_deletion_advances_clock_and_preserves_a_stale_request_tombstone(self):
        message=self.direct("Eliminar fuente de prueba")
        marked=self.mark(message).data
        before=self.snapshot()['version']
        message.delete()
        after=self.snapshot()
        self.assertEqual(after['items'],[])
        self.assertGreater(after['version'],before)
        row=ReadingReminder.objects.get(pk=marked['id'])
        self.assertIsNone(row.document_id)
        self.assertGreater(row.version,marked['version'])
        self.assertEqual(self.clear(marked).status_code,409)

    def test_push_is_only_an_own_employee_hint_and_no_notification_or_message_activity(self):
        message=self.direct("Sin difusión")
        with patch('boldApp.mensajeria.reading_reminders.get_channel_layer') as layer:
            from asgiref.sync import async_to_sync
            from unittest.mock import AsyncMock
            layer.return_value.group_send=AsyncMock()
            with self.captureOnCommitCallbacks(execute=True):
                response=self.mark(message)
            self.assertEqual(response.status_code,200,response.data)
            layer.return_value.group_send.assert_awaited_once_with('messaging_employee_'+str(self.alice.employee_id),
                {'type':'messaging.reminder.changed','employee_id':str(self.alice.employee_id)})
        self.assertEqual(Notification.objects.count(),0)

    def test_pilot_mfa_and_strict_inputs_still_gate_personal_state(self):
        message=self.channel_message("Permisos")
        self.mark(message,"channel")
        permission=Permission.objects.get(code='slack.channel.read')
        permission.requires_step_up_mfa=True;permission.save()
        self.assertEqual(self.snapshot()['items'],[])
        permission.requires_step_up_mfa=False;permission.save()
        for values in ({},{'kind':'page','source_id':self.page['id']},{'kind':'chat','source_id':'invalid'},
            {'kind':'channel','source_id':str(message.pk),'employee_id':str(self.bob.employee_id)}):
            self.assertEqual(self.client.get(self.endpoint,values).status_code,400)
        self.assertEqual(APIClient().get(self.endpoint,{'kind':'channel','source_id':str(message.pk)}).status_code,401)
        with override_settings(MESSAGING_PILOT_ENABLED=True,MESSAGING_PILOT_UNIT_IDS=[]):
            self.assertEqual(self.client.get(self.endpoint,{'kind':'channel','source_id':str(message.pk)}).status_code,403)

    def test_active_limit_rejects_atomically_but_clearing_releases_capacity(self):
        first=self.direct('Primer pendiente');second=self.channel_message('Segundo ámbito')
        with patch('boldApp.mensajeria.reading_views.MAX_READING_REMINDERS',1):
            saved=self.mark(first)
            self.assertEqual(saved.status_code,200,saved.data)
            before=ReadingReminderClock.objects.get(employee=self.alice.employee).version
            rejected=self.mark(second,'channel')
            self.assertEqual(rejected.status_code,400)
            self.assertEqual(ReadingReminder.objects.count(),1,'failed scope creation must roll back')
            self.assertEqual(ReadingReminderClock.objects.get(employee=self.alice.employee).version,before)
            self.assertEqual(self.clear(saved.data).status_code,200)
            self.assertEqual(self.mark(second,'channel').status_code,200)

    def test_socket_projection_rechecks_employee_session_permission_and_pilot(self):
        from django.test import RequestFactory
        from boldApp.autenticacion.services import create_session
        from .reading_reminders import reading_event
        message=self.channel_message('Proyección sin contenido')
        self.mark(message,'channel')
        _,session=create_session(self.alice.employee.user_account,RequestFactory().get('/',REMOTE_ADDR='127.0.0.1'))
        event={'employee_id':str(self.alice.employee_id)}
        projected=reading_event(self.alice.pk,session.pk,event)
        self.assertEqual(len(projected['payload']['reading']['items']),1)
        self.assertNotIn(message.body,str(projected))
        self.assertIsNone(reading_event(self.bob.pk,session.pk,event))
        permission=Permission.objects.get(code='slack.channel.read')
        permission.requires_step_up_mfa=True;permission.save()
        self.assertEqual(reading_event(self.alice.pk,session.pk,event)['payload']['reading']['items'],[])
        permission.requires_step_up_mfa=False;permission.save()
        with override_settings(MESSAGING_PILOT_ENABLED=True,MESSAGING_PILOT_UNIT_IDS=[]):
            self.assertIsNone(reading_event(self.alice.pk,session.pk,event))
        session.revoked_at=timezone.now();session.save(update_fields=['revoked_at'])
        self.assertIsNone(reading_event(self.alice.pk,session.pk,event))
