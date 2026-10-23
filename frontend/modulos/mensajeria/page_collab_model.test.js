import test from "node:test";
import assert from "node:assert/strict";
import * as Y from "../core/shared/crdt.js";
import {createCollaborativePage,writeSharedPage,readSharedPage,toBase64,fromBase64,textSplice} from "./page_collab_model.js";
const pageId="00000000-0000-4000-8000-000000000001",blockId="00000000-0000-4000-8000-000000000002";
const fixture={id:pageId,title:"Guía",icon:"note",blocks:[{id:blockId,type:"paragraph",text:"Texto inicial"}],version:1,can_edit:true,can_manage:true,updated_at:new Date().toISOString(),updated_by:"Prueba"};
const wait=()=>new Promise(resolve=>setTimeout(resolve,25));
async function waitFor(predicate){const until=Date.now()+4000;while(!predicate() && Date.now()<until)await wait();assert.ok(predicate(),"expected acknowledged collaboration state");}
function room(){
    let doc=new Y.Doc(),version=1,epoch="00000000-0000-4000-8000-000000000009",count=0,hold=false,drop=false,queue=[],sockets=[],operations=0;
    writeSharedPage(doc,fixture);
    function deliver(socket,packet){const action=()=>{if(socket.readyState===1)socket.onmessage?.({data:JSON.stringify(packet)});};if(hold)queue.push(action);else setTimeout(action,0);}
    function snapshot(){return {type:"sync",epoch,update:toBase64(Y.encodeStateAsUpdate(doc)),state:toBase64(Y.encodeStateVector(doc)),page:{...fixture,...readSharedPage(doc),version},self:{employee_id:"synthetic"}};}
    function connect(name){
        const connection=String(++count),socket={readyState:1,close(code=1006){this.readyState=3;this.onclose?.({code});},send(raw){
            const packet=JSON.parse(raw);
            if(packet.type==="update"){
                operations++;const before=toBase64(Y.encodeStateAsUpdate(doc));Y.applyUpdate(doc,fromBase64(packet.update));if(before!==toBase64(Y.encodeStateAsUpdate(doc)))version++;
                if(!drop)deliver(socket,{type:"ack",client_id:packet.client_id,epoch,version,update:toBase64(Y.encodeStateAsUpdate(doc,fromBase64(packet.state))),state:toBase64(Y.encodeStateVector(doc)),tasks:[]});
                for(const other of sockets)if(other!==socket)deliver(other,{type:"update",epoch,version,update:packet.update,can_edit:true});
            }else if(packet.type==="presence"){
                for(const other of sockets)if(other!==socket)deliver(other,{type:"presence",connection,person:{employee_id:name,name},selection:packet.selection});
            }else if(["sync","ping"].includes(packet.type))deliver(socket,{...snapshot(),connection});
        }};
        sockets.push(socket);setTimeout(()=>deliver(socket,{...snapshot(),connection}),0);return Promise.resolve(socket);
    }
    return {connect,content:()=>readSharedPage(doc),operations:()=>operations,hold(){hold=true;},release(){hold=false;for(const action of queue.splice(0))action();},drop(value){drop=value;},disconnect(){for(const socket of sockets)if(socket.readyState===1)socket.close();},reset(title){doc.destroy();doc=new Y.Doc();writeSharedPage(doc,{...fixture,title});epoch="00000000-0000-4000-8000-000000000010";version++;for(const socket of sockets)deliver(socket,snapshot());},dispose(){for(const socket of sockets)socket.readyState=3;doc.destroy();}};
}
function client(server,name){let state;const editor=createCollaborativePage({page:fixture,connect:()=>server.connect(name),onChange:value=>state=value,delay:100000});return {editor,get state(){return state;}};}
const ready=(...clients)=>waitFor(()=>clients.every(client=>client.state.status==="saved"));

