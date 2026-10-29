// Real React controls with synthetic API replies. Not a production/browser ACL test.
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import {JSDOM} from "jsdom";
import {createServer} from "vite";

const dom=new JSDOM('<div id="root"></div>',{url:"http://localhost:5192",pretendToBeVisual:true});
globalThis.BroadcastChannel=undefined;
for(const key of ["window","document","navigator","HTMLElement","HTMLTextAreaElement","HTMLInputElement","Element","MutationObserver","CustomEvent","Event","location"])Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
globalThis.__historyCore={account:{id:"a"},activeAssignment:{id:"it",chat_enabled:true},authorizationRevision:1,securityUncertain:false,
    directory:[{personId:"00000000-0000-4000-8000-000000000010",name:"Persona de prueba"}]};
const server=await createServer({configFile:false,plugins:[{name:"isolated-history",enforce:"pre",transform(_,id){if(id.replaceAll("\\","/").endsWith("/core/core_provider.jsx"))return "export const useCore=()=>globalThis.__historyCore;";}}],
    resolve:{dedupe:["react","react-dom","lucide-react"]},esbuild:{jsx:"automatic",jsxImportSource:"react"},cacheDir:path.join(os.tmpdir(),"bold-history-search-ui"),optimizeDeps:{noDiscovery:true,include:[],entries:[]},server:{middlewareMode:true,hmr:false},appType:"custom"});
