import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from '../core/shared/crdt.js';
import {createPageApi} from './page_api.js';
import {documentContent} from './page_editor_model.js';
import {createCollaborativePage,writeSharedPage,readSharedPage,toBase64,fromBase64} from './page_collab_model.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;

test('page link routes retain source, query and cursor context',async()=>{
    const calls=[],api=createPageApi({request:async(...args)=>{calls.push(args);return {};}}),root=`/api/v2/messaging/channels/${id(1)}/pages/${id(2)}/`;
    await api.linkOptions(id(1),id(2),'Manual & proceso',root+'link-options/?q=Manual+%26+proceso&cursor=next',{signal:'active'});
    assert.equal(calls[0][0],root+'link-options/?q=Manual+%26+proceso&cursor=next');assert.equal(calls[0][1].signal,'active');
    assert.throws(()=>api.linkOptions(id(1),id(2),'Otro',root+'link-options/?q=Manual&cursor=next'));
    assert.throws(()=>api.linkOptions(id(1),id(2),'x'.repeat(81)));
    assert.throws(()=>api.backlinks(id(1),'../outside'));
    assert.throws(()=>api.backlinks(id(1),id(2),root+'link-options/?cursor=next'));
    await api.backlinks(id(1),id(2),root+'backlinks/?cursor=next');assert.equal(calls.at(-1)[0],root+'backlinks/?cursor=next');
});

test('page projections stay outside REST content, CRDT state and recovery metadata',async()=>{
    const page={id:id(1),title:'Guía',icon:'note',version:1,can_edit:true,blocks:[{id:id(2),type:'page',page_id:id(3),text:'',
        page:{available:true,id:id(3),channel_id:id(4),channel_name:'Canal reservado',title:'Título confidencial'}}]};
    const refs=new Map(),doc=new Y.Doc();writeSharedPage(doc,page,{references:refs});
    assert.equal(refs.get(id(2)),id(3));
    const shared=JSON.stringify(doc.toJSON()),rest=JSON.stringify(documentContent(page));
    for(const hidden of [id(3),id(4),'Canal reservado','Título confidencial'])assert.equal(shared.includes(hidden),false);
    assert.equal(rest.includes('Título confidencial'),false);assert.equal(rest.includes('Canal reservado'),false);
    assert.equal(readSharedPage(doc).blocks[0].page_id,undefined);assert.equal(readSharedPage(doc,refs).blocks[0].page_id,id(3));
    let socket,model;const sent=[];
    const editor=createCollaborativePage({page,delay:100000,onChange:value=>model=value,connect:async()=>socket={readyState:1,send:raw=>sent.push(JSON.parse(raw)),close(){this.readyState=3;}}});
    const deliver=packet=>socket.onmessage({data:JSON.stringify(packet)});
    try{
        while(!socket?.onmessage)await new Promise(resolve=>setTimeout(resolve,5));
        deliver({type:'sync',epoch:'epoch',update:toBase64(Y.encodeStateAsUpdate(doc)),state:toBase64(Y.encodeStateVector(doc)),page});
        editor.edit({...model.draft,title:'Guía propia'});editor.flush();
        assert.equal(sent.at(-1).references[id(2)],id(3));
        assert.equal(model.base.blocks[0].page.title,'Título confidencial');
        const snapshot=editor.recoverySnapshot(),replica=new Y.Doc();Y.applyUpdate(replica,fromBase64(snapshot.update));
        assert.equal(JSON.stringify(replica.toJSON()).includes(id(3)),false);
        assert.equal(JSON.stringify(snapshot).includes('Título confidencial'),false);replica.destroy();
        deliver({type:'sync_delta',epoch:'epoch',version:1,tasks:[{id:id(2),type:'page',text:'',page:{available:false}}]});
        assert.equal(model.base.blocks[0].page.available,false);assert.equal(model.draft.blocks[0].page_id,undefined);
        editor.edit({...model.draft,blocks:[]});editor.undo();
        assert.equal(model.draft.blocks[0].page_id,undefined,'undo cannot restore a reference hidden by fresh authorization');
    }finally{editor.dispose();doc.destroy();}
});

test('undo and redo restore a known page reference without serializing its identifier',async()=>{
    const page={id:id(1),title:'Guía',icon:'note',version:1,can_edit:true,blocks:[{id:id(2),type:'page',page_id:id(3),text:'Consultar proceso',page:{available:true,id:id(3),title:'Proceso'}}]};
    const doc=new Y.Doc();writeSharedPage(doc,page);let socket,model;
    const editor=createCollaborativePage({page,delay:100000,onChange:value=>model=value,connect:async()=>socket={readyState:1,send(){},close(){this.readyState=3;}}});
    try{
        while(!socket?.onmessage)await new Promise(resolve=>setTimeout(resolve,5));
        socket.onmessage({data:JSON.stringify({type:'sync',epoch:'epoch',update:toBase64(Y.encodeStateAsUpdate(doc)),state:toBase64(Y.encodeStateVector(doc)),page})});
        editor.edit({...model.draft,blocks:[]});editor.undo();assert.equal(model.draft.blocks[0].page_id,id(3));assert.equal(model.draft.blocks[0].text,'Consultar proceso');
        editor.redo();assert.equal(model.draft.blocks.length,0);
    }finally{editor.dispose();doc.destroy();}
});
