// Real reader interaction with synthetic assignment state; no account/API calls.
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import {JSDOM} from "jsdom";
import {createServer} from "vite";

const dom=new JSDOM('<div id="root"></div>',{url:"http://localhost",pretendToBeVisual:true});
for(const key of ["window","document","navigator","HTMLElement","Element","MutationObserver","CustomEvent","Event"])
    Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
globalThis.__pilotNewsCore={activeAssignment:{id:"it",chat_enabled:true}};
const server=await createServer({configFile:false,plugins:[{name:"synthetic-news",enforce:"pre",transform(_,id){
    if(id.replaceAll("\\","/").endsWith("/core/core_provider.jsx"))return "export const useCore=()=>globalThis.__pilotNewsCore;";
}}],resolve:{dedupe:["react","react-dom","lucide-react"]},esbuild:{jsx:"automatic",jsxImportSource:"react"},
cacheDir:path.join(os.tmpdir(),"bold-pilot-news-ui"),optimizeDeps:{noDiscovery:true,include:[],entries:[]},
server:{middlewareMode:true,hmr:false},appType:"custom"});
let root;
try{
    const React=await import("react"),{createRoot}=await import("react-dom/client");
    const {default:News}=await server.ssrLoadModule(`/@fs/${path.resolve("../perfil/news_preferences.jsx").replaceAll("\\","/")}`);
    const {releaseNotes,messagingReleaseNotes,getReleaseNotes}=await import("../../perfil/release_notes.js");
    const pageButton=label=>Array.from(document.querySelectorAll(".bold_news_pagination button")).find(button=>button.textContent.includes(label));
    async function checkPages(notes){
        const titles=[];
        assert.equal(document.querySelector(".bold_news_badge").textContent,`${notes.length} notas`);
        while(true){
            const cards=Array.from(document.querySelectorAll(".bold_news_card"));
            assert.ok(cards.length<=6); titles.push(...cards.map(card=>card.querySelector("strong").textContent));
            const nextPage=pageButton("Siguiente"); if(!nextPage || nextPage.disabled)break;
            await React.act(async()=>nextPage.click());
        }
        assert.deepEqual(titles,notes.map(note=>note.title));
        while(pageButton("Anterior") && !pageButton("Anterior").disabled)await React.act(async()=>pageButton("Anterior").click());
    }
    async function openNote(title){
        const close=document.querySelector('[aria-label="Cerrar notas de parche"]');
        if(close)await React.act(async()=>close.click());
        while(pageButton("Anterior") && !pageButton("Anterior").disabled)await React.act(async()=>pageButton("Anterior").click());
        while(true){
            const card=Array.from(document.querySelectorAll(".bold_news_card")).find(card=>card.querySelector("strong").textContent===title);
            if(card){await React.act(async()=>card.click());return;}
            const nextPage=pageButton("Siguiente"); assert.ok(nextPage && !nextPage.disabled,`Missing note: ${title}`);
            await React.act(async()=>nextPage.click());
        }
    }
    root=createRoot(document.getElementById("root"));
    await React.act(async()=>root.render(React.createElement(News)));
    await checkPages(getReleaseNotes({chat_enabled:true}));
    await openNote(messagingReleaseNotes[0].title);
    assert.match(document.querySelector('[role="dialog"]').textContent,/Borradores recuperables/);
    const next=()=>Array.from(document.querySelectorAll(".bold_news_dialog footer button")).find(button=>button.textContent.includes("Siguiente"));
    for(let i=0;i<6;i++)await React.act(async()=>next().click());
    assert.match(document.querySelector('[role="dialog"]').textContent,/Automatizaciones controladas/);
    globalThis.__pilotNewsCore={activeAssignment:{id:"outside",chat_enabled:false}};
    await React.act(async()=>root.render(React.createElement(News)));
    assert.equal(document.querySelector('[role="dialog"]'),null);
    await checkPages(releaseNotes);
    await openNote(messagingReleaseNotes[0].title);
    assert.match(document.querySelector('[role="dialog"]').textContent,/Borradores recuperables/);
    globalThis.__pilotNewsCore={activeAssignment:{id:"it",chat_enabled:true}};
    await React.act(async()=>root.render(React.createElement(News)));
    assert.equal(document.querySelector('[role="dialog"]'),null);
    await openNote(messagingReleaseNotes[0].title);
    globalThis.__pilotNewsCore={activeAssignment:{id:"it",chat_enabled:false}};
    await React.act(async()=>root.render(React.createElement(News)));
    assert.equal(document.querySelector('[role="dialog"]'),null);
    await checkPages(releaseNotes);
    await openNote(releaseNotes.find(note=>note.id==='2026-11-06-chat-slack-organization-launch').title);
    assert.match(document.querySelector('[role="dialog"]').textContent,/Chat y Slack para toda la organización/);
    await openNote(releaseNotes[0].title);
    assert.match(document.querySelector('[role="dialog"]').textContent,/Informes sobre tu trabajo y el de tu equipo/);
    console.log("Release notes: pagination, seven general feature cards, launch, reader navigation and assignment switches passed.");
}finally{
    if(root){const {act}=await import("react");await act(async()=>root.unmount());}
    await server.close();dom.window.close();delete globalThis.__pilotNewsCore;
}
