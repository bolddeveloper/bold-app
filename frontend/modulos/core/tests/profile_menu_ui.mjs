// Isolated account-menu checks. No real account, presence writes or logout.
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import {JSDOM} from "jsdom";
import {createServer} from "vite";
const dom=new JSDOM('<div id="root"></div>',{url:"http://localhost",pretendToBeVisual:true});
for(const key of ["window","document","navigator","HTMLElement","Element","CustomEvent","Event","localStorage"])Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
globalThis.BroadcastChannel=undefined;
window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
let logouts=0,reads=0;const profile=[],changes=[];
globalThis.__profileMenuCore={account:{email:"demo@example.test"},employee:{full_name:"Cuenta de prueba"},activeAssignment:{id:"one",name:"Demo",unit_name:"Dirección",job_role_title:"Responsable",initials:"DP"},assignments:[{id:"one",unit_name:"Dirección",job_role_title:"Responsable"},{id:"two",unit_name:"Producción",job_role_title:"Colaborador"}],logout:()=>logouts++};
const server=await createServer({configFile:false,plugins:[{name:"profile-menu-test",enforce:"pre",transform(_,file){if(file.replaceAll("\\","/").endsWith("/core/core_provider.jsx"))return "export const useCore=()=>globalThis.__profileMenuCore;";}}],resolve:{dedupe:["react","react-dom","lucide-react"]},esbuild:{jsx:"automatic"},cacheDir:path.join(os.tmpdir(),"bold-profile-menu-ui"),optimizeDeps:{noDiscovery:true,entries:[]},server:{middlewareMode:true,hmr:false},appType:"custom"});
const load=file=>server.ssrLoadModule(`/@fs/${path.resolve(file).replaceAll("\\","/")}`);
const {default:React}=await import("react"),{createRoot}=await import("react-dom/client"),{ProfileQuickMenu}=await load("shared/profile_menu.jsx"),{http}=await load("http_client.js");
http.request=async(url,options)=>{assert.equal(url,"/api/v2/auth/presence/");assert.ok(!options.method,"opening availability must not change it");reads++;return {status:"online"};};
const root=createRoot(document.getElementById("root")),settle=()=>new Promise(resolve=>setTimeout(resolve,30)),wait=async check=>{for(let i=0;i<100&&!check();i++)await settle();assert.ok(check());};
function Preview(){const [open,setOpen]=React.useState(false),trigger=React.useRef(null);return React.createElement(React.Fragment,null,React.createElement("button",{ref:trigger,onClick:()=>setOpen(true)},"Abrir cuenta"),open&&React.createElement(ProfileQuickMenu,{anchor:trigger.current,close:()=>setOpen(false),openProfile:(...args)=>profile.push(args),changeDepartment:async id=>{changes.push(id);return true;}}));}
const button=label=>[...document.querySelectorAll("button")].find(node=>node.textContent===label);
const open=async()=>{button("Abrir cuenta").focus();button("Abrir cuenta").click();await wait(()=>document.querySelector(".bold_profile_quick"));};
try{
 root.render(React.createElement(Preview));await wait(()=>button("Abrir cuenta"));await open();
 assert.equal(document.querySelector(".bold_profile_banner"),null);assert.match(document.querySelector(".bold_profile_quick_identity").textContent,/demo@example.test/);
 button("Mi disponibilidad").dispatchEvent(new window.MouseEvent("mouseover",{bubbles:true}));await settle();assert.equal(reads,0,"hover does not open panels unexpectedly");
 button("Mi disponibilidad").click();await wait(()=>document.querySelector('[aria-label="Elegir disponibilidad"] [aria-pressed="true"]'));
 assert.equal(reads,1);assert.equal(button("Mi disponibilidad").getAttribute("aria-expanded"),"true");
 button("Mi disponibilidad").dispatchEvent(new window.KeyboardEvent("keydown",{key:"Escape",bubbles:true}));await wait(()=>!document.querySelector('[aria-label="Elegir disponibilidad"]'));
 assert.ok(document.querySelector(".bold_profile_quick"));assert.equal(document.activeElement,button("Mi disponibilidad"));
 button("Cambiar departamento").click();await wait(()=>document.querySelector(".bold_profile_departments"));
 assert.equal(document.querySelector('.bold_profile_departments [aria-pressed="true"] strong').textContent,"Dirección");
 document.querySelectorAll(".bold_profile_departments>button")[1].click();await wait(()=>!document.querySelector(".bold_profile_quick"));assert.deepEqual(changes,["two"]);
 await open();button("Editar perfil").click();await wait(()=>!document.querySelector(".bold_profile_quick"));assert.deepEqual(profile.pop(),[true]);
 await open();button("Novedades").click();await wait(()=>!document.querySelector(".bold_profile_quick"));assert.deepEqual(profile.pop(),[false,"news"]);
 await open();button("Cerrar sesión").click();await wait(()=>!document.querySelector(".bold_profile_quick"));assert.equal(logouts,1);
 await open();document.querySelector('[aria-label="Cerrar perfil"]').click();await wait(()=>!document.querySelector(".bold_profile_quick"));assert.equal(document.activeElement,button("Abrir cuenta"));
 console.log("Profile menu: compact identity, explicit submenus, nested Escape, assignment routing, settings and mock logout passed.");
}finally{root.unmount();await server.close();dom.window.close();}
