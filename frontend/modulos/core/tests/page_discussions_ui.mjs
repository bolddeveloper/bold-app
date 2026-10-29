import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
const dom=new JSDOM('<button id="trigger">Comentarios</button><div id="root"></div>',{url:'http://localhost:5192',pretendToBeVisual:true});
globalThis.BroadcastChannel=undefined;
for(const key of ['window','document','navigator','HTMLElement','HTMLInputElement','HTMLTextAreaElement','Event','CustomEvent'])Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
const server=await createServer({configFile:false,plugins:[{name:'comments-fixture',enforce:'pre',transform(_,id){
    if(id.replaceAll('\\','/').endsWith('/core/core_provider.jsx'))return 'export const useCore=()=>({securityUncertain:false});';
    if(id.replaceAll('\\','/').endsWith('/core/shared/bold_dialog.js'))return 'export const confirmBold=async()=>true;';
}}],resolve:{dedupe:['react','react-dom','lucide-react']},esbuild:{jsx:'automatic',jsxImportSource:'react'},cacheDir:path.join(os.tmpdir(),'bold-page-discussions-ui'),optimizeDeps:{noDiscovery:true,include:[],entries:[]},server:{middlewareMode:true,hmr:false},appType:'custom'});
const {default:React}=await import('react'),{createRoot}=await import('react-dom/client');
const load=file=>server.ssrLoadModule(`/@fs/${path.resolve(file).replaceAll('\\','/')}`);
const {discussionApi}=await load('../mensajeria/page_discussion_api.js'),{default:Discussions,CommentComposer}=await load('../mensajeria/page_discussions.jsx');
const {createDraftVault}=await load('../mensajeria/draft_vault.js'),{draftService}=await load('../mensajeria/draft_service.js');
const records=new Map(),vault=createDraftVault({storage:{get:async id=>records.get(id),put:async row=>records.set(row.id,row),remove:async id=>records.delete(id),purge:async()=>records.clear()}});
draftService.open=async resource=>{const scope={...resource,account_id:'alfa',assignment_id:'it'};return vault.open(scope,async()=>({scope,key:btoa('a'.repeat(32)),key_id:'a'.repeat(32),can_write:true,retention_seconds:604800}));};draftService.purge=()=>vault.purge();
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,root=createRoot(document.getElementById('root')),date='2026-10-29T12:00:00Z';
const pause=()=>new Promise(resolve=>setTimeout(resolve,25)),waitFor=async predicate=>{const end=Date.now()+5000;while(!predicate() && Date.now()<end)await pause();assert.ok(predicate(),'expected comments UI state');};
const button=text=>[...document.querySelectorAll('button')].find(node=>node.textContent===text);
const input=value=>{const node=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}));};
const submit=()=>document.querySelector('.slack_comment_composer').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
const own={id:id(4),thread_id:id(3),body:'Comentario propio https://bold.gt <script>inocuo</script>',version:1,author:{id:id(8),name:'Alfa'},created_at:date,can_edit:true,can_delete:true};
const foreign={...own,id:id(5),author:{id:id(9),name:'Beta'},body:'Respuesta de Beta',can_edit:false,can_delete:false};
let thread={id:id(3),block_id:id(7),root:own,created_at:date,reply_count:1,version:1,anchor_present:true,can_reply:true,can_resolve:true},rows=[own,foreign],reads=0,denials=0,fail=true,attempts=[],sent=0,close=0;
Object.assign(discussionApi,{
    list:async()=>({results:[thread],next:null}),comments:async()=>{reads++;return {thread,results:rows,next:null};},
    reply:async(_,__,___,values)=>{attempts.push(values);if(fail)throw {status:0};return {thread,comment:{...own,id:id(6),body:values.body}};},
    create:async()=>assert.fail('unexpected root send'),
    resolve:async(_,__,___,values)=>{thread={...thread,version:thread.version+1,resolved_at:values.resolved ? date:null,can_reply:!values.resolved};return {thread};},
    remove:async(_,__,comment)=>{assert.equal(comment,own.id);rows=rows.map(row=>row.id===own.id ? {...row,body:'',deleted_at:date,can_edit:false,can_delete:false,version:2}:row);return {thread,comment:rows[0]};},
});
try{
    document.getElementById('trigger').focus();root.render(React.createElement(Discussions,{identity:'alfa:it:1',channelId:id(1),page:{id:id(2),title:'Guía',blocks:[{id:id(7),type:'paragraph',text:'Texto'}]},summary:{can_create:true},onDenied:()=>denials++,onClose:()=>{close++;root.render(null);}}));
    await waitFor(()=>document.querySelector('.slack_discussion_list button'));document.querySelector('.slack_discussion_list button').click();
    await waitFor(()=>document.querySelectorAll('.slack_discussion_comments li').length===2 && document.querySelector('textarea') && !document.querySelector('textarea').disabled);
    assert.equal(document.querySelectorAll('.slack_comment_actions button').length,2,'only own edit/delete');assert.equal(document.querySelector('script'),null);assert.equal(document.querySelector('.slack_comment_text a').rel,'noopener noreferrer');
    input('Borrador de respuesta');await pause();submit();await waitFor(()=>button('Reintentar mismo comentario'));assert.equal(attempts.length,1);assert.equal(document.querySelector('textarea').disabled,true);
    const original=attempts[0];assert.equal(records.size>0,true,'pending attempt protected');
    document.querySelector('[aria-label="Cerrar comentarios de la página"]').click();await waitFor(()=>close===1);assert.equal(document.activeElement,document.getElementById('trigger'));
    root.render(React.createElement(CommentComposer,{key:'reopened',identity:'alfa:it:1',channelId:id(1),pageId:id(2),mode:'reply',parent:id(3),allowed:true,onDenied:()=>denials++,onSent:()=>sent++}));
    await waitFor(()=>button('Recuperar borrador de conversación'));assert.equal(attempts.length,1);button('Recuperar borrador de conversación').click();await waitFor(()=>button('Reintentar mismo comentario'));
    assert.equal(document.querySelector('textarea').value,'Borrador de respuesta');fail=false;submit();await waitFor(()=>sent===1);assert.deepEqual(attempts[1],original);assert.equal(document.querySelector('textarea').value,'');
    root.render(null);await pause();assert.equal(records.size,0,'confirmed attempt cleared');
    root.render(React.createElement(Discussions,{key:'second',identity:'alfa:it:1',channelId:id(1),page:{id:id(2),title:'Guía',blocks:[{id:id(7)}]},summary:{can_create:true},onDenied:()=>denials++,onClose:()=>{close++;root.render(null);}}));
    await waitFor(()=>document.querySelector('.slack_discussion_list button'));document.querySelector('.slack_discussion_list button').click();await waitFor(()=>button('Resolver hilo'));button('Resolver hilo').click();await waitFor(()=>button('Reabrir hilo'));assert.equal(document.querySelector('textarea'),null);
    button('Reabrir hilo').click();await waitFor(()=>button('Resolver hilo') && document.querySelector('textarea'));
    const before=reads;window.dispatchEvent(new CustomEvent('bold:slack-event',{detail:{payload:{channel_id:id(1),kind:'page.comments_changed'}}}));await waitFor(()=>reads>before);const idle=reads;await pause();assert.equal(reads,idle,'no idle polling');
    button('Eliminar').click();await waitFor(()=>document.querySelector('.slack_discussion_comments').textContent.includes('Comentario eliminado.'));assert.ok(document.body.textContent.includes('Respuesta de Beta'));
    await waitFor(()=>document.querySelector('textarea') && !document.querySelector('textarea').disabled);
    input('Respuesta enviada antes del cierre');await pause();submit();await waitFor(()=>document.querySelector('textarea')?.value==='');
    input('Nuevo borrador: cerrar inmediatamente');document.querySelector('[aria-label="Cerrar comentarios de la página"]').click();await waitFor(()=>close===2);
    root.render(React.createElement(CommentComposer,{key:'fast-close',identity:'alfa:it:1',channelId:id(1),pageId:id(2),mode:'reply',parent:id(3),allowed:true,onDenied:()=>denials++,onSent:()=>{}}));
    await waitFor(()=>button('Recuperar borrador de conversación'));button('Recuperar borrador de conversación').click();await waitFor(()=>document.querySelector('textarea')?.value==='Nuevo borrador: cerrar inmediatamente');
    assert.equal(denials,0);console.log('Page comments UI passed: own-only controls, safe links, encrypted recovery and frozen retry, no auto send, resolve/reopen, live hints, no polling and tombstone preserves replies.');
}finally{root.unmount();vault.suspend();await server.close();dom.window.close();}
