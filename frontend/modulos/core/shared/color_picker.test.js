import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import {JSDOM} from "jsdom";
import {createServer} from "vite";

test("shared color picker preserves live and deferred changes, HEX, sliders, screen color and nested dialogs",async()=>{
    const dom=new JSDOM('<div id="root"></div>',{url:"http://localhost",pretendToBeVisual:true});
    const keys=["window","document","navigator","HTMLElement","Element","Event","KeyboardEvent","MutationObserver"];
    const originals=Object.fromEntries(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
    for(const key of keys)Object.defineProperty(globalThis,key,{configurable:true,value:dom.window[key]});
    dom.window.HTMLElement.prototype.attachEvent=function(){};dom.window.HTMLElement.prototype.detachEvent=function(){};
    const server=await createServer({configFile:false,logLevel:"error",resolve:{dedupe:["react","react-dom","lucide-react"]},esbuild:{jsx:"automatic"},cacheDir:path.join(os.tmpdir(),"bold-shared-color-picker-ui"),optimizeDeps:{noDiscovery:true,entries:[]},server:{middlewareMode:true,hmr:false},appType:"custom"});
    let root;
    try {
        const {default:React}=await import("react"),{createRoot}=await import("react-dom/client");
        const {default:ColorPicker}=await server.ssrLoadModule(path.resolve("shared/color_picker.jsx"));
        const changes=[];let opened=0,eyedropperCancel=false;
        dom.window.EyeDropper=class {async open(){if(eyedropperCancel)throw new Error("Cancelled");return {sRGBHex:"#3d6489"};}};
        function Harness({commitOnly=false,disabled=false,nested=false}){
            const [value,setValue]=React.useState("#0000ff");
            const picker=React.createElement(ColorPicker,{name:"color",label:"Color de prueba",value,disabled,commitOnly,onOpen:()=>opened++,onChange:color=>{changes.push(color);setValue(color);}});
            return nested ? React.createElement("dialog",{open:true,"aria-label":"Editor anfitrión"},picker) : picker;
        }
        root=createRoot(document.getElementById("root"));
        const wait=async predicate=>{const end=Date.now()+3000;while(!predicate()&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,20));assert.ok(predicate());};
        const field=label=>document.querySelector(`[aria-label="${label}"]`);
        const input=(label,value)=>{const node=field(label);Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,"value").set.call(node,value);node.dispatchEvent(new Event("input",{bubbles:true}));};
        const open=async()=>{field("Color de prueba").focus();field("Color de prueba").click();await wait(()=>document.querySelector(".bold_color_panel"));};
        const done=()=>document.querySelector(".bold_color_done").click();
        root.render(React.createElement(Harness));await wait(()=>field("Color de prueba"));await open();assert.equal(opened,1);
        input("Color hexadecimal","#00ff00");await wait(()=>changes.at(-1)==="#00ff00");assert.equal(document.querySelector('[name="color"]').value,"#00ff00");
        input("Brillo","50");await wait(()=>changes.at(-1)==="#008000");
        input("Tono","0");await wait(()=>changes.at(-1)==="#800000");
        input("Saturación","0");await wait(()=>changes.at(-1)==="#808080");
        field("Usar #ef1f2d").click();await wait(()=>field("Usar #ef1f2d").getAttribute("aria-pressed")==="true");
        const validChanges=changes.length;
        input("Color hexadecimal","#oops");field("Color hexadecimal").dispatchEvent(new Event("focusout",{bubbles:true}));
        await wait(()=>document.querySelector('[role="alert"]'));assert.equal(changes.length,validChanges);assert.equal(document.querySelector('[name="color"]').value,"#ef1f2d");assert.equal(field("Color hexadecimal").value,"#ef1f2d");
        field("Tomar color de pantalla").click();await wait(()=>changes.at(-1)==="#3d6489");
        eyedropperCancel=true;const beforeCancel=changes.length;field("Tomar color de pantalla").click();await new Promise(resolve=>setTimeout(resolve,20));assert.equal(changes.length,beforeCancel);
        document.dispatchEvent(new dom.window.KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}));await wait(()=>!document.querySelector(".bold_color_panel"));assert.equal(document.activeElement,field("Color de prueba"));
        changes.length=0;
        root.render(React.createElement(Harness,{key:"deferred",commitOnly:true}));await wait(()=>document.querySelector('[name="color"]').value==="#0000ff");await open();
        input("Brillo","50");await wait(()=>field("Color hexadecimal").value==="#000080");assert.equal(changes.length,0);
        done();await wait(()=>!document.querySelector(".bold_color_panel"));assert.deepEqual(changes,["#000080"]);
        await open();done();await wait(()=>!document.querySelector(".bold_color_panel"));assert.equal(changes.length,1,"Closing unchanged does not save twice");
        await open();field("Usar #318246").click();document.querySelector(".bold_control_overlay").dispatchEvent(new Event("pointerdown",{bubbles:true}));await wait(()=>!document.querySelector(".bold_color_panel"));assert.deepEqual(changes,["#000080","#318246"]);
        root.render(React.createElement(Harness,{key:"native",nested:true}));await wait(()=>document.querySelector("dialog[open]"));await open();
        assert.ok(document.querySelector("dialog[open] .bold_control_overlay"),"Native dialog editors retain their top layer");
        field("Cerrar selector de color").click();await wait(()=>!document.querySelector(".bold_color_panel"));assert.ok(document.querySelector("dialog[open]"));
        const viewport=new dom.window.EventTarget();Object.assign(viewport,{width:320,height:360,offsetLeft:0,offsetTop:0});
        Object.defineProperty(dom.window,"visualViewport",{configurable:true,value:viewport});
        field("Color de prueba").getBoundingClientRect=()=>({left:300,top:330,bottom:366});
        await open();const panel=document.querySelector(".bold_color_panel");
        Object.defineProperty(panel,"offsetWidth",{value:280});Object.defineProperty(panel,"offsetHeight",{value:531});
        viewport.dispatchEvent(new Event("resize"));await wait(()=>panel.style.left==="28px");
        assert.equal(panel.style.top,"12px");assert.equal(panel.style.maxHeight,"336px","Short viewports scroll within their visible bounds");
        done();await wait(()=>!document.querySelector(".bold_color_panel"));
        root.render(React.createElement(Harness,{key:"disabled",disabled:true}));await wait(()=>field("Color de prueba").disabled);field("Color de prueba").click();assert.equal(document.querySelector(".bold_color_panel"),null);
    } finally {
        root?.unmount();await new Promise(resolve=>setTimeout(resolve,30));await server.close();dom.window.close();
        for(const key of keys){if(originals[key])Object.defineProperty(globalThis,key,originals[key]);else delete globalThis[key];}
    }
});
