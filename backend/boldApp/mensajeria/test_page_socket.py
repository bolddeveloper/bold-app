import base64
import uuid
from asgiref.sync import async_to_sync
from channels.db import database_sync_to_async
from channels.layers import get_channel_layer
from channels.testing import WebsocketCommunicator
from django.test import TransactionTestCase,RequestFactory,override_settings
from boldApp.autenticacion.services import create_session,issue_ws_ticket
from boldApp.core.models import Permission
from config.asgi import application
from . import test_channels as base
from .models import ChannelPage,ChannelAccessRule,DepartmentChannel
from .page_crdt import encode,load_document


@override_settings(MESSAGING_PILOT_ENABLED=False,CORS_ALLOWED_ORIGINS=["http://localhost:5174"],CHANNEL_LAYERS={"default":{"BACKEND":"channels.layers.InMemoryChannelLayer"}})
class PageSocketTests(TransactionTestCase):
    root=base.DepartmentChannelTests.root
    identity=base.DepartmentChannelTests.identity
    as_person=base.DepartmentChannelTests.as_person

    def setUp(self):
        for resource,actions in (("channel",("read","create","manage","access")),("page",("read","create","update","manage"))):
            for action in actions:
                Permission.objects.get_or_create(code=f"slack.{resource}.{action}",defaults={"module_code":"slack","resource":resource,"action":action,"risk_level":"low"})
        base.DepartmentChannelTests.setUp(self)
        result=self.client.post(self.url+"pages/",{"client_id":str(uuid.uuid4()),"title":"Coedición real"},format="json")
        self.assertEqual(result.status_code,201,result.data)
        self.page_id=result.data["id"]
        self.sessions={}
        for assignment in (self.alice,self.bob):
            _,session=create_session(assignment.employee.user_account,RequestFactory().get("/",REMOTE_ADDR="127.0.0.1"))
            self.sessions[str(assignment.pk)]=session

    def path(self,assignment):
        token=issue_ws_ticket(assignment.employee.user_account,self.sessions[str(assignment.pk)],assignment.pk,self.page_id,"slack_pages")
        return f"/ws/pages/{self.page_id}/?ticket={token}"

    async def packet(self,socket,wanted):
        transfers={}
        for _ in range(120):
            result=await socket.receive_json_from(timeout=4)
            if result["type"]=="transfer.start":
                transfers[result["id"]]={"packet":result["packet"],"parts":result["parts"],"chunks":[]};continue
            if result["type"]=="transfer.chunk":
                transfer=transfers[result["id"]];self.assertEqual(result["index"],len(transfer["chunks"]));transfer["chunks"].append(result["data"]);continue
            if result["type"]=="transfer.end":
                transfer=transfers.pop(result["id"]);self.assertEqual(len(transfer["chunks"]),transfer["parts"]);result={**transfer["packet"],"update":"".join(transfer["chunks"])}
            if result["type"]==wanted:return result
        self.fail(f"No {wanted} packet received")

    def test_two_authenticated_sockets_merge_and_tickets_cannot_be_replayed(self):
        first_path,second_path=self.path(self.alice),self.path(self.bob)
        async def scenario():
            first=WebsocketCommunicator(application,first_path,headers=[(b"origin",b"http://localhost:5174")])
            second=WebsocketCommunicator(application,second_path,headers=[(b"origin",b"http://localhost:5174")])
            self.assertTrue((await first.connect())[0]);one=await self.packet(first,"sync")
            self.assertIsInstance(one["page"]["updated_at"],str)
            self.assertTrue((await second.connect())[0]);two=await self.packet(second,"sync")
            a=load_document(base64.b64decode(one["update"]));b=load_document(base64.b64decode(two["update"]));state=a.get_state()
            a["title"] += " / Alfa";b["title"] += " / Beta"
            for socket,doc,snapshot in ((first,a,one),(second,b,two)):
                await socket.send_json_to({"type":"update","epoch":snapshot["epoch"],"client_id":str(uuid.uuid4()),"update":encode(doc.get_update(state)),"state":encode(doc.get_state())})
                ack=await self.packet(socket,"ack");doc.apply_update(base64.b64decode(ack["update"]))
            remote=await self.packet(first,"update");a.apply_update(base64.b64decode(remote["update"]))
            self.assertEqual(str(a["title"]),str(b["title"]))
            self.assertIn("Alfa",str(a["title"]));self.assertIn("Beta",str(a["title"]))
            replay=WebsocketCommunicator(application,first_path,headers=[(b"origin",b"http://localhost:5174")])
            self.assertFalse((await replay.connect())[0]);await replay.disconnect()
            await first.disconnect();await second.disconnect()
        async_to_sync(scenario)()
        self.assertEqual(ChannelPage.objects.get(pk=self.page_id).version,3)

    def test_revocation_removes_a_connected_private_channel_reader(self):
        DepartmentChannel.objects.filter(pk=self.channel_id).update(visibility="private")
        rule=ChannelAccessRule.objects.create(channel_id=self.channel_id,employee=self.bob.employee,access="read")
        path=self.path(self.bob)
        async def scenario():
            socket=WebsocketCommunicator(application,path,headers=[(b"origin",b"http://localhost:5174")])
            self.assertTrue((await socket.connect())[0]);snapshot=await self.packet(socket,"sync");self.assertFalse(snapshot["page"]["can_edit"])
            await database_sync_to_async(lambda:ChannelAccessRule.objects.filter(pk=rule.pk).delete())()
            await get_channel_layer().group_send("permission_watch",{"type":"permission.changed"})
            self.assertEqual((await self.packet(socket,"revoked"))["type"],"revoked")
            self.assertEqual((await socket.receive_output())["code"],4403)
            await socket.disconnect()
        async_to_sync(scenario)()

    def test_large_initial_state_is_chunked_and_bad_origins_cannot_use_tickets(self):
        blocks=[{"id":str(uuid.uuid4()),"type":"paragraph","text":"contenido "*300} for _ in range(22)]
        ChannelPage.objects.filter(pk=self.page_id).update(blocks=blocks)
        path=self.path(self.alice)
        async def scenario():
            bad=WebsocketCommunicator(application,path,headers=[(b"origin",b"https://untrusted.invalid")])
            self.assertFalse((await bad.connect())[0]);await bad.disconnect()
            socket=WebsocketCommunicator(application,path,headers=[(b"origin",b"http://localhost:5174")])
            self.assertTrue((await socket.connect())[0]);snapshot=await self.packet(socket,"sync")
            self.assertGreater(len(snapshot["update"]),60000)
            doc=load_document(base64.b64decode(snapshot["update"]));self.assertEqual(len(doc["blocks"]),22)
            await socket.disconnect()
        async_to_sync(scenario)()
