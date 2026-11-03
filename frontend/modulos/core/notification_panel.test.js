import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import {JSDOM} from "jsdom";
import {createServer} from "vite";

test("header panels filter notifications and open the latest three patch notes", async () => {
    const dom = new JSDOM('<div id="root"></div>',{url:"http://localhost",pretendToBeVisual:true});
    const names = ["window","document","navigator","HTMLElement","Element","Event","MutationObserver","BroadcastChannel"];
    const descriptors = Object.fromEntries(names.map(key => [key,Object.getOwnPropertyDescriptor(globalThis,key)]));
    for(const key of names) Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
    const server = await createServer({root:path.resolve("."),configFile:false,resolve:{dedupe:["react","react-dom","lucide-react"]},esbuild:{jsx:"automatic",jsxImportSource:"react"},cacheDir:path.join(os.tmpdir(),"bold-notification-ui"),optimizeDeps:{noDiscovery:true,entries:[]},server:{middlewareMode:true,hmr:false},appType:"custom"});
    const {default:React} = await import("react"), {createRoot} = await import("react-dom/client");
    const {NotificationPanel} = await server.ssrLoadModule(path.resolve("notification_panel.jsx"));
    const {HeaderNewsPanel} = await server.ssrLoadModule(path.resolve("header_news.jsx"));
    const {NoteViewer} = await server.ssrLoadModule(path.resolve("../perfil/news_preferences.jsx"));
    const {releaseNotes} = await server.ssrLoadModule(path.resolve("../perfil/release_notes.js"));
    const root = createRoot(document.getElementById("root"));
    const settle = () => new Promise(resolve => setTimeout(resolve,25));
    const wait = async predicate => {for(let i=0;i<80&&!predicate();i++) await settle(); assert.ok(predicate());};
    let rows = [{id:"mention",actor_name:"Alex López",type:"comment.mentioned",title:"Mención",task:"task",body:"Revisar entrega",created_at:new Date().toISOString()}, {id:"update",title:"Actualización",body:"Cambio guardado",is_read:true}];
    let cleared=0, selected="", failure=false, replied="", openedInbox=0;
    function Preview(){const [items,setItems]=React.useState(rows);return React.createElement(NotificationPanel,{notifications:items,
        onSelect:item=>selected=item.id,onClose:()=>{},onSettings:()=>{},onReply:item=>replied=item.id,onInbox:()=>openedInbox++,
        onRead:async(id,is_read)=>setItems(current=>current.map(row=>row.id===id?{...row,is_read}:row)),
        onReadAll:async()=>setItems(current=>current.map(row=>({...row,is_read:true}))),
        onDismiss:async id=>{if(failure)throw new Error("Sin conexión");setItems(current=>current.filter(row=>row.id!==id));},
        onClear:async()=>{cleared++;setItems([]);},
    });}
    const button = label => [...document.querySelectorAll('button')].find(e=>e.textContent===label || e.getAttribute('aria-label')===label);
    try {
        root.render(React.createElement(Preview));await wait(()=>document.querySelectorAll('article').length===2);
        assert.match(document.querySelector('article').textContent,/Alex López/);
        assert.equal(document.querySelector('.notification_avatar').textContent,'AL');
        document.querySelector('.notification_open').click();assert.equal(selected,'mention');
        button('Responder: Mención').click();assert.equal(replied,'mention');button('Abrir bandeja').click();assert.equal(openedInbox,1);
        button('Menciones').click();await wait(()=>document.querySelectorAll('article').length===1);
        assert.match(document.querySelector('article').textContent,/Te mencionó en una tarea/);
        button('Marcar como leída: Mención').click();await settle();
        button('Sin leer').click();await wait(()=>document.querySelector('[role="status"]'));
        assert.match(document.body.textContent,/Todo al día/);
        button('Todas').click();await wait(()=>document.querySelectorAll('article').length===2);
        failure=true;button('Quitar aviso: Mención').click();await wait(()=>document.querySelector('[role="alert"]'));
        assert.match(document.querySelector('[role="alert"]').textContent,/Sin conexión/);assert.equal(document.querySelectorAll('article').length,2);
        failure=false;button('Quitar aviso: Mención').click();await wait(()=>document.querySelectorAll('article').length===1);
        button('Limpiar todo').click();await wait(()=>button('Cancelar'));assert.equal(cleared,0);
        button('Cancelar').click();await wait(()=>button('Limpiar todo'));assert.equal(cleared,0);
        button('Limpiar todo').click();await wait(()=>button('Limpiar'));button('Limpiar').click();
        await wait(()=>document.querySelectorAll('article').length===0);assert.equal(cleared,1);
        assert.equal(button('Limpiar todo').disabled,true);
        let viewedAll=0, closed=0, noteIndex=null;
        root.render(React.createElement(HeaderNewsPanel,{anchor:document.body,onClose:()=>closed++,onViewAll:()=>viewedAll++,onSelect:index=>noteIndex=index}));
        await wait(()=>document.querySelectorAll('.header_news_card').length===3);
        assert.deepEqual([...document.querySelectorAll('.header_news_copy strong')].map(e=>e.textContent),releaseNotes.slice(0,3).map(note=>note.title));
        document.querySelectorAll('.header_news_card')[2].click();assert.equal(noteIndex,2);
        button('Ver todo').click();assert.equal(viewedAll,1);
        document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(closed,1);
        button('Cerrar novedades').click();assert.equal(closed,2);
        root.render(React.createElement(NoteViewer,{index:noteIndex,select:index=>noteIndex=index,close:()=>closed++}));
        await wait(()=>document.querySelector('.bold_news_dialog'));
        assert.equal(document.querySelector('#bold_news_title').textContent,releaseNotes[2].title);
        button('Cerrar notas de parche').click();assert.equal(closed,3);
    } finally {
        root.unmount();await settle();await server.close();dom.window.close();
        for(const key of names){if(descriptors[key])Object.defineProperty(globalThis,key,descriptors[key]);else delete globalThis[key];}
    }
});
