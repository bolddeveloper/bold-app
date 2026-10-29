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

test('verified page mentions converge without stale ACK rollback or serialization into Yjs',async()=>{
    const doc=new Y.Doc();writeSharedPage(doc,fixture);let socket,model;
    const mention={employee_id:'synthetic-person',token:'@person@bold.gt',name:'Identidad verificada'};
    const editor=createCollaborativePage({page:fixture,delay:100000,onChange:value=>model=value,connect:async()=>socket={readyState:1,send(){},close(){this.readyState=3;}}});
    const deliver=packet=>socket.onmessage({data:JSON.stringify(packet)});
    try{
        await waitFor(()=>socket?.onmessage);
        deliver({type:'sync',epoch:'epoch',update:toBase64(Y.encodeStateAsUpdate(doc)),state:toBase64(Y.encodeStateVector(doc)),page:{...fixture,version:5,mentions:[]}});
        editor.edit({...model.draft,blocks:[{...model.draft.blocks[0],text:'Texto propio @person@bold.gt'}]});
        deliver({type:'update',epoch:'epoch',version:7,mentions:[mention]});assert.deepEqual(model.base.mentions,[mention]);
        deliver({type:'ack',epoch:'epoch',version:6,client_id:'old',state:toBase64(Y.encodeStateVector(doc)),mentions:[]});
        assert.deepEqual(model.base.mentions,[mention],'an old acknowledgement cannot erase newer verified references');
        assert.match(model.draft.blocks[0].text,/Texto propio/);
        const recovery=editor.recoverySnapshot(),replica=new Y.Doc();Y.applyUpdate(replica,fromBase64(recovery.update));
        assert.equal(JSON.stringify(replica.toJSON()).includes(mention.name),false,'server identity metadata stays out of shared state');replica.destroy();
        deliver({type:'sync_delta',epoch:'epoch',version:8,state:toBase64(Y.encodeStateVector(doc)),mentions:[]});assert.deepEqual(model.base.mentions,[]);
        assert.match(model.draft.blocks[0].text,/Texto propio/);
    }finally{editor.dispose();doc.destroy();}
});

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

test('message origins refresh as personal metadata without entering the shared document',async()=>{
    const server=room(),alice=client(server,'Alice');
    const source='00000000-0000-4000-8000-000000000987';
    try{
        await ready(alice);
        const original=structuredClone(alice.state.draft);
        alice.editor.remote({...fixture,message_origins:[{id:source,block_ids:[blockId],target:{kind:'chat',message_id:source}}]});
        assert.equal(alice.state.base.message_origins[0].id,source);
        assert.deepEqual(alice.state.draft,original);assert.equal(JSON.stringify(server.content()).includes(source),false);
        alice.editor.remote({...fixture,message_origins:[]});
        assert.deepEqual(alice.state.base.message_origins,[]);assert.equal(alice.state.dirty,false);
    }finally{alice.editor.dispose();server.dispose();}
});
test("a remotely deleted block keeps the other author's unfinished text recoverable",async()=>{
    const server=room(),alice=client(server,"Alice"),bob=client(server,"Bob");
    try{await ready(alice,bob);alice.editor.edit({...alice.state.draft,blocks:[{...alice.state.draft.blocks[0],text:"Mi texto aún no confirmado"}]});bob.editor.edit({...bob.state.draft,blocks:[]});bob.editor.flush();await waitFor(()=>alice.state.recoveredBlocks.length===1);assert.equal(alice.state.draft.blocks.length,0);assert.equal(alice.state.recoveredBlocks[0].text,"Mi texto aún no confirmado");alice.editor.recoverBlocks();alice.editor.flush();await waitFor(()=>!alice.state.dirty);assert.equal(server.content().blocks[0].text,"Mi texto aún no confirmado");assert.notEqual(server.content().blocks[0].id,blockId);}finally{alice.editor.dispose();bob.editor.dispose();server.dispose();}
});

