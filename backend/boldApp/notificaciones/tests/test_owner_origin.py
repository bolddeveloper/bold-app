from django.test import TestCase

from boldApp.core.models import Employee, UserAccount, OrganizationalUnit, JobRole, Position, PositionAssignment
from boldApp.notificaciones.events import build_notification_envelope
from boldApp.notificaciones.models import Notification
from boldApp.notificaciones.serializers import NotificationSerializer
from boldApp.notificaciones.services import create_notification


class OwnerOriginTests(TestCase):
    def setUp(self):
        unit = OrganizationalUnit.objects.create(name='Origen sintético', unit_type='department', sensitivity_level='low')
        role = JobRole.objects.create(title='Propietario')
        def person(email, **flags):
            employee = Employee.objects.create(full_name='Luis')
            UserAccount.objects.create_user(email=email, employee=employee, **flags)
            return PositionAssignment.objects.create(employee=employee, position=Position.objects.create(unit=unit, job_role=role))
        self.owner = person('owner-origin@bold.gt', is_superuser=True)
        self.staff = person('support-origin@bold.gt', is_staff=True, can_manage_connectors=True)
        self.recipient = person('recipient-origin@bold.gt')

    def notice(self, actor, event='comment.created', **extra):
        return create_notification(recipient=self.recipient, actor=actor, event_type=event, title='Interacción sintética', **extra)

    def test_all_existing_notice_types_share_server_origin_without_extra_recipients(self):
        for event in ('task.assigned', 'task.updated', 'comment.created', 'comment.mentioned', 'messaging.message_created', 'slack.mentioned', 'slack.message_created'):
            with self.subTest(event=event):
                row = self.notice(self.owner, event)
                self.assertTrue(NotificationSerializer(row).data['actor_is_owner'])
                self.assertTrue(build_notification_envelope(row)['payload']['actor_is_owner'])
                self.assertEqual(row.recipient_assignment, self.recipient)
        self.assertEqual(Notification.objects.count(), 7)

    def test_staff_connector_authority_display_name_and_role_cannot_spoof_owner(self):
        row = self.notice(self.staff, metadata={'actor_is_owner':True, 'retained':'value'})
        self.assertIs(row.metadata['actor_is_owner'], False)
        self.assertEqual(row.metadata['retained'], 'value')
        self.assertIs(NotificationSerializer(row).data['actor_is_owner'], False)
        self.assertIs(build_notification_envelope(row)['payload']['actor_is_owner'], False)
        self.assertIs(NotificationSerializer(self.notice(None)).data['actor_is_owner'], False)

    def test_origin_is_a_send_time_snapshot_and_deduplication_keeps_it(self):
        row = self.notice(self.owner, dedupe_key='owner-origin-once')
        account = self.owner.employee.user_account
        account.is_superuser = False; account.save(update_fields=['is_superuser'])
        self.assertIsNone(self.notice(self.owner, dedupe_key='owner-origin-once'))
        row.refresh_from_db()
        self.assertIs(NotificationSerializer(row).data['actor_is_owner'], True)
        self.assertIs(NotificationSerializer(self.notice(self.owner)).data['actor_is_owner'], False)

    def test_muted_events_self_notifications_and_legacy_rows_do_not_gain_special_alerts(self):
        account = self.recipient.employee.user_account
        account.notification_settings = {'events':{'comment.created':False}}
        account.save(update_fields=['notification_settings'])
        self.assertIsNone(self.notice(self.owner))
        self.assertIsNone(create_notification(recipient=self.owner, actor=self.owner, event_type='task.updated', title='No autoaviso'))
        legacy = Notification.objects.create(recipient_assignment=self.recipient, actor_assignment=self.owner,
            type='task.updated', title='Anterior', metadata={})
        self.assertIs(NotificationSerializer(legacy).data['actor_is_owner'], False)
