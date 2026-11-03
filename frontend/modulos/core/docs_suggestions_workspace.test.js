import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import {readFileSync} from "node:fs";
import {JSDOM} from "jsdom";
import {createServer} from "vite";
import {entranceModule,isShellModuleAllowed} from "./shell_navigation_state.js";

test("Marcas is removed from the shell and saved navigation falls back safely",()=>{
    const source=readFileSync(new URL("./app.jsx",import.meta.url),"utf8");
    assert.doesNotMatch(source,/BrandsModule|id:\s*"brands"|brands:\s*</);
    const navigation=[{id:"home",default:true},{id:"docs"},{id:"suggestions"}];
    assert.equal(isShellModuleAllowed("brands",navigation),false);
    assert.equal(entranceModule(navigation,"brands"),"home");
});

test("Docs creation, suggestion filters and report details preserve their existing actions",async()=>{
    const dom=new JSDOM('<div id="root"></div>',{url:"http://localhost",pretendToBeVisual:true});
    const keys=["window","document","navigator","HTMLElement","Element","Event","CustomEvent","KeyboardEvent","MutationObserver","DOMParser","localStorage","ResizeObserver","BroadcastChannel","addEventListener","removeEventListener"];
    const originals=Object.fromEntries(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
    for(const key of keys)Object.defineProperty(globalThis,key,{configurable:true,value:key==="ResizeObserver"?class{observe(){}disconnect(){}}:key.endsWith("EventListener")?dom.window[key].bind(dom.window):dom.window[key]});
    HTMLElement.prototype.attachEvent=function(){};HTMLElement.prototype.detachEvent=function(){};
    HTMLElement.prototype.showPopover=function(){};HTMLElement.prototype.hidePopover=function(){};
    dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
    const calls=[];
    globalThis.docsReviewShell={workspace_tab_state:{tabs:[],active:null},sync_workspace_account(){},open_workspace_tab:file=>calls.push(["open",file.id])};
    const report={id:"report-0001",title:"Revisar calendario",message:"Descripción reproducible del reporte",author_assignment:"me",author_name:"Persona de prueba",unit_name:"IT",category:"bug",priority:"medium",status:"new",source_module:"calendar",created_at:"2026-11-02T12:00:00Z",can_manage:true};
    globalThis.docsReviewApi={connection:async()=>({connected:true,editors_enabled:true,email:"fixture@example.invalid"}),create:async payload=>{calls.push(["create",payload]);return{id:"created"};}};
    globalThis.suggestionsReviewApi={list:async filters=>{calls.push(["list",filters]);return{results:[report],count:1,next:null};},create:async payload=>{calls.push(["report",payload]);return report;}};
    const server=await createServer({configFile:false,logLevel:"error",plugins:[{name:"docs-suggestions-fixture",enforce:"pre",transform(source,id){
        const file=id.replaceAll("\\","/");
        if(file.endsWith("/core/core_provider.jsx"))return 'export const useCore=()=>({account:{id:"account",is_superuser:true},activeAssignment:{id:"me"},directory:[],units:[]});';
        if(file.endsWith("/core/app_shell.jsx"))return 'export const useShell=()=>globalThis.docsReviewShell;';
        if(file.endsWith("/docs/workspace_api.js"))return 'export const workspaceApi=globalThis.docsReviewApi;';
        if(file.endsWith("/sugerencias/suggestions_api.js"))return 'export const suggestionsApi=globalThis.suggestionsReviewApi;';
        if(file.endsWith("/docs/drive_module.jsx"))return 'import React from "react"; export default function Drive(){return null;} export const DriveUploadDialog=()=>null; export const DriveFolderPicker=({submit,label,disabled})=>React.createElement("button",{type:"button",disabled,onClick:()=>submit("folder")},label);';
        if(file.endsWith("/docs/workspace_editor.jsx"))return 'export default function Editor(){return null;}';
    }}],resolve:{dedupe:["react","react-dom","lucide-react","sweetalert2"]},esbuild:{jsx:"automatic"},cacheDir:path.join(os.tmpdir(),"bold-docs-suggestions-ui"),optimizeDeps:{noDiscovery:true,entries:[]},server:{middlewareMode:true,hmr:false},appType:"custom"});
    let root;
    try{
        const {default:React}=await import("react"),{createRoot}=await import("react-dom/client");
        const {default:WorkspaceModule}=await server.ssrLoadModule(path.resolve("../docs/workspace_module.jsx"));
        const {default:SuggestionsModule}=await server.ssrLoadModule(path.resolve("../sugerencias/suggestions_module.jsx"));
        root=createRoot(document.getElementById("root"));
        const wait=async predicate=>{const end=Date.now()+4000;while(!predicate()&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,15));assert.ok(predicate());};
        const button=name=>[...document.querySelectorAll("button")].find(e=>e.textContent.trim()===name);
        const change=(element,value)=>{Object.getOwnPropertyDescriptor(dom.window[element.tagName==="SELECT"?"HTMLSelectElement":"HTMLInputElement"].prototype,"value").set.call(element,value);element.dispatchEvent(new Event(element.tagName==="SELECT"?"change":"input",{bubbles:true}));};
        root.render(React.createElement(WorkspaceModule,{mode:"docs"}));await wait(()=>document.querySelectorAll(".workspace_types article").length===3);
        assert.equal([...document.querySelectorAll("button")].filter(e=>e.textContent==="Subir archivo").length,1);
        for(const label of ["Crear documentos","Crear hojas de cálculo","Crear presentaciones"]){
            button(label).click();await wait(()=>document.querySelector(".docs_create_dialog"));
            document.querySelector('[aria-label="Cerrar creación de archivo"]').click();await wait(()=>!document.querySelector(".docs_create_dialog"));
        }
        assert.equal(calls.length,0,"Opening a file dialog creates no file");
        button("Crear documentos").click();await wait(()=>button("Crear aquí"));button("Crear aquí").click();
        await wait(()=>calls.some(row=>row[0]==="open"));assert.deepEqual(calls[0],["create",{type:"docs",name:"Sin título",parent:"folder"}]);
        root.render(React.createElement(SuggestionsModule));await wait(()=>button("Enviar reporte"));
        change(document.querySelector('input[name="title"]'),"Reporte de prueba");document.querySelector(".suggestions_form").dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));
        await wait(()=>document.querySelector(".suggestions_error"));assert.ok(!calls.some(row=>row[0]==="report"),"Validation prevents empty descriptions");
        button("Bandeja IT").click();await wait(()=>document.querySelector(".suggestions_report_open"));
        button("Filtros").click();await wait(()=>document.querySelector(".suggestions_filters_popup"));
        change(document.querySelector(".suggestions_filters_popup select"),"idea");await wait(()=>calls.at(-1)?.[1]?.category==="idea");
        document.querySelector(".suggestions_filters_popup").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}));await wait(()=>!document.querySelector(".suggestions_filters_popup"));
        assert.equal(document.activeElement,button("Filtros1"));
        document.querySelector(".suggestions_report_open").click();await wait(()=>document.querySelector(".suggestions_dialog"));
        assert.match(document.querySelector(".suggestions_dialog").textContent,/Seguimiento IT/);
        document.querySelector('[aria-label="Cerrar reporte"]').click();await wait(()=>!document.querySelector(".suggestions_dialog"));
    }finally{
        root?.unmount();await new Promise(resolve=>setTimeout(resolve,20));await server.close();dom.window.close();
        for(const key of ["docsReviewShell","docsReviewApi","suggestionsReviewApi"])delete globalThis[key];
        for(const[key,value]of Object.entries(originals)){if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];}
    }
});
