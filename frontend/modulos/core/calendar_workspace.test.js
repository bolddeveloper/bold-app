import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import {JSDOM} from "jsdom";
import {createServer} from "vite";

test("calendar navigation, compact sidebar, create menu and read-only access stay connected",async()=>{
    const dom=new JSDOM('<div id="root"></div>',{url:"http://localhost",pretendToBeVisual:true});
    const keys=["window","document","navigator","HTMLElement","Element","Event","KeyboardEvent","MutationObserver","DOMParser","localStorage","ResizeObserver","BroadcastChannel","addEventListener","removeEventListener"];
    const originals=Object.fromEntries(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
    for(const key of keys)Object.defineProperty(globalThis,key,{configurable:true,value:key==="ResizeObserver"?class{observe(){}disconnect(){}}:key.endsWith("EventListener")?dom.window[key].bind(dom.window):dom.window[key]});
    window.matchMedia=()=>({matches:true,addEventListener(){},removeEventListener(){}});
    HTMLElement.prototype.attachEvent=function(){};HTMLElement.prototype.detachEvent=function(){};
    HTMLElement.prototype.showPopover=function(){this.dataset.open="true";};
    HTMLElement.prototype.hidePopover=function(){delete this.dataset.open;};
    dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
    dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
    globalThis.calendarWrites=[];
    const server=await createServer({configFile:false,logLevel:"error",plugins:[{name:"calendar-ui-fixture",enforce:"pre",transform(source,id){
        const file=id.replaceAll("\\","/");
        if(file.endsWith("/core/core_provider.jsx"))return 'export const useCore=()=>({account:{id:"fixture"},directory:[],activeAssignment:{id:"fixture"}});';
        if(file.endsWith("/tareas/src/task_app.jsx"))return 'export const CalendarDateField=()=>null;';
        if(file.endsWith("/calendario/calendar_api.js"))return `export const localCalendarsApi={}; export const calendarApi={}; export const localCalendarApi=()=>({events:async()=>({events:[{id:'event',summary:'Preparar campaña',kind:'task',color:'#e73535',start:{dateTime:new Date().toISOString()},end:{dateTime:new Date(Date.now()+3600000).toISOString()}}]}),create:async body=>{globalThis.calendarWrites.push(body);return body;}});`;
    }}],resolve:{dedupe:["react","react-dom","lucide-react","sweetalert2"]},esbuild:{jsx:"automatic"},cacheDir:path.join(os.tmpdir(),"bold-calendar-workspace-ui"),optimizeDeps:{noDiscovery:true,entries:[]},server:{middlewareMode:true,hmr:false},appType:"custom"});
    let root;
    try{
        const {default:React}=await import("react"),{createRoot}=await import("react-dom/client");
        const {CalendarView}=await server.ssrLoadModule(path.resolve("../calendario/calendar_module.jsx"));
        root=createRoot(document.getElementById("root"));
        const calendar={id:"test",name:"Producción",can_edit:true,members:[]};
        const wait=async predicate=>{const end=Date.now()+4000;while(!predicate()&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,15));assert.ok(predicate());};
        const button=name=>[...document.querySelectorAll("button")].find(e=>e.textContent.trim()===name);
        root.render(React.createElement(CalendarView,{localCalendar:calendar}));
        await wait(()=>document.querySelector(".bold_calendar_time_scroll"));
        assert.ok(document.getElementById("bold-calendar-sidebar").hidden,"Phone starts with mini calendar closed");
        document.querySelector(".bold_calendar_sidebar_toggle").click();
        await wait(()=>!document.getElementById("bold-calendar-sidebar").hidden);
        button("Mes").click();await wait(()=>document.querySelector(".bold_calendar_grid.is_month"));
        assert.ok([...document.querySelectorAll(".bold_calendar_day.is_blank")].every(e=>!e.textContent.trim()),"Adjacent months remain blank");
        button("Agenda").click();await wait(()=>document.querySelector(".bold_calendar_agenda_event"));
        assert.match(document.querySelector(".bold_calendar_agenda").textContent,/Preparar campaña/);
        button("Día").click();await wait(()=>document.querySelectorAll(".bold_calendar_time_column").length===1);
        document.querySelector(".bold_calendar_create").click();await wait(()=>document.querySelector(".bold_calendar_create_menu"));
        document.querySelector(".bold_calendar_create_menu").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}));
        await wait(()=>!document.querySelector(".bold_calendar_create_menu"));
        assert.equal(document.activeElement,document.querySelector(".bold_calendar_create"));
        document.querySelector(".bold_calendar_create").click();await wait(()=>button("Tarea"));button("Tarea").click();
        await wait(()=>document.querySelector(".bold_calendar_local_form"));
        assert.equal(document.querySelector('[aria-label="Tipo"] [aria-pressed=true]').textContent,"Tarea");
        document.querySelector('.bold_calendar_native_dialog [aria-label="Cerrar"]').click();await wait(()=>!document.querySelector(".bold_calendar_native_dialog"));
        assert.equal(globalThis.calendarWrites.length,0,"Opening and dismissing a draft writes no events");
        root.render(React.createElement(CalendarView,{key:"reader",localCalendar:{...calendar,can_edit:false}}));
        await wait(()=>document.querySelector(".bold_calendar_create")?.disabled);
        assert.equal(document.querySelectorAll('.bold_calendar_time_column[role="button"]').length,0,"Read-only cells cannot create events");
    }finally{
        root?.unmount();await new Promise(resolve=>setTimeout(resolve,20));await server.close();dom.window.close();delete globalThis.calendarWrites;
        for(const[key,value]of Object.entries(originals)){if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];}
    }
});
