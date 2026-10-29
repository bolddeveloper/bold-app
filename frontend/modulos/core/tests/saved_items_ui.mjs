// Real React controls; API replies are synthetic, not a native-browser ACL test.
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import {JSDOM} from "jsdom";
import {createServer} from "vite";

const dom=new JSDOM('<div id="root"></div>',{url:"http://localhost:5192",pretendToBeVisual:true});
globalThis.BroadcastChannel=undefined;
for(const key of ["window","document","navigator","HTMLElement","Event"])Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
globalThis.__savedCore={account:{id:"a"},activeAssignment:{id:"it",chat_enabled:true},authorizationRevision:1,securityUncertain:false};
const server=await createServer({configFile:false,plugins:[{name:"isolated-saved",enforce:"pre",transform(_,id){if(id.replaceAll("\\","/").endsWith("/core/core_provider.jsx"))return "export const useCore=()=>globalThis.__savedCore;";}}],
    resolve:{dedupe:["react","react-dom","lucide-react"]},esbuild:{jsx:"automatic",jsxImportSource:"react"},cacheDir:path.join(os.tmpdir(),"bold-saved-items-ui"),optimizeDeps:{noDiscovery:true,include:[],entries:[]},server:{middlewareMode:true,hmr:false},appType:"custom"});
const {default:React}=await import("react"),{createRoot}=await import("react-dom/client");
const load=file=>server.ssrLoadModule(`/@fs/${path.resolve(file).replaceAll("\\","/")}`);
const {historyApi}=await load("../mensajeria/history_api.js"),{default:SaveResource}=await load("../mensajeria/save_resource.jsx");
const a="00000000-0000-4000-8000-000000000001",b="00000000-0000-4000-8000-000000000002";
let failing=false,lateResolve=null,lateMode=false,signal=null,changes=[],removed=[];
historyApi.save=async(kind,source,options)=>{
    assert.equal(kind,"chat");assert.equal(source,b);signal=options.signal;
    if(failing)throw {status:429};
    if(lateMode)return new Promise(resolve=>{lateResolve=resolve;});
    return {document_id:a,saved:true};
};
historyApi.unsave=async id=>{removed.push(id);};
const root=createRoot(document.getElementById("root"));
const settle=()=>new Promise(resolve=>setTimeout(resolve,30));
async function waitFor(predicate){const limit=Date.now()+5000;while(!predicate() && Date.now()<limit)await settle();assert.ok(predicate(),"expected saved reference state");}
const mount=props=>root.render(React.createElement(SaveResource,{kind:"chat",sourceId:b,onChange:value=>changes.push(value),...props}));
const pressed=()=>document.querySelector("button")?.getAttribute("aria-pressed");
try{
    mount({initialSaved:true,documentId:a});await waitFor(()=>pressed()==="true");
    document.querySelector("button").click();await waitFor(()=>pressed()==="false");assert.equal(removed[0],a);
    failing=true;document.querySelector("button").click();await waitFor(()=>document.querySelector('[role="alert"]'));
    assert.equal(pressed(),"false","a failed save is never reported as protected");
    failing=false;document.querySelector("button").click();await waitFor(()=>pressed()==="true");
    assert.equal(!!document.querySelector('[role="alert"]'),false);
    root.render(null);await settle();
    lateMode=true;mount();await waitFor(()=>pressed()==="false");document.querySelector("button").click();await waitFor(()=>lateResolve);
    const oldSignal=signal,oldChanges=changes.length;
    globalThis.__savedCore={...globalThis.__savedCore,account:{id:"another"}};mount();await waitFor(()=>oldSignal.aborted);
    lateResolve({document_id:a,saved:true});await settle();assert.equal(changes.length,oldChanges);assert.equal(pressed(),"false");
    globalThis.__savedCore={...globalThis.__savedCore,securityUncertain:true};mount();await settle();assert.equal(!!document.querySelector("button"),false);
    console.log("Saved references UI passed: restored state, removal, failed save/retry, late account reply ignored and uncertainty isolation.");
}finally{root.unmount();await server.close();dom.window.close();}
