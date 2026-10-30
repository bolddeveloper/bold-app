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
    const {releaseNotes}=await import("../../perfil/release_notes.js");
    root=createRoot(document.getElementById("root"));
    await React.act(async()=>root.render(React.createElement(News)));
    assert.equal(document.querySelectorAll(".bold_news_card").length,releaseNotes.length+7);
    await React.act(async()=>document.querySelector(".bold_news_card").click());
    assert.match(document.querySelector('[role="dialog"]').textContent,/Borradores recuperables/);
    const next=()=>Array.from(document.querySelectorAll(".bold_news_dialog footer button")).find(button=>button.textContent.includes("Siguiente"));
    for(let i=0;i<6;i++)await React.act(async()=>next().click());
    assert.match(document.querySelector('[role="dialog"]').textContent,/Automatizaciones controladas/);
    globalThis.__pilotNewsCore={activeAssignment:{id:"outside",chat_enabled:false}};
    await React.act(async()=>root.render(React.createElement(News)));
    assert.equal(document.querySelector('[role="dialog"]'),null);
    assert.equal(document.querySelectorAll(".bold_news_card").length,releaseNotes.length);
    assert.doesNotMatch(document.body.textContent,/Automatizaciones controladas|Borradores recuperables/);
    globalThis.__pilotNewsCore={activeAssignment:{id:"it",chat_enabled:true}};
    await React.act(async()=>root.render(React.createElement(News)));
    assert.equal(document.querySelector('[role="dialog"]'),null);
    await React.act(async()=>document.querySelector(".bold_news_card").click());
    globalThis.__pilotNewsCore={activeAssignment:{id:"it",chat_enabled:false}};
    await React.act(async()=>root.render(React.createElement(News)));
    assert.equal(document.querySelector('[role="dialog"]'),null);
    assert.equal(document.querySelectorAll(".bold_news_card").length,releaseNotes.length);
    console.log("Pilot notes: seven cards, reader navigation, assignment switch and same-assignment revocation passed.");
}finally{
    if(root){const {act}=await import("react");await act(async()=>root.unmount());}
    await server.close();dom.window.close();delete globalThis.__pilotNewsCore;
}
