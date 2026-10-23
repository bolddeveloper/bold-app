import test from "node:test";
import assert from "node:assert/strict";
import {createPageEditor,documentContent} from "./page_editor_model.js";
import {createPageApi} from "./page_api.js";
const channel="00000000-0000-4000-8000-000000000001",pageId="00000000-0000-4000-8000-000000000002";
const page={id:pageId,title:"Notas",icon:"note",blocks:[{id:"b",type:"paragraph",text:"Uno"}],version:1,can_edit:true};
const pause=()=>new Promise(resolve=>setTimeout(resolve,15));
function setup(save,extra={}){let state;const editor=createPageEditor({page,save,onChange:value=>state=value,delay:100_000,...extra});return {editor,state:()=>state};}
const edited=(value,title)=>({...documentContent(value),title});

test("editor coalesces edits, serializes in-flight changes and does not poll",async()=>{
    let release,calls=[];
    const {editor,state}=setup(async values=>{calls.push(values);if(calls.length===1)await new Promise(resolve=>release=resolve);return {...page,...values,version:values.version+1};});
    try{
        editor.edit(edited(page,"Dos"));const first=editor.flush();await pause();
        editor.edit(edited(page,"Tres"));editor.flush();assert.equal(calls.length,1);
        release();await first;assert.equal(state().draft.title,"Tres");assert.equal(state().base.version,2);
        await editor.flush();assert.equal(calls[1].version,2);assert.equal(state().dirty,false);assert.equal(state().status,"saved");
        await pause();assert.equal(calls.length,2);
    }finally{editor.dispose();}
});
test("unknown delivery retries the exact snapshot before saving later edits",async()=>{
    const calls=[];let fail=true;
    const {editor,state}=setup(async values=>{calls.push(values);if(fail)throw {status:0};return {...page,...values,version:values.version+1};});
    try{editor.edit(edited(page,"Dos"));await editor.flush();assert.equal(state().status,"error");editor.edit(edited(page,"Tres"));fail=false;await editor.flush();assert.deepEqual(calls[0],calls[1]);assert.equal(state().draft.title,"Tres");await editor.flush();assert.equal(calls[2].title,"Tres");assert.equal(calls[2].version,2);assert.notEqual(calls[2].client_id,calls[0].client_id);}finally{editor.dispose();}
});
test("conflict preserves draft, stops writes and explicit resolution uses latest version",async()=>{
    let remote={...page,title:"Colega",version:2},calls=[];
    const {editor,state}=setup(async values=>{calls.push(values);if(values.version===1)throw {status:409,fields:{current:remote}};return {...page,...values,version:values.version+1};});
    try{editor.edit(edited(page,"Mi borrador"));await editor.flush();assert.equal(state().draft.title,"Mi borrador");assert.equal(state().conflict.title,"Colega");await editor.flush();assert.equal(calls.length,1);editor.resolve(true);await pause();assert.equal(calls.at(-1).version,2);assert.equal(state().status,"saved");assert.equal(state().base.title,"Mi borrador");}finally{editor.dispose();}
});
test("using server version returns a recoverable local draft",async()=>{
    const {editor,state}=setup(async()=>{});try{editor.edit(edited(page,"Borrador"));editor.remote({...page,title:"Servidor",version:3});const recovered=editor.resolve(false);assert.equal(recovered.title,"Borrador");assert.equal(state().draft.title,"Servidor");assert.equal(state().dirty,false);editor.edit(recovered);assert.equal(state().dirty,true);}finally{editor.dispose();}
});
test("same-version refresh updates permissions and task visibility without losing a draft",()=>{
    const {editor,state}=setup(async()=>{});
    try{editor.edit(edited(page,"Mi borrador"));editor.remote({...page,can_edit:false,can_manage:false});assert.equal(state().base.can_edit,false);assert.equal(state().draft.title,"Mi borrador");assert.equal(state().dirty,true);}finally{editor.dispose();}
});
test("own event racing response does not leave a false conflict; newer remote still does",async()=>{
    let release;const {editor,state}=setup(async values=>{await new Promise(resolve=>release=resolve);return {...page,...values,version:2};});
    try{editor.edit(edited(page,"Dos"));const saved=editor.flush();await pause();editor.remote({...page,title:"Dos",version:2});release();await saved;assert.equal(state().conflict,null);assert.equal(state().status,"saved");}finally{editor.dispose();}
});
test("retry accepted before another writer never silently applies a stale draft",async()=>{
    const {editor,state}=setup(async()=>({...page,title:"Colega",version:3,accepted_version:2}));
    try{editor.edit(edited(page,"Mío"));await editor.flush();assert.equal(state().status,"conflict");assert.equal(state().draft.title,"Mío");assert.equal(state().conflict.version,3);}finally{editor.dispose();}
});
test("validation can be corrected; rate limits retain receipt and honor retry time",async()=>{
    let clock=0,count=0;const {editor,state}=setup(async values=>{count++;if(count===1)throw {status:400};if(count===2)throw {status:429,retryAfterMs:1000};return {...page,...values,version:2};},{now:()=>clock});
    try{editor.edit(edited(page,""));await editor.flush();editor.edit(edited(page,"Corregido"));await editor.flush();assert.equal(state().status,"error");await editor.flush();assert.equal(count,2);clock=1001;await editor.flush();assert.equal(count,3);assert.equal(state().status,"saved");}finally{editor.dispose();}
});
test("revocation invokes purge and disposal ignores stale async replies",async()=>{
    let denied=0,release;const {editor,state}=setup(async()=>{throw {status:403};},{onDenied:()=>denied++});editor.edit(edited(page,"Dos"));await editor.flush();assert.equal(denied,1);editor.dispose();
    const next=setup(async values=>{await new Promise(resolve=>release=resolve);return {...page,...values,version:2};});next.editor.edit(edited(page,"Otro"));const save=next.editor.flush();await pause();next.editor.dispose();release();await save;assert.equal(next.state().base.version,1);
});
test("page API bounds identifiers and preserves pagination context and revision routes",async()=>{
    const calls=[],api=createPageApi({request:async(...args)=>{calls.push(args);return {};}});
    await api.list(channel,true,`https://proxy.invalid/api/v2/messaging/channels/${channel}/pages/?archived=true&cursor=next`);
    assert.match(calls[0][0],/archived=true&cursor=next$/);
    assert.throws(()=>api.list(channel,false,`/api/v2/messaging/channels/${channel}/pages/?archived=true&cursor=next`));
    assert.throws(()=>api.history(channel,pageId,`/api/v2/messaging/channels/${pageId}/pages/?cursor=next`));
    assert.throws(()=>api.get("../x",pageId));assert.throws(()=>api.revision(channel,pageId,0));
    await api.save(channel,pageId,{version:1});assert.equal(calls.at(-1)[1].timeoutMs,15000);assert.equal(calls.at(-1)[1].method,"PUT");
});
