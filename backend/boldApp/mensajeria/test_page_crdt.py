import base64
import json
from pathlib import Path
import subprocess
import uuid
from django.test import TestCase, RequestFactory, override_settings
from django.utils import timezone
from rest_framework.exceptions import APIException
from pycrdt import Text, Map
from boldApp.autenticacion.services import create_session
from . import test_pages as base
from .models import ChannelPage, PageCollaboration, PageUpdateReceipt, DepartmentChannel
from .page_collaboration import initial_state, commit_update, synchronize
from .page_crdt import encode, load_document


@override_settings(MESSAGING_PILOT_ENABLED=False)
class PageCRDTTests(TestCase):
    root=base.ChannelPageTests.root
    identity=base.ChannelPageTests.identity
    as_person=base.ChannelPageTests.as_person
    deny=base.ChannelPageTests.deny
    blocks=base.ChannelPageTests.blocks

    def setUp(self):
        base.ChannelPageTests.setUp(self)
        self.sessions={}
        for assignment in (self.alice,self.bob,self.owner):
            _,session=create_session(assignment.employee.user_account,RequestFactory().get("/",REMOTE_ADDR="127.0.0.1"))
            self.sessions[str(assignment.pk)]=session
        self.initial=initial_state(self.session(self.alice).pk,self.alice.pk,self.page["id"])

    def session(self,assignment):
        return self.sessions[str(assignment.pk)]

    def update(self,assignment,update,state,**extra):
        return commit_update(self.session(assignment).pk,assignment.pk,self.page["id"],{
            "type":"update","epoch":self.initial["epoch"],"client_id":str(uuid.uuid4()),"update":encode(update),"state":encode(state),**extra},"synthetic-connection")

    def test_concurrent_python_replicas_converge_without_overwriting_same_field(self):
        first=load_document(base64.b64decode(self.initial["update"]));second=load_document(base64.b64decode(self.initial["update"]))
        original=first.get_state()
        first["title"] += " / Alfa"
        second["title"] += " / Beta"
        self.update(self.alice,first.get_update(original),first.get_state())
        self.update(self.bob,second.get_update(original),second.get_state())
        page=ChannelPage.objects.get(pk=self.page["id"])
        self.assertIn("Alfa",page.title);self.assertIn("Beta",page.title)
        first.apply_update(second.get_update());second.apply_update(first.get_update())
        stored=load_document(PageCollaboration.objects.get(page=page).state)
        self.assertEqual(str(first["title"]),str(second["title"]))
        self.assertEqual(str(stored["title"]),str(first["title"]))
        self.assertEqual(page.channel.activity_version,0)

    def test_invalid_state_vector_is_rejected_without_changing_the_page(self):
        before=ChannelPage.objects.get(pk=self.page["id"]).version
        with self.assertRaises(APIException):
            synchronize(self.session(self.alice).pk,self.alice.pk,self.page["id"],{"epoch":self.initial["epoch"],"state":encode(b"\xff")})
        self.assertEqual(ChannelPage.objects.get(pk=self.page["id"]).version,before)

    def test_javascript_yjs_updates_merge_in_python_and_return_to_javascript(self):
        # Actual Yjs 13.6.27 from this repository, not a hand-written CRDT double.
        package=Path(__file__).resolve().parents[3]/"frontend/modulos/core/node_modules/yjs/dist/yjs.mjs"
        script='''import * as Y from "YJS"; let input=""; for await(const c of process.stdin)input+=c;
const seed=JSON.parse(input),a=new Y.Doc(),b=new Y.Doc();Y.applyUpdate(a,Buffer.from(seed.update,"base64"));Y.applyUpdate(b,Buffer.from(seed.update,"base64"));
const state=Y.encodeStateVector(a);a.getText("title").insert(0,"🚀 Alfa ");b.getText("title").insert(0,"β Beta ");
const heading="00000000-0000-4000-8000-000000000123";a.getMap("blocks").set(heading,new Y.Map([["type","heading"],["text",new Y.Text("Agenda")],["level",2]]));a.getArray("order").push([heading]);
const updates=[a,b].map(d=>({update:Buffer.from(Y.encodeStateAsUpdate(d,state)).toString("base64"),state:Buffer.from(Y.encodeStateVector(d)).toString("base64")}));
Y.applyUpdate(a,Y.encodeStateAsUpdate(b));Y.applyUpdate(b,Y.encodeStateAsUpdate(a));console.log(JSON.stringify({updates,title:a.getText("title").toString(),same:a.getText("title").toString()===b.getText("title").toString()}));'''.replace("YJS",package.as_uri())
        result=subprocess.run(["node","--input-type=module","-e",script],input=json.dumps({"update":self.initial["update"]}),encoding="utf-8",capture_output=True,timeout=20,check=True)
        fixture=json.loads(result.stdout)
        for assignment,update in zip((self.alice,self.bob),fixture["updates"]):
            self.update(assignment,base64.b64decode(update["update"]),base64.b64decode(update["state"]))
        self.assertTrue(fixture["same"])
        self.assertEqual(ChannelPage.objects.get(pk=self.page["id"]).title,fixture["title"])
        stored=ChannelPage.objects.get(pk=self.page["id"])
        self.assertEqual(stored.blocks[-1]["level"],2)
        self.assertIs(type(stored.blocks[-1]["level"]),int)
        back='''import * as Y from "YJS";let raw="";for await(const chunk of process.stdin)raw+=chunk;const d=new Y.Doc();Y.applyUpdate(d,Buffer.from(JSON.parse(raw).update,"base64"));console.log(JSON.stringify({title:d.getText("title").toString(),level:d.getMap("blocks").get("00000000-0000-4000-8000-000000000123").get("level")}));'''.replace("YJS",package.as_uri())
        roundtrip=subprocess.run(["node","--input-type=module","-e",back],input=json.dumps({"update":encode(bytes(PageCollaboration.objects.get(page=stored).state))}),encoding="utf-8",capture_output=True,timeout=20,check=True)
        self.assertEqual(json.loads(roundtrip.stdout),{"title":stored.title,"level":2})

    def test_invalid_update_rolls_back_document_and_receipt(self):
        doc=load_document(base64.b64decode(self.initial["update"]));state=doc.get_state()
        doc["meta"]["unsupported"]="not allowed"
        with self.assertRaises(APIException):self.update(self.alice,doc.get_update(state),doc.get_state())
        self.assertEqual(ChannelPage.objects.get(pk=self.page["id"]).version,1)
        self.assertEqual(PageUpdateReceipt.objects.count(),0)
        self.assertEqual(encode(bytes(PageCollaboration.objects.get().state)),self.initial["update"])

    def test_receipt_replay_does_not_create_duplicate_revision(self):
        doc=load_document(base64.b64decode(self.initial["update"]));state=doc.get_state();doc["title"] += " Una vez"
        token=str(uuid.uuid4());update=doc.get_update(state)
        self.update(self.alice,update,doc.get_state(),client_id=token)
        self.update(self.alice,update,doc.get_state(),client_id=token)
        self.assertEqual(ChannelPage.objects.get(pk=self.page["id"]).version,2)
        self.assertEqual(PageUpdateReceipt.objects.count(),1)

    def test_restoration_rotates_epoch_and_old_updates_cannot_resurrect_content(self):
        doc=load_document(base64.b64decode(self.initial["update"]));state=doc.get_state();doc["title"] += " Cambio"
        self.update(self.alice,doc.get_update(state),doc.get_state())
        result=self.client.patch(self.detail,{"client_id":str(uuid.uuid4()),"version":2,"restore_version":1},format="json")
        self.assertEqual(result.status_code,200,result.data)
        late=self.update(self.bob,doc.get_update(state),doc.get_state())
        self.assertEqual(late["type"],"reset_required")
        self.assertEqual(ChannelPage.objects.get(pk=self.page["id"]).title,self.page["title"])

    def test_access_denial_and_revoked_credentials_fail_closed(self):
        DepartmentChannel.objects.filter(pk=self.channel_id).update(visibility="private")
        for assignment in (self.bob,self.owner):
            with self.assertRaises(APIException):initial_state(self.session(assignment).pk,assignment.pk,self.page["id"])
        session=self.session(self.alice);session.revoked_at=timezone.now();session.save()
        with self.assertRaises(APIException):initial_state(session.pk,self.alice.pk,self.page["id"])
