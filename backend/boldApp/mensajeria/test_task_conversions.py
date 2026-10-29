import uuid
from unittest.mock import patch
from django.test import TestCase, override_settings
from django.utils import timezone
from boldApp.core.models import JobRolePermission, Permission
from boldApp.tareas.models import Project, Section, Task, TaskProject, TaskFollower
from . import test_saved_items as fixtures
from .models import ChannelAccessRule, DepartmentChannel, MessageTaskConversion


@override_settings(MESSAGING_PILOT_ENABLED=False, AUTH_ENCRYPTION_KEY="conversion-draft-test-only")
class TaskConversionTests(TestCase):
    root=fixtures.SavedItemTests.root
    identity=fixtures.SavedItemTests.identity
    as_person=fixtures.SavedItemTests.as_person
    blocks=fixtures.SavedItemTests.blocks
    direct=fixtures.SavedItemTests.direct
    channel_message=fixtures.SavedItemTests.channel_message

    def setUp(self):
        fixtures.SavedItemTests.setUp(self)
        for code in ('tasks.task.read','tasks.task.create','tasks.project.read','tasks.project.manage'):
            JobRolePermission.objects.get_or_create(job_role=self.role,permission=Permission.objects.get(code=code),scope_type='global',defaults={'effect':'allow'})
        self.project=Project.objects.create(unit=self.it,owner_assignment=self.alice,created_by_assignment=self.alice,name='Proyecto compartido',status='active')
        self.section=Section.objects.create(project=self.project,name='Por hacer',position=1)
        self.message=self.direct('Preparar la propuesta privada')
        self.endpoint=f'/api/v2/messaging/conversations/{self.chat.pk}/messages/{self.message.pk}/tasks/'
        self.values={'client_id':str(uuid.uuid4()),'source_version':1,'project':str(self.project.pk),'section':str(self.section.pk),
            'assignee_assignment':str(self.bob.pk),'due_date':'2026-11-15','title':'Propuesta revisada',
            'description':'Solo este texto aprobado se comparte.','share_confirmed':True}

    def create(self,client=None,**overrides):
        return (client or self.client).post(self.endpoint,{**self.values,**overrides},format='json')

    def test_normal_task_project_follower_pipeline_dates_and_two_way_reference(self):
        result=self.create();self.assertEqual(result.status_code,201,result.data)
        task=Task.objects.get(pk=result.data['task']['id'])
        self.assertEqual(task.title,self.values['title']);self.assertEqual(str(task.due_date),'2026-11-15')
        self.assertEqual(task.description,'<!--bold-rich-text--><p>Solo este texto aprobado se comparte.</p>')
        self.assertEqual(task.assignee_assignment_id,self.bob.pk);self.assertEqual(task.unit_id,self.it.pk)
        link=TaskProject.objects.get(task=task);self.assertEqual(link.project,self.project);self.assertEqual(link.section,self.section)
        self.assertIsNotNone(link.pipeline_id);self.assertIsNotNone(link.pipeline_stage)
        self.assertTrue(TaskFollower.objects.filter(task=task,assignment=self.alice).exists())
        linked=self.client.get(self.endpoint);self.assertEqual(linked.status_code,200,linked.data)
        self.assertEqual(linked.data['results'][0]['task']['id'],str(task.pk))
        origins=self.client.get(f'/api/v2/tasks/{task.pk}/message-origins/')
        self.assertEqual(origins.status_code,200,origins.data)
        self.assertIn('no-store',origins['Cache-Control'])
        self.assertEqual(origins.data['results'][0]['target']['message_id'],str(self.message.pk))
        self.message.refresh_from_db();self.chat.refresh_from_db()
        self.assertEqual(self.message.body,'Preparar la propuesta privada');self.assertEqual(self.message.version,1)
        self.assertIsNone(self.message.read_at);self.assertEqual(self.chat.activity_version,0)

    def test_immutable_retry_does_not_duplicate_task_links_followers_or_recopy_later_edit(self):
        first=self.create();self.assertEqual(first.status_code,201,first.data)
        self.message.body='Editado después';self.message.version=2;self.message.save()
        replay=self.create();self.assertEqual(replay.status_code,200,replay.data)
        self.assertEqual(replay.data['task']['id'],first.data['task']['id'])
        self.assertEqual(self.create(title='Cambiar el intento').status_code,409)
        self.assertEqual(MessageTaskConversion.objects.count(),1);self.assertEqual(Task.objects.count(),1)

    def test_first_stale_attempt_requires_review_and_consent_is_mandatory(self):
        self.assertEqual(self.create(share_confirmed=False).status_code,400)
        self.message.version=2;self.message.save()
        self.assertEqual(self.create().status_code,409)
        self.assertFalse(Task.objects.exists());self.assertFalse(MessageTaskConversion.objects.exists())

    def test_source_boundary_no_owner_bypass_and_hidden_backlinks_do_not_leak_a_dm(self):
        owner=self.as_person(self.owner)
        self.assertEqual(owner.get(self.endpoint).status_code,404)
        self.assertEqual(self.create(owner).status_code,404)
        result=self.create();task_id=result.data['task']['id']
        origins=owner.get(f'/api/v2/tasks/{task_id}/message-origins/')
        self.assertEqual(origins.status_code,200,origins.data)
        self.assertEqual(origins.data['results'],[])

    def test_target_permissions_validation_and_revoked_source_fail_without_partial_task(self):
        other=Project.objects.create(unit=self.it,owner_assignment=self.alice,created_by_assignment=self.alice,name='Otro proyecto',status='active')
        wrong=Section.objects.create(project=other,name='No válida',position=1)
        self.assertEqual(self.create(section=str(wrong.pk)).status_code,400)
        self.assertEqual(self.create(assignee_assignment=str(uuid.uuid4())).status_code,400)
        JobRolePermission.objects.filter(job_role=self.role,permission__code='tasks.task.create').update(effect='deny')
        self.assertEqual(self.create().status_code,403)
        self.assertFalse(Task.objects.exists());self.assertFalse(MessageTaskConversion.objects.exists())

    def test_link_collection_filters_task_permissions_and_replay_never_recreates_a_deleted_task(self):
        result=self.create();task_id=result.data['task']['id']
        Task.objects.filter(pk=task_id).update(deleted_at=timezone.now())
        replay=self.create();self.assertEqual(replay.status_code,200,replay.data)
        self.assertEqual(replay.data['task'],{'available':False})
        self.assertEqual(self.client.get(self.endpoint).data['results'],[])
        self.assertEqual(MessageTaskConversion.objects.count(),1)

    def test_project_catalog_does_not_show_non_writable_projects_and_retains_sections(self):
        root='/api/v2/messaging/task-conversion-projects/'
        rows=self.client.get(root);self.assertEqual(rows.status_code,200,rows.data)
        self.assertIn(str(self.project.pk),[row['id'] for row in rows.data['results']])
        self.project.unsectioned_hidden=True;self.project.save()
        detail=self.client.get(root+str(self.project.pk)+'/')
        self.assertEqual(detail.status_code,200,detail.data)
        self.assertEqual(detail.data['sections'],[{'id':str(self.section.pk),'name':'Por hacer'}])
        self.assertTrue(detail.data['statuses'])
        JobRolePermission.objects.filter(job_role=self.role,permission__code='tasks.project.manage').update(effect='deny')
        self.assertEqual(self.client.get(root).data['results'],[])
        self.assertEqual(self.client.get(root+str(self.project.pk)+'/').status_code,403)

    def test_plain_text_does_not_embed_or_copy_message_media_or_html(self):
        value='<!--bold-rich-text--><img src="https://example.invalid/private.png">\n<script>bad</script>\n<img src="data:image/png;base64,AAAA">'
        with patch('boldApp.tareas.serializers.store_instance_images') as upload:
            result=self.create(description=value)
            self.assertEqual(result.status_code,201,result.data);upload.assert_not_called()
        task=Task.objects.get(pk=result.data['task']['id'])
        self.assertIn('&lt;img',task.description);self.assertNotIn('<img',task.description)
        self.assertTrue(task.description.startswith('<!--bold-rich-text--><p>'))
        self.assertNotIn('data:image/',task.description)

    def test_channel_reply_and_archived_readonly_source_do_not_grant_target_writes(self):
        root=self.channel_message('Raíz');reply=self.channel_message('Acuerdo en hilo',parent=root)
        self.endpoint=f'/api/v2/messaging/channels/{self.channel_id}/messages/{reply.pk}/tasks/'
        DepartmentChannel.objects.filter(pk=self.channel_id).update(visibility='private',archived_at=timezone.now())
        self.assertEqual(self.client.get(self.endpoint).status_code,404)
        ChannelAccessRule.objects.create(channel_id=self.channel_id,employee=self.alice.employee,access='read')
        result=self.create();self.assertEqual(result.status_code,201,result.data)
        target=self.client.get(f'/api/v2/tasks/{result.data["task"]["id"]}/message-origins/').data['results'][0]['target']
        self.assertEqual(target['parent_id'],str(root.pk))
        with override_settings(MESSAGING_PILOT_ENABLED=True,MESSAGING_PILOT_UNIT_IDS=[]):
            self.assertEqual(self.client.get(self.endpoint).status_code,403)

    def test_conversion_draft_has_its_own_source_gate_key_and_cannot_grant_task_writes(self):
        root='/api/v2/messaging/draft-grants/'
        scope={'kind':'message-task','resource_id':str(self.message.pk),'source_kind':'chat','container_id':str(self.chat.pk)}
        draft=self.client.post(root,scope,format='json');self.assertEqual(draft.status_code,200,draft.data)
        composer=self.client.post(root,{'kind':'conversation','resource_id':str(self.chat.pk)},format='json')
        self.assertNotEqual(draft.data['key_id'],composer.data['key_id'])
        self.assertEqual(self.as_person(self.owner).post(root,scope,format='json').status_code,404)
        self.assertEqual(self.client.post(root,{**scope,'container_id':str(uuid.uuid4())},format='json').status_code,404)
        self.assertEqual(self.client.post(root,{'kind':'message-task','resource_id':str(self.message.pk)},format='json').status_code,400)
        JobRolePermission.objects.filter(job_role=self.role,permission__code='tasks.task.create').update(effect='deny')
        self.assertEqual(self.client.post(root,scope,format='json').status_code,200,'one may still revise their local source-bound draft')
        self.assertEqual(self.create().status_code,403,'a decryption key is not permission to create a Task')

    def test_mfa_target_restriction_and_source_deletion_do_not_leave_partial_or_private_references(self):
        permission=Permission.objects.get(code='tasks.task.create');permission.requires_step_up_mfa=True;permission.save()
        self.assertEqual(self.create().status_code,403)
        self.assertFalse(Task.objects.exists())
        permission.requires_step_up_mfa=False;permission.save()
        result=self.create();self.assertEqual(result.status_code,201,result.data)
        task_id=result.data['task']['id'];self.message.delete()
        self.assertEqual(self.client.get(f'/api/v2/tasks/{task_id}/message-origins/').data['results'],[])
        self.assertTrue(Task.objects.filter(pk=task_id).exists())
        self.assertIsNone(MessageTaskConversion.objects.get().document_id)

    def test_normal_tasks_without_sources_do_not_scan_all_channel_permissions(self):
        from types import SimpleNamespace
        from boldApp.core.models import PositionAssignment
        from .task_conversions import task_origins
        assignment=PositionAssignment.objects.select_related('employee','position__unit').get(pk=self.alice.pk)
        task=Task(pk=uuid.uuid4())
        with self.assertNumQueries(1):
            self.assertEqual(task_origins(SimpleNamespace(assignment=assignment),task),[])
