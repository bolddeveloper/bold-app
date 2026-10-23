// Pages UI acceptance with synthetic records; never production or a real Drive.
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import {JSDOM} from "jsdom";
import {createServer} from "vite";
const dom=new JSDOM('<div id="root"></div>',{url:"http://localhost:5192",pretendToBeVisual:true});
globalThis.BroadcastChannel=undefined;
for(const key of ["window","document","navigator","HTMLElement","HTMLTextAreaElement","HTMLInputElement","Element","MutationObserver","CustomEvent","Event","location"])Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
let confirm=true;
const server=await createServer({configFile:false,plugins:[{name:"pages-isolated-dialog",enforce:"pre",transform(_,id){if(id.replaceAll("\\","/").endsWith("/core/shared/bold_dialog.js"))return "export const confirmBold=async()=>globalThis.__pageConfirm;";}}],resolve:{dedupe:["react","react-dom","lucide-react"]},esbuild:{jsx:"automatic",jsxImportSource:"react"},cacheDir:path.join(os.tmpdir(),"bold-pages-ui"),optimizeDeps:{noDiscovery:true,include:[],entries:[]},server:{middlewareMode:true,hmr:false},appType:"custom"});
const {default:React}=await import("react"),{createRoot}=await import("react-dom/client");
const load=file=>server.ssrLoadModule(`/@fs/${path.resolve(file).replaceAll("\\","/")}`);
const {pageApi}=await load("../mensajeria/page_api.js"),{channelApi}=await load("../mensajeria/channel_api.js");
const channelId="00000000-0000-4000-8000-000000000001",pageId="00000000-0000-4000-8000-000000000002";
const blockId="00000000-0000-4000-8000-000000000003";
let page={id:pageId,title:"Guía del equipo",icon:"note",blocks:[{id:blockId,type:"paragraph",text:"Guía https://example.com <script>seguro</script>"}],version:1,can_edit:true,can_manage:true,updated_at:new Date().toISOString(),updated_by:"Cuenta ficticia"};
let history=[structuredClone(page)],fail=false,conflict=false,denied=false,saves=0,shares=0,dirty=false,purge=0,reads=0;
Object.assign(pageApi,{
    list:async()=>{reads++;if(denied)throw {status:403};return {results:[page],next:null,can_create:true};},
    get:async()=>{reads++;if(denied)throw {status:403};return structuredClone(page);},
    create:async(_,values)=>{page={...page,...values,version:1};return page;},
    save:async(_,__,values)=>{
        saves++;if(fail)throw {status:0};
        if(conflict){conflict=false;page={...page,title:"Cambio de mi colega",version:page.version+1};throw {status:409,fields:{current:structuredClone(page)}};}
        assert.equal(values.version,page.version);page={...page,...values,version:page.version+1};history.push(structuredClone(page));return structuredClone(page);
    },
    history:async()=>({results:history.map(row=>({version:row.version,title:row.title,actor:"Cuenta ficticia",created_at:row.updated_at})).reverse(),next:null}),
    revision:async(_,__,version)=>history.find(row=>row.version===version),
    action:async(_,__,values)=>{assert.equal(values.version,page.version);if(values.restore_version)page={...page,...history.find(row=>row.version===values.restore_version),version:page.version+1};else page={...page,archived_at:values.archived ? new Date().toISOString():null,can_edit:!values.archived,version:page.version+1};return structuredClone(page);},
});
Object.assign(channelApi,{send:async(_,values)=>{shares++;assert.equal(values.page_id,pageId);return {message:{id:"synthetic",page:{available:true,id:pageId}}};}});
const {default:Pages}=await load("../mensajeria/channel_pages.jsx");
const root=createRoot(document.getElementById("root"));
const settle=()=>new Promise(resolve=>setTimeout(resolve,35));
const waitFor=async predicate=>{const deadline=Date.now()+5000;while(!predicate() && Date.now()<deadline)await settle();assert.ok(predicate(),"expected pages UI state");};
const button=text=>[...document.querySelectorAll("button")].find(node=>node.textContent===text);
const input=(field,value)=>{const proto=field.tagName==="TEXTAREA" ? dom.window.HTMLTextAreaElement.prototype:dom.window.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,"value").set.call(field,value);field.dispatchEvent(new Event("input",{bubbles:true}));};
const title=()=>document.querySelector(".slack_page_title_field input");
const render=()=>root.render(React.createElement(Pages,{channel:{id:channelId,can_send:true},onDirty:value=>dirty=value,onDenied:()=>purge++,onTask:()=>{},onShared:()=>{}}));
globalThis.__pageConfirm=confirm;
try{
    render();await waitFor(()=>document.querySelector(".slack_page_list nav button"));
    document.querySelector(".slack_page_list nav button").click();await waitFor(title);
    assert.equal(title().value,"Guía del equipo");
    button("Vista previa").click();await settle();assert.equal(document.querySelector(".slack_page_read script"),null);assert.equal(document.querySelector(".slack_page_read a").rel,"noopener noreferrer");
    button("Editar").click();await settle();input(title(),"Notas del proyecto");await settle();assert.equal(dirty,true);await waitFor(()=>document.querySelector(".slack_page_save").textContent==="Guardado");assert.equal(dirty,false);assert.equal(saves,1);
    button("Casilla").click();await settle();assert.equal(document.querySelectorAll(".slack_page_block").length,2);await waitFor(()=>!dirty);
    fail=true;input(title(),"Sin conexión");await waitFor(()=>button("Reintentar guardado"));assert.equal(title().value,"Sin conexión");assert.equal(dirty,true);
    globalThis.__pageConfirm=false;document.querySelector('[aria-label="Crear página"]').click();await settle();assert.equal(title().value,"Sin conexión","cancel navigation preserves local draft");
    fail=false;button("Reintentar guardado").click();await waitFor(()=>!dirty);globalThis.__pageConfirm=true;
    conflict=true;input(title(),"Mi borrador protegido");await waitFor(()=>button("Ver versión guardada"));assert.equal(title().value,"Mi borrador protegido");
    button("Ver versión guardada").click();await settle();assert.match(document.querySelector(".slack_page_snapshot").textContent,/Cambio de mi colega/);
    button("Guardar mi borrador como nueva versión").click();await waitFor(()=>!dirty);assert.equal(page.title,"Mi borrador protegido");
    button("Compartir").click();await waitFor(()=>shares===1);
    document.querySelector('[aria-label="Ver historial"]').click();await waitFor(()=>document.querySelector(".slack_page_history"));await waitFor(()=>document.querySelectorAll(".slack_page_versions button").length>1);
    document.querySelectorAll(".slack_page_versions button")[1].click();await waitFor(()=>document.querySelector(".slack_page_snapshot"));assert.ok(document.querySelector('[role="dialog"][aria-modal="true"]'));
    document.querySelector('[aria-label="Cerrar historial"]').click();await settle();assert.equal(document.querySelector(".slack_page_history"),null);
    const idle=reads;await settle();assert.equal(reads,idle,"no background page polling");
    denied=true;window.dispatchEvent(new CustomEvent("bold:slack-event",{detail:{payload:{channel_id:channelId,kind:"page.changed"}}}));await waitFor(()=>purge>0);assert.equal(title(),null);assert.equal(document.querySelector(".slack_page_blocks"),null);
    console.log("Pages UI passed: editing, autosave, preview safety, offline draft, conflict, sharing, history, idle and revocation.");
}finally{root.unmount();await server.close();dom.window.close();}
