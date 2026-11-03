import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import {JSDOM} from "jsdom";
import {createServer} from "vite";

test("compact header keeps search, theme and navigation together with accessible secondary actions", async () => {
    const dom = new JSDOM('<div id="root"></div>', {url:"http://localhost", pretendToBeVisual:true});
    const keys = ["window","document","navigator","HTMLElement","Element","Event","CustomEvent","MutationObserver","localStorage","sessionStorage","BroadcastChannel"];
    const originals = Object.fromEntries(keys.map(key => [key,Object.getOwnPropertyDescriptor(globalThis,key)]));
    for (const key of keys) Object.defineProperty(globalThis,key,{configurable:true,value:dom.window[key]});
    dom.window.HTMLElement.prototype.attachEvent = function() {};
    dom.window.HTMLElement.prototype.detachEvent = function() {};
    const server = await createServer({configFile:false,logLevel:"error",define:{"import.meta.env.VITE_USE_REAL_BACKEND":'"false"'},resolve:{dedupe:["react","react-dom","lucide-react","sweetalert2","driver.js"]},esbuild:{jsx:"automatic"},cacheDir:path.join(os.tmpdir(),"bold-header-mobile-ui"),optimizeDeps:{noDiscovery:true,entries:[]},server:{middlewareMode:true,hmr:false},appType:"custom"});
    let root;
    try {
        const {default:React} = await import("react"), {createRoot} = await import("react-dom/client");
        const {TopBar} = await server.ssrLoadModule(path.resolve("app_shell.jsx"));
        let compact = true, detailOpen = false, menus = 0, backs = 0, bells = 0, members = 0, newsAnchor, destination;
        function Harness() {
            const [query,setQuery] = React.useState(""), [dark,setDark] = React.useState(true);
            return React.createElement(TopBar,{compact,detailOpen,onBack:()=>backs++,set_is_sidebar_open:()=>menus++,navigation_items:[{id:"calendar",label:"Calendario",icon:"calendar"}],search_query:query,set_search_query:setQuery,is_dark_mode:dark,set_is_dark_mode:setDark,notifications:[{is_read:false}],handle_toggle_notifications:()=>bells++,toggleMembers:()=>members++,onOpenNews:event=>{newsAnchor=event.currentTarget;},unreadNews:true,unreadChats:true,handle_search_navigate:result=>{destination=result;}});
        }
        root = createRoot(document.getElementById("root"));
        const wait = async predicate => {const end=Date.now()+4000;while(!predicate() && Date.now()<end) await new Promise(resolve=>setTimeout(resolve,20));assert.ok(predicate());};
        const label = name => document.querySelector(`[aria-label="${name}"]`);
        const action = name => [...document.querySelectorAll(".header_mobile_menu button")].find(item=>item.textContent===name);
        root.render(React.createElement(Harness));
        await wait(()=>label("Buscar en BOLD"));
        assert.equal(document.querySelectorAll("header").length,1);
        assert.equal(label("Buscar en BOLD").placeholder,"Buscar…");
        label("Abrir navegacion").click(); assert.equal(menus,1);
        label("Activar modo claro").click(); await wait(()=>label("Activar modo oscuro"));
        label("Notificaciones").click(); assert.equal(bells,1);
        const details=document.querySelector("details"), summary=details.querySelector("summary");
        summary.click(); assert.ok(details.open);
        summary.dispatchEvent(new dom.window.KeyboardEvent("keydown",{key:"Escape",bubbles:true}));
        assert.equal(details.open,false); assert.equal(document.activeElement,summary);
        summary.click(); document.body.dispatchEvent(new Event("pointerdown",{bubbles:true})); assert.equal(details.open,false);
        summary.click(); action("Novedades").click();
        assert.equal(details.open,false); assert.equal(newsAnchor,summary); assert.ok(newsAnchor.isConnected); assert.equal(document.activeElement,summary);
        summary.click(); action("Equipo").click(); assert.equal(members,1); assert.equal(details.open,false);
        const input=label("Buscar en BOLD");
        Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,"value").set.call(input,"Calendario");
        input.dispatchEvent(new Event("input",{bubbles:true}));
        await wait(()=>document.querySelector('[role="option"]'));
        input.dispatchEvent(new dom.window.KeyboardEvent("keydown",{key:"Enter",bubbles:true}));
        await wait(()=>destination && !input.value); assert.equal(destination.module,"calendar");
        detailOpen=true;root.render(React.createElement(Harness));await wait(()=>label("Volver"));label("Volver").click();assert.equal(backs,1);
        compact=false;root.render(React.createElement(Harness));await wait(()=>label("Novedades sin leer"));
        assert.equal(document.querySelector("details"),null);assert.equal(label("Buscar en BOLD").placeholder,"Buscar en BOLD…");
        assert.ok(label("Mostrar lista de miembros, mensajes sin leer"));
    } finally {
        root?.unmount(); await new Promise(resolve=>setTimeout(resolve,30)); await server.close(); dom.window.close();
        for (const key of keys) {if(originals[key]) Object.defineProperty(globalThis,key,originals[key]);else delete globalThis[key];}
    }
});