const {default:React}=await import("react"),{createRoot}=await import("react-dom/client");
const load=file=>server.ssrLoadModule(`/@fs/${path.resolve(file).replaceAll("\\","/")}`);
const {historyApi}=await load("../mensajeria/history_api.js"),{channelApi}=await load("../mensajeria/channel_api.js");
const {default:HistorySearch}=await load("../mensajeria/history_search.jsx");
const a="00000000-0000-4000-8000-000000000001",b="00000000-0000-4000-8000-000000000002",c="00000000-0000-4000-8000-000000000003";
const author={employee_id:"00000000-0000-4000-8000-000000000010",name:"Persona de prueba"};
const row={id:a,kind:"text",source_id:b,title:"Mensaje antiguo",snippet:"Revisión <script>no ejecutar</script>",created_at:"2026-10-01T10:00:00Z",author,target:{kind:"chat",conversation_id:a,message_id:b}};
const second={...row,id:c,title:"Otra página de resultados",source_id:c,target:{...row.target,message_id:c}};
let searches=[],contexts=[],pending=null,failContext=false,closed=0,opened=[];
const savedActions=[];
historyApi.save=async(kind,source,options)=>{savedActions.push({kind,source,signal:options.signal});return {document_id:a,saved:true};};
historyApi.unsave=async(identity)=>{savedActions.push({remove:identity});};
channelApi.list=async()=>({results:[{id:a,name:"General"}],next:null});
historyApi.search=async(filters,cursor,options)=>{
    searches.push({filters:structuredClone(filters),cursor,signal:options.signal});
    if(pending)return new Promise(resolve=>{pending=resolve;});
    return {results:cursor==="next" ? [second]:[row],first_cursor:"first-fence",next_cursor:cursor==="next" ? null:"next"};
};
historyApi.context=async target=>{
    contexts.push(target);if(failContext)throw {status:404};
    if(target.kind==="page")return {id:b,title:"Acuerdos de prueba",blocks:[{id:c,type:"paragraph",text:"Bloque exacto de la página"}]};
    return {anchor_id:target.message_id,conversation:{me:author,peer:{employee_id:"peer",name:"Colega"}},has_before:true,has_after:false,
        results:[{id:target.message_id,body:"Contexto exacto <script>no ejecutar</script>",created_at:row.created_at,author_id:author.employee_id}]};
};
const root=createRoot(document.getElementById("root"));
const settle=()=>new Promise(resolve=>setTimeout(resolve,30));
async function waitFor(predicate){const limit=Date.now()+5000;while(!predicate() && Date.now()<limit)await settle();assert.ok(predicate(),"expected history UI state");}
const button=text=>[...document.querySelectorAll("button")].find(node=>node.textContent===text || node.getAttribute("aria-label")===text);
function field(label){return [...document.querySelectorAll("label")].find(node=>node.textContent.startsWith(label))?.querySelector("input,select");}
function change(node,value){const type=node.tagName==="SELECT" ? dom.window.HTMLSelectElement:dom.window.HTMLInputElement;Object.getOwnPropertyDescriptor(type.prototype,"value").set.call(node,value);node.dispatchEvent(new Event(node.tagName==="SELECT" ? "change":"input",{bubbles:true}));}
const mount=props=>root.render(React.createElement(HistorySearch,{initialScope:"chat",onClose:()=>closed++,onOpenPage:target=>{opened.push(target);return true;},...props}));
const submit=()=>document.querySelector(".history_search_dialog form").dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));
try{
    mount();await waitFor(()=>field("Palabras"));
    change(field("Palabras"),"revisión");await settle();
    assert.equal(searches.length,0,"typing must not query or poll the history");
    change(field("Desde"),"2026-10-01");change(field("Hasta"),"2026-10-27");await settle();submit();
    await waitFor(()=>document.querySelectorAll(".history_search_results li").length===1);
    assert.equal(searches[0].filters.q,"revisión");assert.ok(searches[0].filters.before);
    button("Guardar para mí").click();await waitFor(()=>button("Quitar de mis guardados"));
    assert.equal(savedActions[0].kind,"chat");assert.equal(savedActions[0].source,b);
    button("Quitar de mis guardados").click();await waitFor(()=>button("Guardar para mí"));
    assert.equal(savedActions[1].remove,a);
    assert.equal(document.querySelectorAll("script").length,0);assert.match(document.querySelector(".history_search_results").textContent,/<script>/);
    button("Siguientes resultados").click();await waitFor(()=>document.querySelector(".history_search_results").textContent.includes("Otra página"));
    assert.equal(searches.at(-1).cursor,"next");
    button("Resultados anteriores").click();await waitFor(()=>document.querySelector(".history_search_results").textContent.includes("Mensaje antiguo"));
    assert.equal(searches.at(-1).cursor,"first-fence","returning retains the first page snapshot");
    document.querySelector(".history_search_results button").click();await waitFor(()=>document.querySelector('[aria-label="Mensaje encontrado"]'));
    await waitFor(()=>document.activeElement?.dataset.historyAnchor===b);
    assert.equal(contexts.at(-1).message_id,b);assert.equal(document.activeElement.dataset.historyAnchor,b);
    assert.match(document.querySelector(".history_search_context").textContent,/Contexto exacto/);
    assert.equal(document.querySelectorAll("script").length,0);
    button("Volver a los resultados").click();await waitFor(()=>button("Buscar historial"));
    failContext=true;document.querySelector(".history_search_results button").click();await waitFor(()=>document.querySelector('[role="alert"]'));
    assert.equal(document.querySelectorAll(".history_search_results li").length,0,"a denied context cannot leave an old private result on screen");
    failContext=false;
    change(field("Ámbito"),"slack");await settle();await waitFor(()=>field("Canal")?.options.length===2);
    change(field("Canal"),a);await settle();submit();await waitFor(()=>document.querySelector(".history_search_results li"));
    assert.equal(searches.at(-1).filters.channel,a);
    historyApi.search=async()=>({results:[{...row,kind:"page",title:"Página encontrada",target:{kind:"page",channel_id:a,page_id:b,block_id:c}}],first_cursor:"first-page",next_cursor:null});
    submit();await waitFor(()=>document.querySelector(".history_search_results").textContent.includes("Página encontrada"));
    document.querySelector(".history_search_results button").click();await waitFor(()=>button("Abrir página en Slack"));
    await waitFor(()=>document.activeElement?.dataset.historyAnchor===c);
    assert.equal(document.activeElement.dataset.historyAnchor,c);button("Abrir página en Slack").click();await settle();assert.equal(opened[0].block_id,c);
    button("Volver a los resultados").click();await settle();
    let lateReply;
    historyApi.search=async()=>new Promise(resolve=>{lateReply=resolve;});
    submit();await waitFor(()=>lateReply);
    // Keep this synthetic mount present to assert immediate rendering isolation,
    // including a server reply arriving after the active account was replaced.
    globalThis.__historyCore={...globalThis.__historyCore,account:{id:"another-account"}};mount();await settle();
    lateReply({results:[row],first_cursor:"old-account",next_cursor:null});await settle();
    assert.equal(document.querySelectorAll(".history_search_results li").length,0);
    assert.equal(document.querySelectorAll(".history_search_context li").length,0);
    window.dispatchEvent(new CustomEvent("bold:permissions-invalidated",{detail:{authorizationChanged:true}}));await settle();assert.ok(closed>=2);
    globalThis.__historyCore={...globalThis.__historyCore,securityUncertain:true};mount();await settle();
    assert.equal(!!document.querySelector(".history_search_dialog"),false);
    root.render(null);await settle();
    globalThis.__historyCore={...globalThis.__historyCore,securityUncertain:false};
    const savedQueries=[];
    historyApi.search=async filters=>{savedQueries.push(filters);return {results:[{...row,saved:true}],first_cursor:"saved-fence",next_cursor:null};};
    mount({initialSaved:true,initialScope:"all"});await waitFor(()=>button("Quitar de mis guardados"));
    assert.equal(savedQueries[0].saved,true);assert.equal(savedQueries[0].archived,true);
    assert.equal(document.getElementById("history_search_title").textContent,"Mis guardados");
    button("Quitar de mis guardados").click();await waitFor(()=>document.querySelectorAll(".history_search_results li").length===0);
    assert.match(document.querySelector('[role="status"]').textContent,/No hay guardados accesibles/);
    assert.equal(savedQueries.length,1,"personal state changes must not start a refresh loop");
    root.render(null);await settle();
    const threadOpens=[],threadQueries=[];
    historyApi.search=async filters=>{threadQueries.push(filters);return {results:[{...row,channel:{id:a,name:"General"},target:{kind:"channel",channel_id:a,message_id:b,parent_id:null}}],first_cursor:"threads-fence",next_cursor:null};};
    const threadProps={initialThreads:true,initialScope:"slack",onOpenThread:(target,options)=>{threadOpens.push({target,signal:options.signal});return false;}};
    mount(threadProps);await waitFor(()=>button("Abrir hilo en Slack"));
    assert.equal(threadQueries[0].threads,true);assert.equal(threadQueries[0].archived,true);
    assert.equal(document.getElementById("history_search_title").textContent,"Hilos que sigo");
    assert.equal([...field("Tipo").options].some(option=>option.value==="page"),false);
    const beforeClose=closed;button("Abrir hilo en Slack").click();await settle();
    assert.deepEqual(threadOpens[0].target,{channel_id:a,parent_id:b});assert.equal(closed,beforeClose,"cancelled page-leave confirmation keeps search open");
    document.querySelector('.history_search_results li > button').click();await waitFor(()=>document.querySelector('.history_search_context'));
    assert.ok(document.querySelector('.history_search_dialog header').textContent.includes('Abrir hilo en Slack'),'the complete context retains a sticky thread action');
    button('Abrir hilo en Slack').click();await settle();
    assert.deepEqual(threadOpens.at(-1).target,{channel_id:a,parent_id:b},'a root context opens its exact thread, not the current channel window');
    button('Volver a los resultados').click();await waitFor(()=>document.querySelector('.history_search_results'));
    let finishNavigation,navigationSignal;
    mount({...threadProps,onOpenThread:(_,options)=>{navigationSignal=options.signal;return new Promise(resolve=>{finishNavigation=resolve;});}});await settle();
    button("Abrir hilo en Slack").click();await waitFor(()=>finishNavigation);
    globalThis.__historyCore={...globalThis.__historyCore,account:{id:"next-navigation-account"}};mount(threadProps);await settle();
    assert.equal(navigationSignal.aborted,true);const afterIdentityClose=closed;
    finishNavigation(true);await settle();assert.equal(closed,afterIdentityClose,"late navigation cannot close the new identity's view");
    root.render(null);await settle();
    mount({...threadProps,onOpenThread:async()=>{throw {status:404};}});await waitFor(()=>button('Abrir hilo en Slack'));
    button('Abrir hilo en Slack').click();await waitFor(()=>document.querySelector('[role="alert"]'));
    assert.equal(document.querySelectorAll('.history_search_results li').length,0,'a denied thread jump purges the old private results');
    assert.equal(document.querySelectorAll('.history_search_context li').length,0);
    root.render(null);await settle();
    const unreadQueries=[];
    historyApi.search=async filters=>{unreadQueries.push(filters);return {results:[row],first_cursor:'reading-fence',next_cursor:null};};
    failContext=false;
    mount({initialUnread:true,initialScope:'all'});await waitFor(()=>document.querySelector('.history_search_results li'));
    assert.equal(unreadQueries[0].marked_unread,true);assert.equal(unreadQueries[0].archived,true);
    assert.equal(document.getElementById('history_search_title').textContent,'Marcados como no leídos');
    assert.equal([...field('Tipo').options].some(option=>option.value==='page'),false);
    assert.ok(button('Marcar como no leído para mí'),'old history results can be marked without locating them in the recent window');
    root.render(null);await settle();
    const searchCount=unreadQueries.length;
    mount({initialUnread:true,initialTarget:row.target});await waitFor(()=>document.querySelector('.history_search_anchor'));
    assert.equal(unreadQueries.length,searchCount,'a reminder opens exact context directly, not a new search');
    assert.equal(document.querySelector('.history_search_anchor').dataset.historyAnchor,b);
    assert.ok(button('Marcar como no leído para mí'),'query context retains personal reading controls without acknowledging receipts');
    console.log("History search UI passed: explicit queries, filters, stable next/back, exact message/page context, marked-unread history/direct anchor, plain-text rendering, denied-result purge and account/permission isolation.");
}finally{root.unmount();await server.close();dom.window.close();}
