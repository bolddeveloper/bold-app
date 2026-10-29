// Real React + Yjs + WebCrypto, synthetic WebSocket/server and storage adapter.
// This proves the recovery controls, not a real browser's IndexedDB durability.
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import {JSDOM} from "jsdom";
import {createServer} from "vite";
const dom=new JSDOM('<div id="root"></div>',{url:"http://localhost:5192",pretendToBeVisual:true});
globalThis.BroadcastChannel=undefined;
for(const key of ["window","document","navigator","HTMLElement","HTMLTextAreaElement","HTMLInputElement","Element","MutationObserver","CustomEvent","Event","location"])Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
globalThis.__pageConfirm=true;
const server=await createServer({configFile:false,plugins:[{name:"recovery-isolated-dialog",enforce:"pre",transform(_,id){
    const file=id.replaceAll("\\","/");
    if(file.endsWith("/core/shared/bold_dialog.js"))return "export const confirmBold=async()=>globalThis.__pageConfirm;";
    if(file.endsWith("/core/core_provider.jsx"))return 'export const useCore=()=>({account:{id:"synthetic"},activeAssignment:{id:"it",chat_enabled:true},authorizationRevision:1});';
}}],resolve:{dedupe:["react","react-dom","lucide-react"]},esbuild:{jsx:"automatic",jsxImportSource:"react"},cacheDir:path.join(os.tmpdir(),"bold-page-recovery-ui"),optimizeDeps:{noDiscovery:true,include:[],entries:[]},server:{middlewareMode:true,hmr:false},appType:"custom"});
const {default:React}=await import("react"),{createRoot}=await import("react-dom/client");
const load=file=>server.ssrLoadModule(`/@fs/${path.resolve(file).replaceAll("\\","/")}`);
const Y=await load("./shared/crdt.js"),model=await load("../mensajeria/page_collab_model.js");
const {pageApi}=await load("../mensajeria/page_api.js"),{draftService}=await load("../mensajeria/draft_service.js");
const {createDraftVault}=await load("../mensajeria/draft_vault.js"),{protectPrivateWork}=await load("./shared/private_work.js");
const channelId="00000000-0000-4000-8000-000000000001",pageId="00000000-0000-4000-8000-000000000002",blockId="00000000-0000-4000-8000-000000000003",epoch="00000000-0000-4000-8000-000000000004";
let page={id:pageId,title:"Guía",icon:"note",blocks:[{id:blockId,type:"paragraph",text:"Texto"}],version:1,can_edit:true,can_manage:true,collaboration_enabled:true,updated_at:new Date().toISOString(),updated_by:"Cuenta ficticia"};
const shared=new Y.Doc();model.writeSharedPage(shared,page);
const abandoned=new Y.Doc();Y.applyUpdate(abandoned,Y.encodeStateAsUpdate(shared));model.writeSharedPage(abandoned,{...page,title:"A Guía"});
const snapshot={version:1,epoch,update:model.toBase64(Y.encodeStateAsUpdate(abandoned)),references:{},generation:1,accepted:0,pending:null,recoveredBlocks:[],compositionDraft:null};
model.writeSharedPage(shared,{...page,title:"B Guía"});page={...page,...model.readSharedPage(shared),version:2};
let record=null,failStorage=false,denied=0;
const storage={get:async()=>record,put:async value=>{if(failStorage)throw Error("quota");record=value;},remove:async()=>{record=null;},purge:async()=>{record=null;}};
const vault=createDraftVault({storage}),scope={kind:"page",resource_id:pageId,channel_id:channelId,account_id:"synthetic",assignment_id:"it"};
const authorize=async()=>({scope,key:btoa("a".repeat(32)),key_id:"a".repeat(32),can_write:true,retention_seconds:604800});
const old=await vault.open(scope,authorize);await old.save(snapshot);old.close();
draftService.open=async()=>vault.open(scope,authorize);draftService.purge=async()=>vault.purge();
Object.assign(pageApi,{branch:async()=>({results:[page],next:null,can_create:true}),structure:async()=>({ancestors:[],parent_id:null,structure_version:1}),get:async()=>structuredClone(page),ticket:async()=>({ticket:"synthetic-only"})});
const sockets=[];let holdAcks=false;const acknowledgements=[];
globalThis.WebSocket=class {
    constructor(){this.readyState=1;sockets.push(this);setTimeout(()=>this.deliver({type:"sync",epoch,update:model.toBase64(Y.encodeStateAsUpdate(shared)),state:model.toBase64(Y.encodeStateVector(shared)),page:structuredClone(page)}),0);}
    deliver(packet){if(this.readyState===1)this.onmessage?.({data:JSON.stringify(packet)});}
    send(raw){const packet=JSON.parse(raw);if(packet.type!=="update")return;Y.applyUpdate(shared,model.fromBase64(packet.update));page={...page,...model.readSharedPage(shared),version:page.version+1};const ack={type:"ack",epoch,client_id:packet.client_id,version:page.version,update:model.toBase64(Y.encodeStateAsUpdate(shared,model.fromBase64(packet.state))),state:model.toBase64(Y.encodeStateVector(shared)),tasks:[]};const deliver=()=>this.deliver(ack);if(holdAcks)acknowledgements.push(deliver);else setTimeout(deliver,0);}
    close(){this.readyState=3;}
};
const {default:Pages}=await load("../mensajeria/channel_pages.jsx");
const root=createRoot(document.getElementById("root")),settle=()=>new Promise(resolve=>setTimeout(resolve,25));
const waitFor=async (predicate,describe=()=>"")=>{const deadline=Date.now()+6000;while(!predicate() && Date.now()<deadline)await settle();assert.ok(predicate(),"expected recovery UI state "+describe());};
const title=()=>document.querySelector(".slack_page_title_field input"),button=text=>[...document.querySelectorAll("button")].find(node=>node.textContent===text);
const input=value=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,"value").set.call(title(),value);title().dispatchEvent(new Event("input",{bubbles:true}));};
const warnsOnExit=()=>{const event=new dom.window.Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;};
try{
    root.render(React.createElement(Pages,{channel:{id:channelId,can_send:true},onDirty:()=>{},onDenied:()=>denied++,onTask:()=>{},onShared:()=>{}}));
    await waitFor(()=>document.querySelector(".slack_page_list nav button"));document.querySelector(".slack_page_list nav button").click();
    await waitFor(()=>button("Recuperar borrador conservado"));assert.equal(title().disabled,true);assert.equal(title().value,"B Guía");assert.ok(record,"opening does not erase unread recovery");
    await waitFor(()=>!button("Recuperar borrador conservado").disabled);button("Recuperar borrador conservado").click();
    await waitFor(()=>!title().disabled && /A /.test(title().value) && /B /.test(title().value));await waitFor(()=>document.querySelector(".slack_page_save").textContent==="Guardado");
    failStorage=true;holdAcks=true;const merged=title().value;input(`${merged} / mío`);await waitFor(()=>button("Deshacer") && !button("Deshacer").disabled);await waitFor(()=>button("Reintentar protección"));assert.equal(await protectPrivateWork(),false);assert.equal(warnsOnExit(),true,'unprotected CRDT edits must retain the browser guard');
    title().focus();title().dispatchEvent(new dom.window.KeyboardEvent("keydown",{key:"z",ctrlKey:true,bubbles:true}));await waitFor(()=>title().value===merged);assert.match(title().value,/B /);
    failStorage=false;button("Reintentar protección")?.click();await waitFor(()=>!button("Reintentar protección"));button("Rehacer").click();await waitFor(()=>title().value.endsWith(" / mío"));assert.equal(await protectPrivateWork(),true);assert.equal(warnsOnExit(),false,'protected CRDT recovery does not block an explicitly accepted reload');
    holdAcks=false;for(const deliver of acknowledgements.splice(0))deliver();
    await waitFor(()=>document.querySelector(".slack_page_save").textContent==="Guardado" && record===null);
    const searchFocusTrace=[];
    const traceFocus=event=>searchFocusTrace.push({field:event.target.dataset?.pageField,stack:new Error().stack?.split('\n').slice(1,9).join('\n')});
    document.addEventListener('focusin',traceFocus);
    root.render(React.createElement(Pages,{channel:{id:channelId,can_send:true},targetPage:{id:pageId,block_id:blockId,requestId:"search-ready-focus"},onDirty:()=>{},onDenied:()=>denied++,onTask:()=>{},onShared:()=>{}}));
    await waitFor(()=>document.activeElement?.dataset.pageField===blockId && !document.activeElement.disabled,()=>JSON.stringify({focus:document.activeElement?.outerHTML?.slice(0,300),fields:[...document.querySelectorAll('[data-page-field],[data-page-block]')].map(node=>({tag:node.tagName,id:node.dataset.pageField || node.dataset.pageBlock,disabled:node.disabled})),status:document.querySelector('.slack_page_save')?.textContent,recovery:!!button('Recuperar borrador conservado'),trace:searchFocusTrace.slice(-3)}));
    document.removeEventListener('focusin',traceFocus);
    assert.equal(document.activeElement.tagName,"TEXTAREA","search must focus the final editable field, not the temporary read-only projection");
    assert.equal(denied,0);console.log("Recovery UI passed: explicit choice, CRDT merge, own undo/redo, keyboard, storage error, PWA protection and search focus after collaboration is ready.");
}finally{root.unmount();for(const socket of sockets)socket.close();await server.close();shared.destroy();abandoned.destroy();dom.window.close();}
