// Real React controls, synthetic transport. Not a production or Drive acceptance.
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
const dom=new JSDOM('<button id="trigger">Abrir</button><div id="root"></div>',{url:'http://localhost:5192',pretendToBeVisual:true});
globalThis.BroadcastChannel=undefined;
for(const key of ['window','document','navigator','HTMLElement','HTMLInputElement','Element','MutationObserver','CustomEvent','Event','location'])Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
globalThis.__resourceCore={account:{id:'a'},activeAssignment:{id:'it',chat_enabled:true},authorizationRevision:1,securityUncertain:false,directory:[]};
const server=await createServer({configFile:false,plugins:[{name:'isolated-resources',enforce:'pre',transform(_,id){if(id.replaceAll('\\','/').endsWith('/core/core_provider.jsx'))return 'export const useCore=()=>globalThis.__resourceCore;';}}],resolve:{dedupe:['react','react-dom','lucide-react']},esbuild:{jsx:'automatic',jsxImportSource:'react'},cacheDir:path.join(os.tmpdir(),'bold-resource-library-ui'),optimizeDeps:{noDiscovery:true,include:[],entries:[]},server:{middlewareMode:true,hmr:false},appType:'custom'});
const {default:React}=await import('react'),{createRoot}=await import('react-dom/client');
const load=file=>server.ssrLoadModule(`/@fs/${path.resolve(file).replaceAll('\\','/')}`);
const {resourceApi}=await load('../mensajeria/resource_api.js'),{default:ResourceLibrary}=await load('../mensajeria/resource_library.jsx');
const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002';
const row={id:a,source_id:b,target:{kind:'chat',conversation_id:a,message_id:b},author:{employee_id:b,name:'Persona antigua'},created_at:'2026-10-01T10:00:00Z',excerpt:'Texto <script>literal</script>',media:null,links:[{href:'https://bold.gt/help',label:'Sitio enviado'},{href:'javascript:alert(1)',label:'No permitido'}]};
let calls=[],pending=null,closed=0,opened=[],fail=false,mediaCalls=0,withMedia=false,mediaPending=null;
const revoked=[],downloads=[];
URL.createObjectURL=()=>`blob:resource-${mediaCalls}`;URL.revokeObjectURL=value=>revoked.push(value);
dom.window.HTMLAnchorElement.prototype.click=function(){downloads.push({href:this.href,filename:this.download});};
resourceApi.media=async(kind,container,message,options)=>{mediaCalls++;if(mediaPending)return new Promise(resolve=>{mediaPending={resolve,signal:options.signal};});return new Blob(['synthetic-bytes'],{type:'image/webp'});};
resourceApi.list=async(kind,container,filters,cursor,options)=>{
    calls.push({kind,container,filters:structuredClone(filters),cursor,signal:options.signal});
    if(pending)return new Promise(resolve=>{pending=resolve;});if(fail)throw {status:403};
    return {results:filters.q==='empty' ? []:[{...row,excerpt:cursor==='next' ? 'Recurso siguiente':row.excerpt,...(withMedia ? {media:{id:b,kind:'image',mime_type:'image/webp',filename:'captura.png',size_bytes:1234,width:50,height:50}}:{})}],first_cursor:'first',next_cursor:cursor==='next' ? null:'next',snapshot_at:'2026-10-29T10:00:00Z'};
};
const root=createRoot(document.getElementById('root')),settle=()=>new Promise(resolve=>setTimeout(resolve,25));
async function waitFor(predicate){const end=Date.now()+5000;while(!predicate() && Date.now()<end)await settle();assert.ok(predicate(),'expected library state');}
const button=text=>[...document.querySelectorAll('button')].find(node=>node.textContent===text || node.getAttribute('aria-label')===text);
const field=label=>[...document.querySelectorAll('label')].find(node=>node.textContent.startsWith(label))?.querySelector('input,select');
function change(node,value){const type=node.tagName==='SELECT' ? dom.window.HTMLSelectElement:dom.window.HTMLInputElement;Object.getOwnPropertyDescriptor(type.prototype,'value').set.call(node,value);node.dispatchEvent(new Event(node.tagName==='SELECT' ? 'change':'input',{bubbles:true}));}
const submit=()=>document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
const mount=(key='first')=>root.render(React.createElement(ResourceLibrary,{key,kind:'chat',container:a,title:'Colega',onClose:()=>closed++,onContext:target=>opened.push(target)}));
try{
    document.getElementById('trigger').focus();mount();await waitFor(()=>document.querySelector('.resource_card'));
    assert.equal(document.querySelector('.resource_library_scrim').parentElement,document.body,'the modal uses viewport space, not a short nested module');
    assert.equal(mediaCalls,0);assert.equal(document.querySelectorAll('script').length,0);assert.match(document.querySelector('.resource_card').textContent,/<script>/);
    assert.equal(document.querySelectorAll('.resource_links a').length,1);assert.equal(document.querySelector('.resource_links a').getAttribute('rel'),'noopener noreferrer');
    assert.equal(field('Enviado por').querySelector(`option[value="${b}"]`).textContent,'Persona antigua','historical author is available even without directory');
    button('Siguientes recursos').click();await waitFor(()=>document.querySelector('.resource_card')?.textContent.includes('Recurso siguiente'));
    assert.equal(calls.at(-1).cursor,'next');button('Recursos anteriores').click();await waitFor(()=>calls.at(-1).cursor==='first');
    const count=calls.length;change(field('Buscar recurso'),'empty');await settle();assert.equal(calls.length,count,'typing does not issue requests');assert.equal(document.querySelectorAll('.resource_card').length,0);
    submit();await waitFor(()=>document.body.textContent.includes('No hay recursos con estos filtros'));assert.equal(calls.at(-1).filters.q,'empty');
    button('Limpiar filtros').click();await settle();submit();await waitFor(()=>document.querySelector('.resource_card'));
    const before=calls.length;window.dispatchEvent(new CustomEvent('bold:messaging-event',{detail:{event_type:'messaging.message.created',payload:{conversation_id:a}}}));await settle();
    assert.match(document.body.textContent,/La conversación cambió/);assert.equal(calls.length,before,'real-time hints never create per-message polling');
    button('Ver mensaje en contexto').click();assert.equal(opened[0].message_id,b);
    withMedia=true;submit();await waitFor(()=>button('Descargar archivo'));assert.equal(mediaCalls,0,'list never loads any Drive bytes');
    button('Descargar archivo').click();await waitFor(()=>downloads.length===1);assert.equal(downloads[0].filename,'captura.webp');
    change(field('Buscar recurso'),'other');await settle();assert.deepEqual(revoked,['blob:resource-1'],'changing filters revokes downloaded object URLs');
    submit();await waitFor(()=>button('Descargar archivo'));mediaPending=true;button('Descargar archivo').click();await waitFor(()=>typeof mediaPending==='object');
    const abandonedDownload=mediaPending;change(field('Buscar recurso'),'later');await settle();assert.equal(abandonedDownload.signal.aborted,true);
    abandonedDownload.resolve(new Blob(['late']));mediaPending=null;await settle();assert.equal(downloads.length,1,'late bytes cannot trigger a download after unmount');withMedia=false;
    pending=true;submit();await waitFor(()=>typeof pending==='function');const abandoned=calls.at(-1);change(field('Buscar recurso'),'new');await settle();assert.equal(abandoned.signal.aborted,true);pending({results:[{...row,excerpt:'STALE'}],next_cursor:null});pending=null;await settle();assert.equal(document.body.textContent.includes('STALE'),false);
    fail=true;submit();await waitFor(()=>document.querySelector('[role="alert"]'));assert.equal(document.querySelectorAll('.resource_card').length,0);fail=false;
    globalThis.__resourceCore={...globalThis.__resourceCore,authorizationRevision:2};mount();await waitFor(()=>closed>0);assert.equal(document.querySelector('.resource_library'),null,'changed authorization cannot render cached resources');
    mount('second');await waitFor(()=>document.querySelector('.resource_card'));window.dispatchEvent(new Event('bold:permissions-invalidated'));await settle();assert.equal(document.querySelectorAll('.resource_card').length,0);
    root.unmount();await settle();assert.equal(document.activeElement.id,'trigger');
    console.log('Resource library UI: filters, scoped pagination, literal links, historical authors, context, hints, cancellation and revocation passed.');
}finally{await server.close();dom.window.close();}