test("undo and redo affect only the author's operations, retaining concurrent remote text",async()=>{
    const server=room(),alice=client(server,"Alice"),bob=client(server,"Bob");
    try{await ready(alice,bob);assert.equal(alice.state.canUndo,false);server.hold();alice.editor.edit({...alice.state.draft,title:"A Guía"});bob.editor.edit({...bob.state.draft,title:"B Guía"});alice.editor.flush();bob.editor.flush();server.release();await waitFor(()=>!alice.state.dirty && !bob.state.dirty);assert.match(alice.state.draft.title,/A /);assert.match(alice.state.draft.title,/B /);alice.editor.undo();assert.doesNotMatch(alice.state.draft.title,/A /);assert.match(alice.state.draft.title,/B /);assert.equal(alice.state.canRedo,true);alice.editor.flush();await ready(alice,bob);assert.equal(bob.state.draft.title,"B Guía");alice.editor.redo();alice.editor.flush();await ready(alice,bob);assert.match(bob.state.draft.title,/A /);assert.match(bob.state.draft.title,/B /);}finally{alice.editor.dispose();bob.editor.dispose();server.dispose();}
});

test("remote-only changes are not undoable and epoch restoration clears personal history",async()=>{
    const server=room(),alice=client(server,"Alice"),bob=client(server,"Bob");
    try{await ready(alice,bob);bob.editor.edit({...bob.state.draft,title:"De Bob"});bob.editor.flush();await waitFor(()=>alice.state.draft.title==="De Bob" && !bob.state.dirty);assert.equal(alice.state.canUndo,false);alice.editor.undo();assert.equal(alice.state.draft.title,"De Bob");alice.editor.edit({...alice.state.draft,title:"De Alice"});assert.equal(alice.state.canUndo,true);server.reset("Restaurada");await waitFor(()=>!!alice.state.conflict);assert.equal(alice.state.canUndo,false);alice.editor.resolve(false);assert.equal(alice.state.canUndo,false);assert.equal(alice.state.canRedo,false);alice.editor.undo();assert.equal(alice.state.draft.title,"Restaurada");}finally{alice.editor.dispose();bob.editor.dispose();server.dispose();}
});

test("structural operations undo separately and IME guards undo until composition finishes",async()=>{
    const server=room(),alice=client(server,"Alice");
    try{await ready(alice);alice.editor.edit({...alice.state.draft,title:"Mi título"});alice.editor.edit({...alice.state.draft,blocks:[]});alice.editor.undo();assert.equal(alice.state.draft.title,"Mi título");assert.equal(alice.state.draft.blocks[0].text,"Texto inicial");alice.editor.beginComposition("title");assert.equal(alice.state.canUndo,false);alice.editor.undo();assert.equal(alice.state.draft.title,"Mi título");alice.editor.endComposition("title","Mi título 漢字");alice.editor.undo();assert.equal(alice.state.draft.title,"Mi título");alice.editor.undo();assert.equal(alice.state.draft.title,"Guía");}finally{alice.editor.dispose();server.dispose();}
});

test("undo after a lost acknowledgement retries the exact pending operation before saving the inverse",async()=>{
    const server=room(),alice=client(server,"Alice");
    try{await ready(alice);server.drop(true);alice.editor.edit({...alice.state.draft,title:"Temporal"});alice.editor.flush();alice.editor.undo();assert.equal(alice.state.draft.title,"Guía");server.disconnect();server.drop(false);alice.editor.retry();await waitFor(()=>!alice.state.pending && alice.state.status!=="connecting");alice.editor.flush();await ready(alice);assert.equal(server.content().title,"Guía");}finally{alice.editor.dispose();server.dispose();}
});

