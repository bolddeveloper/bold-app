// Isolated two-surface UI contracts. No real account, Drive or network calls.
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import {JSDOM} from "jsdom";
import {createServer} from "vite";

const dom=new JSDOM('<div id="root"></div>',{url:"https://bold.invalid",pretendToBeVisual:true});
globalThis.BroadcastChannel=undefined;
for(const key of ["window","document","navigator","HTMLElement","Element","Event","File","FormData","Blob","MutationObserver"])
    Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
globalThis.location=dom.window.location;
const server=await createServer({configFile:false,resolve:{dedupe:["react","react-dom","lucide-react","qrcode"]},esbuild:{jsx:"automatic",jsxImportSource:"react"},
    cacheDir:path.join(os.tmpdir(),"bold-phone-ui"),optimizeDeps:{noDiscovery:true,include:[],entries:[]},server:{middlewareMode:true,hmr:false},appType:"custom"});
const load=file=>server.ssrLoadModule(`/@fs/${path.resolve(file).replaceAll("\\","/")}`);
const {default:React}=await import("react"), {createRoot}=await import("react-dom/client");
const root=createRoot(document.getElementById("root"));
const pause=()=>new Promise(resolve=>setTimeout(resolve,30));
async function until(predicate,timeout=8000){const end=Date.now()+timeout;while(!predicate() && Date.now()<end) await pause();assert.ok(predicate(),"expected phone UI state");}
const button=text=>[...document.querySelectorAll("button")].find(node=>node.textContent.includes(text));
let phase="waiting",cancelled=0,approved=0,sealed=0,received=[],closed=0,uploads=0;
const id="11111111-2222-4333-8444-555555555555", image="11111111-2222-4333-8444-555555555556";
const manifest=()=>({id,paired:phase!=="waiting",pairing_code:"123456",approved:phase==="approved",images:phase==="approved"?[{id:image,size:5}]:[],expires_at:new Date(Date.now()+600000).toISOString()});
try {
    const {phoneApi}=await load("../mensajeria/phone_transfer_api.js");
    Object.assign(phoneApi,{create:async()=>({...manifest(),claim_token:"a".repeat(43)}),status:async()=>manifest(),
        approve:async(_,code)=>{assert.equal(code,"123456");approved++;phase="approved";return manifest();},
        seal:async()=>{sealed++;return manifest();},image:async()=>new Blob(["pixel"],{type:"image/webp"}),cancel:async()=>{cancelled++;}});
    const {default:Desktop}=await load("../mensajeria/phone_transfer.jsx");
    root.render(React.createElement(Desktop,{target:{conversation_id:id},onFiles:files=>{received=files;return true;},onClose:()=>closed++}));
    await until(()=>button("Generar QR"));button("Generar QR").click();
    await until(()=>document.querySelector(".phone_transfer_qr"));
    assert.ok(document.querySelector(".phone_transfer_qr").src.startsWith("data:image/png"));
    assert.equal(received.length,0); phase="paired";
    await until(()=>button("Aprobar este teléfono"));button("Aprobar este teléfono").click();
    await until(()=>button("Añadir 1 al borrador"));button("Añadir 1 al borrador").click();
    await until(()=>closed===1);assert.equal(approved,1);assert.equal(sealed,1);assert.equal(received.length,1);assert.equal(received[0].type,"image/webp");
    root.render(null);await pause();assert.ok(cancelled>=1);
    globalThis.fetch=async(url,options)=>{
        assert.equal(options.credentials,"omit");assert.ok(options.headers.Authorization.startsWith("Bearer "));
        if(url.endsWith("claim/"))return{ok:true,json:async()=>({pairing_code:"123456",expires_at:new Date(Date.now()+600000).toISOString()})};
        if(options.method==="POST"){uploads++;assert.ok(options.body.get("client_id"));return{ok:true,json:async()=>({id:image})};}
        return{ok:true,json:async()=>({approved:true,count:0})};
    };
    const {default:Mobile}=await load("../mensajeria/phone_upload_page.jsx");
    root.render(React.createElement(Mobile,{link:{id,token:"a".repeat(43)}}));
    await until(()=>button("Solicitar vinculación"));button("Solicitar vinculación").click();
    await until(()=>button("Galería"));assert.equal(uploads,0);
    const input=document.querySelector('input[multiple]');
    Object.defineProperty(input,"files",{value:[new File(["test"],"photo.png",{type:"image/png"})],configurable:true});
    input.dispatchEvent(new Event("change",{bubbles:true}));
    await until(()=>document.querySelector(".phone_transfer_files li"));button("Transferir imágenes").click();
    await until(()=>document.body.textContent.includes("Imágenes transferidas."));assert.equal(uploads,1);
    assert.match(document.body.textContent,/todavía no se enviaron al chat/);
    assert.equal(button("Transferir imágenes").disabled,true);
    console.log("Phone UI: QR, pairing, approval, sealed import, gallery and explicit upload passed.");
} finally {root.unmount();await server.close();dom.window.close();}
