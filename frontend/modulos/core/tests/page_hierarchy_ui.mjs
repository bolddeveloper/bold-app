// Real React controls, synthetic server records; no production or Google calls.
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
const dom=new JSDOM('<button id="trigger">Mover</button><div id="root"></div>',{url:'http://localhost:5192',pretendToBeVisual:true});
globalThis.BroadcastChannel=undefined;
for(const key of ['window','document','navigator','HTMLElement','HTMLInputElement','Element','Event','CustomEvent'])Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
const server=await createServer({configFile:false,resolve:{dedupe:['react','react-dom','lucide-react']},esbuild:{jsx:'automatic',jsxImportSource:'react'},cacheDir:path.join(os.tmpdir(),'bold-page-hierarchy-ui'),optimizeDeps:{noDiscovery:true,include:[],entries:[]},server:{middlewareMode:true,hmr:false},appType:'custom'});
const {default:React}=await import('react'),{createRoot}=await import('react-dom/client');
const load=file=>server.ssrLoadModule(`/@fs/${path.resolve(file).replaceAll('\\','/')}`);
const {pageApi}=await load('../mensajeria/page_api.js'),{PageTree,PageBreadcrumbs,MovePage}=await load('../mensajeria/page_hierarchy.jsx');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const channel=id(1),page={id:id(2),title:'Proceso',has_children:true,version:1},child={id:id(3),title:'Detalle',has_children:false,version:1};
const root=createRoot(document.getElementById('root')),pause=()=>new Promise(resolve=>setTimeout(resolve,25));
const waitFor=async predicate=>{const limit=Date.now()+5000;while(!predicate() && Date.now()<limit)await pause();assert.ok(predicate(),'expected hierarchy UI state');};
const button=text=>[...document.querySelectorAll('button')].find(row=>row.textContent===text);
const input=value=>{const field=document.querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,value);field.dispatchEvent(new Event('input',{bubbles:true}));};
let branchReads=0,opened=null,moved=0,denied=0,failed=true,structureFailed=false,conflict=false,release,held=false,lateSignal;
const calls=[];
Object.assign(pageApi,{
    branch:async(_,parent)=>{branchReads++;assert.equal(parent,page.id);return {results:[child],next:null};},
    structure:async()=>{if(structureFailed)throw {status:503};return {parent_id:null,structure_version:1,ancestors:[{id:id(4),title:'Manual del equipo'}]};},
    parents:async(_,__,query)=>({results:query ? [{id:id(5),title:'Destino <script>seguro</script>'}]:[{id:id(4),title:'Manual del equipo'}],next:null}),
    move:async(_,__,values,options)=>{calls.push(structuredClone(values));lateSignal=options.signal;if(held)return new Promise(resolve=>release=resolve);if(conflict){conflict=false;throw {status:409,fields:{current:{parent_id:id(6),structure_version:2,ancestors:[]},detail:'La ubicación cambió.'}};}if(failed)throw {status:0};return {structure_version:2,parent_id:values.parent_id};},
});
const mountMove=key=>root.render(React.createElement(MovePage,{key,channelId:channel,page,onClose:()=>root.render(null),onMoved:()=>{moved++;root.render(null);},onDenied:()=>denied++}));
const readyMove=()=>waitFor(()=>document.querySelector('.slack_page_move') && button('Manual del equipo'));
const select=async text=>{button(text).click();await waitFor(()=>button('Confirmar ubicación') && !button('Confirmar ubicación').disabled);};
try{
    root.render(React.createElement(PageTree,{rows:[page],channelId:channel,archived:false,revision:1,onOpen:value=>opened=value,onError:()=>{},selected:child.id}));
    await waitFor(()=>button('ProcesoVersión 1'));assert.equal(branchReads,0,'collapsed branches are not fetched');
    document.querySelector('[aria-expanded]').click();await waitFor(()=>document.querySelector('[aria-current="page"]'));assert.equal(branchReads,1);
    document.querySelector('[aria-current="page"]').click();assert.equal(opened,child.id);
    document.querySelector('[aria-expanded]').click();await pause();assert.equal(document.querySelector('[aria-current="page"]'),null);
    root.render(React.createElement(PageBreadcrumbs,{channelId:channel,pageId:page.id,revision:1,onOpen:value=>opened=value,onDenied:()=>denied++}));
    await waitFor(()=>button('Manual del equipo'));button('Manual del equipo').click();assert.equal(opened,id(4));
    structureFailed=true;root.render(React.createElement(PageBreadcrumbs,{channelId:channel,pageId:page.id,revision:2,onOpen:()=>{},onDenied:()=>denied++}));
    await waitFor(()=>button('Reintentar ubicación'));assert.equal(document.querySelector('nav').textContent.includes('Páginas del canal'),false,'failed hierarchy must not masquerade as a root page');
    structureFailed=false;button('Reintentar ubicación').click();await waitFor(()=>button('Manual del equipo'));
    document.getElementById('trigger').focus();mountMove('one');await readyMove();
    await select('Manual del equipo');button('Confirmar ubicación').click();await waitFor(()=>button('Reintentar movimiento') && !button('Reintentar movimiento').disabled);
    assert.equal(document.querySelector('input').disabled,true);assert.equal(moved,0);
    failed=false;button('Reintentar movimiento').click();await waitFor(()=>moved===1);assert.deepEqual(calls[0],calls[1]);
    assert.equal(document.activeElement,document.getElementById('trigger'));
    conflict=true;mountMove('two');await readyMove();await select('Raíz del canal');button('Confirmar ubicación').click();await waitFor(()=>document.querySelector('[role="alert"]'));
    assert.equal(button('Confirmar ubicación').disabled,true,'a stale move requires choosing again');const before=calls.length;await pause();assert.equal(calls.length,before,'no automatic retry after conflict');
    input('Destino');await waitFor(()=>button('Destino <script>seguro</script>'));assert.equal(document.querySelector('script'),null);
    await select('Destino <script>seguro</script>');button('Confirmar ubicación').click();await waitFor(()=>moved===2);assert.equal(calls.at(-1).version,2);
    held=true;mountMove('three');await readyMove();await select('Raíz del canal');button('Confirmar ubicación').click();await waitFor(()=>release);
    root.render(null);await pause();assert.equal(lateSignal.aborted,true);release({structure_version:2,parent_id:null});await pause();assert.equal(moved,2,'late response after unmount is discarded');
    assert.equal(denied,0);console.log('Page hierarchy UI passed: lazy branches, breadcrumbs, literal labels, explicit moves, immutable retry, stale review, focus return and late-response cancellation.');
}finally{root.unmount();await server.close();dom.window.close();}
