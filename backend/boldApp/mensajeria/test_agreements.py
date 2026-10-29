import uuid
from unittest.mock import patch
from django.test import TestCase, override_settings
from django.utils import timezone
from . import test_saved_items as fixtures
from .models import ChannelPage, PageRevision, MessageAgreement, AgreementSource, ChannelAccessRule, DepartmentChannel


@override_settings(MESSAGING_PILOT_ENABLED=False, AUTH_ENCRYPTION_KEY='agreement-test-only')
class AgreementTests(TestCase):
    root=fixtures.SavedItemTests.root
    identity=fixtures.SavedItemTests.identity
    as_person=fixtures.SavedItemTests.as_person
    blocks=fixtures.SavedItemTests.blocks
    deny=fixtures.SavedItemTests.deny
    direct=fixtures.SavedItemTests.direct
    channel_message=fixtures.SavedItemTests.channel_message

    def setUp(self):
        fixtures.SavedItemTests.setUp(self)
        self.first=self.direct('Aprobamos la propuesta B')
        self.second=self.direct('Entrega el viernes')
        self.endpoint=f'/api/v2/messaging/conversations/{self.chat.pk}/agreements/'
        self.review=f'/api/v2/messaging/conversations/{self.chat.pk}/agreement-review/'
        self.values={'client_id':str(uuid.uuid4()), 'destination_channel_id':str(self.channel_id), 'title':'Acuerdos revisados',
            'introduction':'Solo estas decisiones se comparten.', 'share_confirmed':True,
            'entries':[{'message_id':str(row.pk),'source_version':row.version,'text':row.body} for row in (self.first,self.second)]}

    def create(self, client=None, **changes):
        return (client or self.client).post(self.endpoint,{**self.values, **changes},format='json')

    def page_result(self, result, client=None):
        return (client or self.client).get(f"/api/v2/messaging/channels/{self.channel_id}/pages/{result.data['page']['id']}/")

    def test_ordered_review_is_authorized_read_only_and_strictly_bounded(self):
        result=self.client.get(self.review,{'message_ids':f'{self.second.pk},{self.first.pk}'})
        self.assertEqual(result.status_code,200,result.data)
        self.assertEqual([row['message_id'] for row in result.data['results']],[str(self.second.pk),str(self.first.pk)])
        self.assertIn('no-store',result['Cache-Control']);self.assertFalse(result.data['files_copied'])
        self.assertEqual(self.as_person(self.owner).get(self.review,{'message_ids':str(self.first.pk)}).status_code,404)
        for ids in (f'{self.first.pk},{self.first.pk}',','.join(str(uuid.uuid4()) for _ in range(21)),'wrong'):
            self.assertEqual(self.client.get(self.review,{'message_ids':ids}).status_code,400)
        self.first.refresh_from_db();self.chat.refresh_from_db()
        self.assertIsNone(self.first.read_at);self.assertEqual(self.chat.activity_version,0)
        self.assertFalse(MessageAgreement.objects.exists())

    def test_normal_page_revision_crdt_and_filtered_backreferences(self):
        result=self.create();self.assertEqual(result.status_code,201,result.data)
        page=ChannelPage.objects.get(pk=result.data['page']['id'])
        self.assertEqual([row['text'] for row in page.blocks],[self.values['introduction'],self.first.body,self.second.body])
        self.assertEqual(PageRevision.objects.filter(page=page).count(),1)
        self.assertEqual(MessageAgreement.objects.get().page,page);self.assertEqual(AgreementSource.objects.count(),2)
        data=self.page_result(result);self.assertEqual(data.status_code,200,data.data)
        self.assertTrue(data.data['collaboration_enabled']);self.assertEqual(len(data.data['message_origins']),2)
        self.assertEqual(data.data['message_origins'][0]['target']['message_id'],str(self.first.pk))
        self.assertEqual(self.page_result(result,self.as_person(self.owner)).data['message_origins'],[])
        self.assertEqual(len(self.page_result(result,self.as_person(self.bob)).data['message_origins']),2)
        self.first.refresh_from_db();self.assertIsNone(self.first.read_at)

    def test_explicit_consent_version_and_destination_permissions_prevent_partial_creation(self):
        before=ChannelPage.objects.count()
        self.assertEqual(self.create(share_confirmed=False).status_code,400)
        self.first.version=2;self.first.save()
        self.assertEqual(self.create().status_code,409)
        self.assertEqual(ChannelPage.objects.count(),before);self.assertFalse(MessageAgreement.objects.exists())
        self.first.version=1;self.first.save();self.deny('slack.page.create')
        self.assertEqual(self.create().status_code,403)
        self.assertEqual(ChannelPage.objects.count(),before)

    def test_retry_is_immutable_and_does_not_recopy_a_later_edit_or_recreate_page(self):
        first=self.create();self.assertEqual(first.status_code,201,first.data)
        self.first.version=2;self.first.body='Contenido editado después';self.first.save()
        replay=self.create();self.assertEqual(replay.status_code,200,replay.data)
        self.assertEqual(replay.data['page']['id'],first.data['page']['id'])
        self.assertEqual(self.create(title='Otro contenido').status_code,409)
        self.assertEqual(MessageAgreement.objects.count(),1);self.assertEqual(AgreementSource.objects.count(),2)
        self.assertEqual(self.page_result(replay).data['blocks'][1]['text'],'Aprobamos la propuesta B')

    def test_long_literal_text_is_not_silently_truncated_or_uploaded(self):
        text='<script>literal</script> data:image/png;base64,AAAA https://example.invalid/'+'x'*4950
        entries=[{**self.values['entries'][0],'text':text}]
        with patch('boldApp.mensajeria.channel_media.store_channel_media') as upload:
            result=self.create(entries=entries);self.assertEqual(result.status_code,201,result.data);upload.assert_not_called()
        page=ChannelPage.objects.get(pk=result.data['page']['id'])
        self.assertEqual(''.join(row['text'] for row in page.blocks[1:]),text)
        self.assertTrue(all(len(row['text'])<=4000 for row in page.blocks))
        self.assertEqual(len(AgreementSource.objects.get().block_ids),2)

    def test_deleted_source_hides_reference_without_deleting_approved_page_text(self):
        result=self.create();self.first.delete()
        data=self.page_result(result).data
        self.assertEqual(data['blocks'][1]['text'],'Aprobamos la propuesta B')
        self.assertEqual(len(data['message_origins']),1);self.assertIsNone(AgreementSource.objects.order_by('position').first().document_id)
        page=ChannelPage.objects.get(pk=result.data['page']['id']);page.blocks=page.blocks[:1];page.save()
        self.assertEqual(self.page_result(result).data['message_origins'],[])

    def test_wrong_parent_duplicate_entries_and_unknown_fields_fail(self):
        before=ChannelPage.objects.count()
        invalid={**self.values['entries'][0],'message_id':str(uuid.uuid4())}
        self.assertEqual(self.create(entries=[invalid]).status_code,404)
        self.assertEqual(self.create(entries=[self.values['entries'][0]]*2).status_code,400)
        self.assertEqual(self.create(employee_id=str(self.owner.employee_id)).status_code,400)
        self.assertEqual(ChannelPage.objects.count(),before)

    def test_catalog_filters_private_readonly_archived_and_current_create_denials(self):
        endpoint='/api/v2/messaging/agreement-destinations/'
        rows=self.client.get(endpoint);self.assertEqual(rows.status_code,200,rows.data)
        self.assertIn(str(self.channel_id),[row['id'] for row in rows.data['results']])
        DepartmentChannel.objects.filter(pk=self.channel_id).update(visibility='private')
        owner=self.as_person(self.owner)
        self.assertNotIn(str(self.channel_id),[row['id'] for row in owner.get(endpoint).data['results']])
        self.deny('slack.page.create');self.assertEqual(self.client.get(endpoint).data['results'],[])

    def test_private_source_to_public_page_requires_read_but_never_grants_source_access(self):
        message=self.channel_message('Versión privada aprobada')
        private=DepartmentChannel.objects.get(pk=self.channel_id);private.visibility='private';private.save()
        ChannelAccessRule.objects.create(channel=private,employee=self.alice.employee,access='read')
        # The test's other readable public channel is deliberately a different destination.
        created=self.client.post('/api/v2/messaging/channels/',{'name':'Acuerdos públicos','unit_id':str(self.it.pk)},format='json')
        self.assertEqual(created.status_code,201,created.data)
        self.endpoint=f'/api/v2/messaging/channels/{private.pk}/agreements/'
        result=self.create(destination_channel_id=created.data['id'],entries=[{'message_id':str(message.pk),'source_version':1,'text':'Solo esta cita revisada'}])
        self.assertEqual(result.status_code,201,result.data)
        owner=self.as_person(self.owner)
        data=owner.get(f"/api/v2/messaging/channels/{created.data['id']}/pages/{result.data['page']['id']}/")
        self.assertEqual(data.status_code,200,data.data);self.assertEqual(data.data['message_origins'],[])
        self.assertEqual(data.data['blocks'][-1]['text'],'Solo esta cita revisada')

    def test_draft_scope_is_container_bound_and_does_not_grant_page_creation(self):
        scope={'kind':'message-agreement','resource_id':str(self.chat.pk),'source_kind':'chat'}
        result=self.client.post('/api/v2/messaging/draft-grants/',scope,format='json')
        self.assertEqual(result.status_code,200,result.data)
        self.assertEqual(self.as_person(self.owner).post('/api/v2/messaging/draft-grants/',scope,format='json').status_code,404)
        self.deny('slack.page.create')
        self.assertEqual(self.client.post('/api/v2/messaging/draft-grants/',scope,format='json').status_code,200)
        self.assertEqual(self.create().status_code,403)
        with override_settings(MESSAGING_PILOT_ENABLED=True,MESSAGING_PILOT_UNIT_IDS=[]):
            self.assertEqual(self.create().status_code,403)

    def test_large_unicode_page_is_rejected_atomically_and_empty_origins_are_cheap(self):
        before=ChannelPage.objects.count()
        messages=[self.direct('Texto') for _ in range(10)]
        result=self.create(entries=[{'message_id':str(row.pk),'source_version':1,'text':'字'*10000} for row in messages])
        self.assertEqual(result.status_code,400,result.data);self.assertEqual(ChannelPage.objects.count(),before)
        self.assertFalse(MessageAgreement.objects.exists())
        from .agreements import page_origins
        from types import SimpleNamespace
        page=ChannelPage.objects.get(pk=self.page['id'])
        with self.assertNumQueries(1):
            self.assertEqual(page_origins(SimpleNamespace(assignment=self.alice),page),[])

    def test_thread_reply_keeps_exact_parent_without_acknowledging_the_thread(self):
        from .models import ChannelThreadReadState
        parent=self.channel_message('Raíz del hilo');reply=self.channel_message('Acuerdo de la respuesta',parent=parent)
        self.endpoint=f'/api/v2/messaging/channels/{self.channel_id}/agreements/'
        result=self.create(entries=[{'message_id':str(reply.pk),'source_version':1,'text':'Decisión revisada del hilo'}])
        self.assertEqual(result.status_code,201,result.data)
        target=self.page_result(result).data['message_origins'][0]['target']
        self.assertEqual(target['parent_id'],str(parent.pk));self.assertEqual(target['message_id'],str(reply.pk))
        self.assertFalse(ChannelThreadReadState.objects.filter(parent=parent,employee=self.alice.employee).exists())
