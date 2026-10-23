import uuid
from django.test import TestCase, override_settings
from . import test_pages as base
from .models import PageTemplate, ChannelPage, DepartmentChannel, ChannelAccessRule


@override_settings(MESSAGING_PILOT_ENABLED=False)
class PageTemplateTests(TestCase):
    root = base.ChannelPageTests.root
    identity = base.ChannelPageTests.identity
    as_person = base.ChannelPageTests.as_person
    deny = base.ChannelPageTests.deny
    blocks = base.ChannelPageTests.blocks

    def setUp(self):
        base.ChannelPageTests.setUp(self)
        self.templates = self.url+"templates/"
        self.capture = {"client_id":str(uuid.uuid4()),"page_id":self.page["id"],"page_version":1,"name":"Acuerdos reutilizables","description":"Modelo del canal"}

    def create(self):
        result=self.client.post(self.templates,self.capture,format="json")
        self.assertEqual(result.status_code,201,result.data)
        return result.data

    def test_builtin_and_channel_templates_create_independent_pages_with_fresh_blocks(self):
        listed=self.client.get(self.templates)
        self.assertEqual(len(listed.data["builtins"]),3)
        source=self.create()
        for identity in ("builtin-meeting",source["id"]):
            result=self.client.post(self.templates+identity+"/pages/",{"client_id":str(uuid.uuid4())},format="json")
            self.assertEqual(result.status_code,201,result.data)
            self.assertNotEqual(result.data["id"],self.page["id"])
            self.assertNotIn(self.page["blocks"][0]["id"],[row["id"] for row in result.data["blocks"]])
        self.assertEqual(ChannelPage.objects.count(),3)

    def test_capture_and_instantiation_retry_are_idempotent_even_if_template_changes(self):
        row=self.create()
        self.assertEqual(self.client.post(self.templates,self.capture,format="json").status_code,200)
        self.assertEqual(PageTemplate.objects.count(),1)
        target=self.templates+row["id"]+"/pages/"
        token={"client_id":str(uuid.uuid4())}
        first=self.client.post(target,token,format="json")
        PageTemplate.objects.filter(pk=row["id"]).update(name="Otro nombre",version=2)
        replay=self.client.post(target,token,format="json")
        self.assertEqual(replay.status_code,200)
        self.assertEqual(first.data["id"],replay.data["id"])
        self.assertEqual(ChannelPage.objects.count(),2)

    def test_replacing_and_renaming_use_expected_revision(self):
        row=self.create();detail=self.templates+row["id"]+"/"
        self.assertEqual(self.client.patch(detail,{"version":1,"name":"Nombre actualizado"},format="json").status_code,200)
        self.assertEqual(self.client.patch(detail,{"version":1,"name":"Obsoleto"},format="json").status_code,409)
        self.assertEqual(self.client.put(detail,{**self.capture,"version":2,"name":"Contenido actualizado"},format="json").status_code,200)
        self.assertEqual(PageTemplate.objects.get().version,3)
        self.assertEqual(self.client.put(detail,{**self.capture,"version":3,"page_version":99},format="json").status_code,409)

    def test_archive_preserves_template_and_does_not_modify_existing_pages(self):
        row=self.create();detail=self.templates+row["id"]+"/"
        self.assertEqual(self.client.patch(detail,{"version":1,"archived":True},format="json").status_code,200)
        self.assertEqual(self.client.get(self.templates).data["results"],[])
        self.assertEqual(len(self.client.get(self.templates+"?archived=true").data["results"]),1)
        self.assertEqual(self.client.post(detail+"pages/",{"client_id":str(uuid.uuid4())},format="json").status_code,404)
        self.assertEqual(self.client.get(self.detail).status_code,200)
        self.assertEqual(self.client.delete(detail).status_code,405)
        self.assertEqual(self.client.patch(detail,{"version":2,"archived":False},format="json").status_code,200)

    def test_channel_boundary_applies_to_templates_and_owner_without_invitation(self):
        row=self.create()
        DepartmentChannel.objects.filter(pk=self.channel_id).update(visibility="private")
        for assignment in (self.bob,self.owner):
            client=self.as_person(assignment)
            self.assertEqual(client.get(self.templates).status_code,404)
            self.assertEqual(client.get(self.templates+row["id"]+"/").status_code,404)
            self.assertEqual(client.post(self.templates+row["id"]+"/pages/",{"client_id":str(uuid.uuid4())},format="json").status_code,404)
        ChannelAccessRule.objects.create(channel_id=self.channel_id,employee=self.bob.employee,access="read")
        client=self.as_person(self.bob)
        self.assertEqual(client.get(self.templates).status_code,200)
        self.assertEqual(client.post(self.templates,self.capture,format="json").status_code,403)

    def test_configurable_denials_and_cross_channel_source_do_not_leak(self):
        another=self.client.post(self.root,{"name":"Otro"},format="json").data["id"]
        foreign=self.root+another+"/templates/"
        self.assertEqual(self.client.post(foreign,self.capture,format="json").status_code,404)
        self.deny("slack.template.create")
        self.assertEqual(self.client.post(self.templates,self.capture,format="json").status_code,403)
        self.assertEqual(self.client.get(self.collection).status_code,200)
        self.deny("slack.template.read")
        self.assertEqual(self.client.get(self.templates).status_code,403)
