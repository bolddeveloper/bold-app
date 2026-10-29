import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from '../core/shared/crdt.js';
import {normalizeFormats,applyFormats,safePageHref,formattedSegments,replaceFormattedText,rebaseFormats,formatsFromDelta} from './page_formats.js';
import {createCollaborativePage,readSharedPage,writeSharedPage,toBase64,fromBase64} from './page_collab_model.js';
import {createTemplateApi} from './page_template_api.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;

test('process catalog is an explicit authenticated template allowlist, not a task factory',async()=>{
    const calls=[],api=createTemplateApi({request:async(...args)=>calls.push(args)});
    for(const name of ['process','delivery','handoff']){await api.get(id(1),'builtin-'+name);await api.instantiate(id(1),'builtin-'+name,id(2));assert.equal(calls.at(-1)[1].body.client_id,id(2));}
    assert.throws(()=>api.get(id(1),'builtin-any-script'));
});

test('format contract is bounded, Unicode-safe, disjoint and rejects active attributes or credential links',()=>{
    const text='😀 Acuerdo';
    assert.throws(()=>normalizeFormats(text,[{start:0,end:1,bold:true}]));
    assert.throws(()=>normalizeFormats(text,[{start:0,end:2,onclick:'x'}]));
    assert.throws(()=>normalizeFormats(text,[{start:0,end:2,bold:false}]));
    assert.throws(()=>normalizeFormats(text,[{start:0,end:3,bold:true},{start:2,end:4,italic:true}]));
    for(const href of ['javascript:alert(1)','data:text/html,x','https://user:pass@example.com','https://@example.com','https://exa mple.com','https://example.com\\evil'])assert.throws(()=>safePageHref(href));
    assert.equal(safePageHref('https://bold.gt/proceso?paso=2'),'https://bold.gt/proceso?paso=2');
    assert.deepEqual(normalizeFormats(text,[{start:0,end:2,bold:true},{start:2,end:3,bold:true}]),[{start:0,end:3,bold:true}]);
});

test('format actions split and coalesce attributes; alias replacement preserves outside text and Unicode',()=>{
    const text='😀 Leer proceso final';
    const bold=applyFormats(text,[],3,15,{bold:true}),mixed=applyFormats(text,bold,8,15,{italic:true,href:'https://bold.gt'});
    assert.equal(formattedSegments(text,mixed).find(row=>row.start===8).attrs.bold,true);
    const alias=replaceFormattedText(text,mixed,8,15,'guía',{href:'https://bold.gt'});
    assert.equal(alias.text,'😀 Leer guía final');assert.equal(alias.formats.at(-1).href,'https://bold.gt');
    assert.equal(rebaseFormats('Hola',[{start:0,end:4,bold:true}],'Hola!')[0].end,4);
    assert.throws(()=>applyFormats(text,[],0,1,{bold:true}));
    assert.throws(()=>applyFormats(text,[],3,3,{bold:true}));
    assert.throws(()=>replaceFormattedText(text,[],0,0,'x'.repeat(4001),{}));
});

test('an over-limit merged local draft remains readable and can remove formatting before retry',()=>{
    const delta=Array.from({length:201},(_,index)=>({insert:'x',attributes:index%2 ? {bold:true}:{italic:true}}));
    const formats=formatsFromDelta(delta),text='x'.repeat(201);
    assert.equal(formats.length,201);assert.equal(formattedSegments(text,formats).length,201);
    assert.throws(()=>normalizeFormats(text,formats));
    assert.deepEqual(applyFormats(text,formats,0,201,{bold:null,italic:null}),[]);
});

test('Yjs seed and reads preserve real attributes and code language, without source markup',()=>{
    const page={title:'Guía',icon:'note',blocks:[{id:id(1),type:'paragraph',text:'😀 texto',formats:[{start:3,end:8,bold:true,href:'https://bold.gt'}]},
        {id:id(2),type:'code',text:'<script>literal</script>',language:'html'}]};
    const doc=new Y.Doc();try{
        writeSharedPage(doc,page);assert.deepEqual(readSharedPage(doc),page);
        const shared=doc.getMap('blocks').get(id(1));assert.equal(shared.has('formats'),false);assert.ok(shared.get('text').toDelta().some(row=>row.attributes?.bold));
        writeSharedPage(doc,{...page,blocks:[{...page.blocks[0],text:'😀 texto nuevo'},page.blocks[1]]});
        assert.equal(readSharedPage(doc).blocks[0].formats[0].bold,true,'ordinary text edits do not clear remote styles');
    }finally{doc.destroy();}
});

test('bookmarked formatting merges a peer edit, owns its undo and preserves recovery attributes',async()=>{
    const page={id:id(2),title:'Guía',icon:'note',version:1,can_edit:true,blocks:[{id:id(1),type:'paragraph',text:'Acuerdo final'}]};
    const remote=new Y.Doc();writeSharedPage(remote,page);let socket,model;
    const editor=createCollaborativePage({page,delay:100000,onChange:value=>model=value,connect:async()=>socket={readyState:1,send(){},close(){this.readyState=3;}}});
    const deliver=packet=>socket.onmessage({data:JSON.stringify(packet)});
    try{
        while(!socket?.onmessage)await new Promise(resolve=>setTimeout(resolve,5));
        deliver({type:'sync',epoch:'epoch',update:toBase64(Y.encodeStateAsUpdate(remote)),state:toBase64(Y.encodeStateVector(remote)),page});
        editor.applyTextFormat(editor.bookmark(id(1),0,7),{italic:null});assert.equal(model.status,'saved');assert.equal(model.dirty,false,'clearing an absent style cannot leave a false unsaved status');
        const selection=editor.bookmark(id(1),0,7),before=Y.encodeStateVector(remote);
        remote.getMap('blocks').get(id(1)).get('text').insert(0,'Nota: ');
        deliver({type:'update',epoch:'epoch',version:2,update:toBase64(Y.encodeStateAsUpdate(remote,before))});
        assert.equal(editor.resolveRange(selection).start,6);
        editor.applyTextFormat(selection,{bold:true});assert.deepEqual(model.draft.blocks[0].formats,[{start:6,end:13,bold:true}]);
        editor.undo();assert.equal(model.draft.blocks[0].text,'Nota: Acuerdo final');assert.equal(model.draft.blocks[0].formats,undefined);
        editor.redo();const recovered=new Y.Doc();Y.applyUpdate(recovered,fromBase64(editor.recoverySnapshot().update));assert.equal(readSharedPage(recovered).blocks[0].formats[0].bold,true);recovered.destroy();
        editor.beginComposition(id(1));assert.throws(()=>editor.applyTextFormat(selection,{italic:true}));editor.endComposition(id(1),model.draft.blocks[0].text);
        editor.replaceText(selection,'Procedimiento',{href:'https://bold.gt'});assert.equal(model.draft.blocks[0].text,'Nota: Procedimiento final');
        assert.equal(model.draft.blocks[0].formats[0].href,'https://bold.gt');
    }finally{editor.dispose();remote.destroy();}
});