test("reloaded CRDT draft merges with later server text rather than replacing it",async()=>{
    const server=room(),alice=client(server,"Alice"),bob=client(server,"Bob");let reopened;
    try{await ready(alice,bob);alice.editor.edit({...alice.state.draft,title:"A Guía"});const snapshot=alice.editor.recoverySnapshot();alice.editor.dispose();bob.editor.edit({...bob.state.draft,title:"B Guía"});bob.editor.flush();await ready(bob);reopened=client(server,"Alice");await ready(reopened);assert.equal(reopened.editor.recoverSnapshot(snapshot),true);assert.match(reopened.state.draft.title,/A /);assert.match(reopened.state.draft.title,/B /);reopened.editor.flush();await ready(reopened,bob);assert.equal(reopened.state.draft.title,bob.state.draft.title);}finally{alice.editor.dispose();bob.editor.dispose();reopened?.editor.dispose();server.dispose();}
});

test("recovery after reload preserves a lost ACK and later unsent changes",async()=>{
    const server=room(),alice=client(server,"Alice");let reopened;
    try{await ready(alice);server.drop(true);alice.editor.edit({...alice.state.draft,title:"Confirmado sin ACK"});alice.editor.flush();alice.editor.edit({...alice.state.draft,title:"Confirmado sin ACK y borrador"});const snapshot=alice.editor.recoverySnapshot();alice.editor.dispose();server.drop(false);reopened=client(server,"Alice");await ready(reopened);reopened.editor.recoverSnapshot(snapshot);await waitFor(()=>!reopened.state.pending);reopened.editor.flush();await ready(reopened);assert.equal(server.content().title,"Confirmado sin ACK y borrador");}finally{alice.editor.dispose();reopened?.editor.dispose();server.dispose();}
});

test("old-epoch recovery requires a choice and unfinished IME survives reload",async()=>{
    const server=room(),alice=client(server,"Alice");let reopened;
    try{await ready(alice);alice.editor.beginComposition("title");alice.editor.edit({...alice.state.draft,title:"Guía 漢字"});const snapshot=alice.editor.recoverySnapshot();alice.editor.dispose();server.reset("Restaurada");reopened=client(server,"Alice");await ready(reopened);reopened.editor.recoverSnapshot(snapshot);assert.equal(reopened.state.status,"conflict");assert.equal(reopened.state.draft.title,"Guía 漢字");assert.equal(server.content().title,"Restaurada");reopened.editor.resolve(false);assert.equal(reopened.state.draft.title,"Restaurada");}finally{alice.editor.dispose();reopened?.editor.dispose();server.dispose();}
});

test("read-only refresh blocks undo, redo and recovery without generating writes",async()=>{
    const server=room(),alice=client(server,"Alice");
    try{await ready(alice);alice.editor.edit({...alice.state.draft,title:"Propio"});const snapshot=alice.editor.recoverySnapshot();alice.editor.remote({...alice.state.base,can_edit:false});assert.equal(alice.state.canUndo,false);assert.equal(alice.state.canRedo,false);alice.editor.undo();alice.editor.redo();alice.editor.flush();assert.equal(alice.state.draft.title,"Propio");assert.equal(alice.editor.recoverSnapshot(snapshot),false);assert.equal(server.operations(),0);}finally{alice.editor.dispose();server.dispose();}
});

test("undo restores a removed task reference without putting protected identifiers in shared data",async()=>{
    const server=room(),alice=client(server,"Alice"),taskId="00000000-0000-4000-8000-000000000099";
    try{await ready(alice);alice.editor.edit({...alice.state.draft,blocks:[...alice.state.draft.blocks,{id:"task-block",type:"task",task_id:taskId}]});alice.editor.edit({...alice.state.draft,blocks:alice.state.draft.blocks.filter(row=>row.type!=="task")});alice.editor.undo();assert.equal(alice.state.draft.blocks.find(row=>row.type==="task").task_id,taskId);const doc=new Y.Doc();Y.applyUpdate(doc,fromBase64(alice.editor.recoverySnapshot().update));assert.equal(JSON.stringify(doc.toJSON()).includes(taskId),false);doc.destroy();}finally{alice.editor.dispose();server.dispose();}
});