test("coediting merges simultaneous changes in the same text without document replacement",async()=>{
    const server=room(),alice=client(server,"Alice"),bob=client(server,"Bob");
    try{await waitFor(()=>alice.state.status==="saved" && bob.state.status==="saved");server.hold();alice.editor.edit({...alice.state.draft,title:"🚀 Guía"});bob.editor.edit({...bob.state.draft,title:"β Guía"});alice.editor.flush();bob.editor.flush();server.release();await waitFor(()=>!alice.state.dirty && !bob.state.dirty);assert.match(alice.state.draft.title,/🚀/);assert.match(alice.state.draft.title,/β/);assert.equal(alice.state.draft.title,bob.state.draft.title);assert.equal(alice.state.base.title,alice.state.draft.title);assert.equal(bob.state.base.title,bob.state.draft.title);assert.equal(alice.state.dirty,false);assert.equal(bob.state.dirty,false);}finally{alice.editor.dispose();bob.editor.dispose();server.dispose();}
});
test("delete-only edits are persisted, no-op edits never create requests",async()=>{
    const server=room(),alice=client(server,"Alice");try{await ready(alice);alice.editor.edit(alice.state.draft);alice.editor.flush();assert.equal(server.operations(),0);alice.editor.edit({...alice.state.draft,title:"Gu"});assert.equal(alice.state.dirty,true);alice.editor.flush();await waitFor(()=>!alice.state.dirty);assert.equal(server.content().title,"Gu");assert.equal(alice.state.dirty,false);}finally{alice.editor.dispose();server.dispose();}
});
test("lost acknowledgements and further offline edits resume without duplication",async()=>{
    const server=room(),alice=client(server,"Alice");try{await ready(alice);server.drop(true);alice.editor.edit({...alice.state.draft,title:"Guía / uno"});alice.editor.flush();await waitFor(()=>server.content().title==="Guía / uno");server.disconnect();alice.editor.edit({...alice.state.draft,title:"Guía / uno / dos"});server.drop(false);alice.editor.retry();await waitFor(()=>!alice.state.pending && alice.state.status!=="connecting");alice.editor.flush();await waitFor(()=>!alice.state.dirty);assert.equal(server.content().title,"Guía / uno / dos");assert.equal(alice.state.dirty,false);}finally{alice.editor.dispose();server.dispose();}
});
test("restoring history freezes an old-epoch draft until an explicit choice",async()=>{
    const server=room(),alice=client(server,"Alice");try{await ready(alice);alice.editor.edit({...alice.state.draft,title:"Mi borrador"});server.reset("Versión recuperada");await waitFor(()=>alice.state.status==="conflict");assert.equal(alice.state.draft.title,"Mi borrador");assert.equal(server.content().title,"Versión recuperada");const recovered=alice.editor.resolve(false);assert.equal(recovered.title,"Mi borrador");assert.equal(alice.state.draft.title,"Versión recuperada");assert.equal(alice.state.dirty,false);}finally{alice.editor.dispose();server.dispose();}
});
test("relative selections follow remote insertions and presence is derived from the room",async()=>{
    const server=room(),alice=client(server,"Alice"),bob=client(server,"Bob");try{await ready(alice,bob);const bookmark=alice.editor.bookmark("title",2,3);bob.editor.edit({...bob.state.draft,title:"XXGuía"});bob.editor.flush();await waitFor(()=>alice.state.draft.title==="XXGuía" && !bob.state.dirty);assert.deepEqual(alice.editor.resolveRange(bookmark),{field:"title",start:4,end:5});bob.editor.select("title",1,2);await waitFor(()=>alice.state.peers.length===1);assert.equal(alice.state.peers[0].person.name,"Bob");assert.equal(alice.state.peers[0].range.field,"title");}finally{alice.editor.dispose();bob.editor.dispose();server.dispose();}
});
test("IME composition keeps its draft while remote text is merged",async()=>{
    const server=room(),alice=client(server,"Alice"),bob=client(server,"Bob");try{await ready(alice,bob);alice.editor.beginComposition("title");alice.editor.edit({...alice.state.draft,title:"Guía 漢字"});assert.equal(alice.state.dirty,true);bob.editor.edit({...bob.state.draft,title:"🚀 Guía"});bob.editor.flush();await waitFor(()=>!bob.state.dirty);assert.equal(alice.state.draft.title,"Guía 漢字");alice.editor.endComposition("title","Guía 漢字");alice.editor.flush();await waitFor(()=>!alice.state.dirty && alice.state.draft.title===bob.state.draft.title);assert.match(server.content().title,/🚀/);assert.match(server.content().title,/漢字/);assert.equal(alice.state.draft.title,bob.state.draft.title);}finally{alice.editor.dispose();bob.editor.dispose();server.dispose();}
});
test("shared task blocks never serialize protected task identifiers",()=>{
    const doc=new Y.Doc(),refs=new Map(),taskId="00000000-0000-4000-8000-000000000099";
    writeSharedPage(doc,{...fixture,blocks:[{id:blockId,type:"task",task_id:taskId}]},{references:refs});
    assert.equal(JSON.stringify(doc.toJSON()).includes(taskId),false);assert.equal(refs.get(blockId),taskId);doc.destroy();
    assert.deepEqual(textSplice("A🚀B","AβB"),{start:1,remove:2,insert:"β"});
});
test("a remotely deleted block keeps the other author's unfinished text recoverable",async()=>{
    const server=room(),alice=client(server,"Alice"),bob=client(server,"Bob");
    try{await ready(alice,bob);alice.editor.edit({...alice.state.draft,blocks:[{...alice.state.draft.blocks[0],text:"Mi texto aún no confirmado"}]});bob.editor.edit({...bob.state.draft,blocks:[]});bob.editor.flush();await waitFor(()=>alice.state.recoveredBlocks.length===1);assert.equal(alice.state.draft.blocks.length,0);assert.equal(alice.state.recoveredBlocks[0].text,"Mi texto aún no confirmado");alice.editor.recoverBlocks();alice.editor.flush();await waitFor(()=>!alice.state.dirty);assert.equal(server.content().blocks[0].text,"Mi texto aún no confirmado");assert.notEqual(server.content().blocks[0].id,blockId);}finally{alice.editor.dispose();bob.editor.dispose();server.dispose();}
});
