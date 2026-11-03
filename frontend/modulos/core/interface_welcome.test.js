import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import {JSDOM} from "jsdom";
import {createServer} from "vite";

test("welcome saves theme changes, resumes new accounts and exempts existing accounts", async () => {
    const dom=new JSDOM('<div id="root"></div>',{url:"http://localhost",pretendToBeVisual:true});
    const globals=["window","document","navigator","HTMLElement","MutationObserver","Element","Event"];
    const descriptors=Object.fromEntries(globals.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
    for(const key of globals)Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
    const calls=[];
    globalThis.__welcomeHttp={request:async (url,options)=>{
        calls.push({url,options});
        return options ? {onboarding_step:"theme",onboarding_completed:false,...options.body} : {theme:"light",onboarding_completed:globalThis.__welcomeExisting,onboarding_step:"theme"};
    }};
    const server=await createServer({configFile:false,plugins:[{name:"welcome-test",enforce:"pre",transform(_,id){
        if(id.replaceAll("\\","/").endsWith("/core/http_client.js"))return "export const is_using_real_backend=()=>true; export const http=globalThis.__welcomeHttp;";
    }}],resolve:{dedupe:["react","react-dom","lucide-react"]},esbuild:{jsx:"automatic",jsxImportSource:"react"},cacheDir:path.join(os.tmpdir(),"bold-welcome-test"),optimizeDeps:{noDiscovery:true,entries:[]},server:{middlewareMode:true,hmr:false},appType:"custom"});
    const {default:React}=await import("react"),{createRoot}=await import("react-dom/client");
    const {InterfaceWelcome}=await server.ssrLoadModule("/interface_welcome.jsx");
    const root=createRoot(document.getElementById("root"));
    const settle=()=>new Promise(resolve=>setTimeout(resolve,25));
    const waitFor=async predicate=>{const end=Date.now()+4000;while(!predicate()&&Date.now()<end)await settle();assert.ok(predicate());};
    let changeTheme;
    function Harness({account}){const [dark,setDark]=React.useState(false);changeTheme=setDark;return React.createElement(InterfaceWelcome,{account,dark,onTheme:setDark,connectionContent:React.createElement("p",null,"Conexión disponible")});}
    try{
        globalThis.__welcomeExisting=true;
        root.render(React.createElement(Harness,{account:"existing"}));
        await waitFor(()=>calls.length===1);
        await settle();assert.equal(document.querySelector('[role="dialog"]'),null);
        changeTheme(true);
        await waitFor(()=>calls.some(call=>call.options?.body.theme==="dark"));
        assert.equal(document.querySelector('[role="dialog"]'),null);
        globalThis.__welcomeExisting=false;
        root.render(React.createElement(Harness,{account:"new"}));
        await waitFor(()=>document.querySelector('[role="dialog"]'));
        assert.match(document.querySelector("h1").textContent,/Hazlo tuyo/);
        document.querySelector('.bold_welcome_next').click();
        await waitFor(()=>document.querySelector("h1")?.textContent.includes("Conecta"));
        assert.match(document.querySelector('[role="dialog"]').textContent,/Conexión disponible/);
        document.querySelector('.bold_welcome_skip').click();
        await waitFor(()=>!document.querySelector('[role="dialog"]'));
        assert.equal(calls.at(-1).options.body.onboarding_completed,true);
    }finally{
        root.unmount();await settle();await server.close();await settle();dom.window.close();
        delete globalThis.__welcomeHttp;delete globalThis.__welcomeExisting;
        for(const key of globals){if(descriptors[key])Object.defineProperty(globalThis,key,descriptors[key]);else delete globalThis[key];}
    }
});
