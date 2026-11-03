import base64
from types import SimpleNamespace
from unittest.mock import patch
from django.test import TestCase, override_settings
from boldApp.core.models import OrganizationalUnit, Position
from . import test_private_servers as fixtures
from .models import ServerIcon
from boldApp.workspace.models import ImageStorageRoot, StoredImage

IMAGE = 'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA'


@override_settings(MESSAGING_PILOT_ENABLED=False)
class ServerIconTests(TestCase):
    root = fixtures.PrivateServerTests.root
    servers = fixtures.PrivateServerTests.servers
    identity = fixtures.PrivateServerTests.identity
    as_person = fixtures.PrivateServerTests.as_person
    create = fixtures.PrivateServerTests.create
    deny = fixtures.PrivateServerTests.deny

    def setUp(self):
        fixtures.PrivateServerTests.setUp(self)
        self.icon = f'/api/v2/messaging/server-icons/department/{self.it.pk}/'
        direction = OrganizationalUnit.objects.create(name='Dirección', unit_type='department', sensitivity_level='low', is_control_plane=True)
        self.director = self.identity('director', direction)
        self.storage = ImageStorageRoot.objects.create(user=self.alice.employee.user_account, subject='fixture',
            client_id='fixture',google_email='fixture@example.invalid',folder_id='root',folder_name='Images',active=True)
        self.drive_calls=[]
        def google(user,method,path,**options):
            self.drive_calls.append((method,path,options))
            if options.get('raw'):return SimpleNamespace(content=base64.b64decode(IMAGE.split(',')[1]))
            if method=='GET':return {'files':[]}
            return {'id':'fixture_drive_'+str(len(self.drive_calls))}
        for target in ('boldApp.workspace.image_storage.storage_user','boldApp.workspace.image_views.storage_user'):
            mock=patch(target,return_value=self.alice.employee.user_account);mock.start();self.addCleanup(mock.stop)
        mock=patch('boldApp.workspace.image_storage.google',side_effect=google);mock.start();self.addCleanup(mock.stop)
        mock=patch('boldApp.workspace.image_views.google',return_value=SimpleNamespace(content=base64.b64decode(IMAGE.split(',')[1])));self.read_drive=mock.start();self.addCleanup(mock.stop)

    def put_icon(self, client, url=None, **extra):
        return client.patch(url or self.icon, {'image':IMAGE, 'version':0, **extra}, format='json')

    def test_head_edits_own_area_without_renaming_or_getting_other_areas(self):
        self.assertFalse(self.client.get(self.icon).data['can_edit_icon'])
        self.assertEqual(self.put_icon(self.client).status_code,403)
        Position.objects.create(unit=self.it, job_role=self.role, reports_to_position=self.alice.position)
        saved=self.put_icon(self.client)
        self.assertEqual(saved.status_code,200,saved.data)
        self.assertEqual(self.it.name,'IT')
        photo=self.client.get(saved.data['avatar_url'])
        self.assertEqual(photo.status_code,200)
        self.assertEqual(photo['Content-Type'],'image/webp')
        self.assertIn('no-store',photo['Cache-Control'])
        other=f'/api/v2/messaging/server-icons/department/{self.marketing.pk}/'
        self.assertEqual(self.put_icon(self.client,other).status_code,403)
        self.assertEqual(self.put_icon(self.client,version=1,name='No renombrar').status_code,400)

    def test_direction_can_edit_department_image_but_explicit_core_denials_win(self):
        director=self.as_person(self.director)
        self.assertEqual(self.put_icon(director).status_code,200)
        self.assertEqual(self.put_icon(director).status_code,409)
        self.deny('slack.channel.manage')
        self.assertEqual(self.put_icon(director,version=1).status_code,403)

    def test_private_icons_obey_invitations_even_for_direction(self):
        server, _, _=self.create()
        url=f'/api/v2/messaging/server-icons/private/{server["id"]}/'
        self.assertEqual(self.put_icon(self.client,url).status_code,200)
        peer=self.as_person(self.bob)
        meta=peer.get(url)
        self.assertFalse(meta.data['can_edit_icon'])
        self.assertEqual(peer.get(meta.data['avatar_url']).status_code,200)
        self.assertEqual(self.put_icon(peer,url,version=1).status_code,403)
        director=self.as_person(self.director)
        self.assertEqual(director.get(url).status_code,404)
        self.assertEqual(director.get(meta.data['avatar_url']).status_code,404)

    def test_validation_reset_and_catalog_never_embed_image_bytes(self):
        director=self.as_person(self.director)
        for value in ('https://example.com/photo.webp','data:image/svg+xml;base64,AAAA','data:image/webp;base64,UklGRgAAAABXRUJQ'):
            self.assertEqual(self.put_icon(director,image=value).status_code,400)
        saved=self.put_icon(director)
        self.assertEqual(saved.status_code,200,saved.data)
        catalog=director.get('/api/v2/messaging/departments/').data['results']
        row=next(row for row in catalog if row['id']==str(self.it.pk))
        self.assertTrue(row['can_edit_icon'])
        self.assertNotIn('data:image',str(catalog))
        cleared=self.put_icon(director,image=None,version=1)
        self.assertIsNone(cleared.data['avatar_url'])
        self.assertEqual(cleared.data['icon_version'],2)
        self.assertEqual(ServerIcon.objects.count(),1)

    def test_drive_reference_only_and_failure_never_falls_back_to_base64(self):
        director=self.as_person(self.director)
        result=self.put_icon(director)
        self.assertEqual(result.status_code,200,result.data)
        row=ServerIcon.objects.get(unit=self.it)
        self.assertTrue(row.image.startswith('/api/v2/media/images/'))
        self.assertEqual(StoredImage.objects.count(),1)
        old=row.image
        from boldApp.workspace.service import GoogleUnavailable
        with patch('boldApp.mensajeria.server_icons.persist_image',side_effect=GoogleUnavailable()):
            self.assertEqual(self.put_icon(director,version=1).status_code,503)
        row.refresh_from_db();self.assertEqual(row.image,old);self.assertEqual(row.version,1)

    def test_direct_image_reference_never_bypasses_private_membership(self):
        server,_,_=self.create()
        url=f'/api/v2/messaging/server-icons/private/{server["id"]}/'
        self.put_icon(self.client,url)
        reference=ServerIcon.objects.get(server_id=server['id']).image
        self.read_drive.reset_mock()
        self.assertEqual(self.as_person(self.director).get(reference).status_code,404)
        self.read_drive.assert_not_called()

    def test_legacy_icon_is_retained_if_drive_checksum_fails(self):
        from django.db import transaction
        from rest_framework.exceptions import ValidationError
        from boldApp.workspace.image_storage import store_instance_images
        row=ServerIcon.objects.create(unit=self.it,image=IMAGE,version=1)
        def google(user,method,path,**options):
            if options.get('raw'):return SimpleNamespace(content=b'wrong image')
            return {'files':[]} if method=='GET' else {'id':'synthetic_drive_id'}
        with patch('boldApp.workspace.image_storage.google',side_effect=google):
            with self.assertRaises(ValidationError),transaction.atomic():
                store_instance_images(row,fields=['image'])
        row.refresh_from_db();self.assertEqual((row.image,row.version),(IMAGE,1))
