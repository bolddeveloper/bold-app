import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import {readFile} from "node:fs/promises";
import {JSDOM} from "jsdom";
import {createServer} from "vite";

test("login keeps vector geometry through theme changes, adapts to mobile and pauses while hidden",async()=>{
    const dom=new JSDOM('<div id="root"></div>',{url:"http://localhost",pretendToBeVisual:true});
    const globals=["window","document","navigator","HTMLElement","Element","Event","localStorage"];
    const descriptors=Object.fromEntries(globals.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
    for(const key of globals)Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
    const queries=new Map();
    window.matchMedia=query=>{if(!queries.has(query))queries.set(query,{matches:false,listeners:new Set(),addEventListener(_,fn){this.listeners.add(fn);},removeEventListener(_,fn){this.listeners.delete(fn);}});return queries.get(query);};
    const server=await createServer({configFile:false,resolve:{dedupe:["react","react-dom","lucide-react"]},esbuild:{jsx:"automatic",jsxImportSource:"react"},cacheDir:path.join(os.tmpdir(),"bold-login-motion-test"),optimizeDeps:{noDiscovery:true,entries:[]},server:{middlewareMode:true,hmr:false},appType:"custom"});
    const {default:React}=await import("react"),{createRoot}=await import("react-dom/client");
    const {LoginBackground}=await server.ssrLoadModule("/login_background.jsx");
    const root=createRoot(document.getElementById("root"));
    const settle=()=>new Promise(resolve=>setTimeout(resolve,25));
    const waitFor=async predicate=>{const end=Date.now()+3000;while(!predicate()&&Date.now()<end)await settle();assert.ok(predicate());};
    try{
        root.render(React.createElement(LoginBackground,{dark:true}));await waitFor(()=>document.querySelector('svg'));
        const svg=document.querySelector('svg'), patternId=svg.querySelector('pattern').id;
        assert.equal(svg.getAttribute('viewBox'),'0 0 1280 720');
        assert.equal(document.querySelector('video,img,image,canvas'),null,"background needs no raster image or media download");
        assert.ok(document.querySelector('.core_login_background.is_dark'));
        root.render(React.createElement(LoginBackground,{dark:false}));await waitFor(()=>!document.querySelector('.is_dark'));
        assert.equal(document.querySelector('svg'),svg,"theme change keeps the same drawing and animation timeline");
        assert.equal(svg.querySelector('pattern').id,patternId);
        root.render(React.createElement('div',null,[true,false].map((dark,index)=>React.createElement(LoginBackground,{dark,key:index}))));
        await waitFor(()=>document.querySelectorAll('svg').length===2);
        const ids=[...document.querySelectorAll('svg [id]')].map(node=>node.id);
        assert.equal(new Set(ids).size,ids.length,"paint definitions cannot collide between instances");
        for(const drawing of document.querySelectorAll('svg')){
            for(const node of drawing.querySelectorAll('[fill],[stroke],[mask]'))for(const attribute of ['fill','stroke','mask']){
                const match=node.getAttribute(attribute)?.match(/^url\(#(.+)\)$/);
                if(match)assert.ok([...drawing.querySelectorAll('[id]')].some(target=>target.id===match[1]),"paint references resolve within their own drawing");
            }
        }
        const media=queries.get('(max-width:600px)');media.matches=true;media.listeners.forEach(fn=>fn());
        await waitFor(()=>[...document.querySelectorAll('svg')].every(node=>node.getAttribute('viewBox')==='0 0 432 936'));
        assert.equal(document.querySelector('.core_login_orbit_b').parentElement.getAttribute('transform'),'translate(445 955)');
        Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));
        await waitFor(()=>document.querySelectorAll('.is_paused').length===2);
        Object.defineProperty(document,'hidden',{value:false,configurable:true});document.dispatchEvent(new Event('visibilitychange'));
        await waitFor(()=>!document.querySelector('.is_paused'));
        assert.equal(document.querySelector('button'),null);
        const {LoginIntro,LOGIN_INTRO_DURATION_MS}=await server.ssrLoadModule('/login_screen.jsx');
        localStorage.setItem('bold_color_theme','dark');
        root.render(React.createElement(LoginIntro,{name:'Equipo BOLD',key:'dark'}));
        await waitFor(()=>document.querySelector('.core_login_intro img'));
        assert.equal(document.querySelector('img').getAttribute('src'),'/auth/bold-building-loader.svg');
        assert.equal(document.querySelector('img').style.colorScheme,'dark');
        assert.equal(document.querySelector('video'),null,'entry keeps vector quality without downloading a video');
        assert.match(document.querySelector('[role=status]').textContent,/Hola, Equipo/);
        localStorage.setItem('bold_color_theme','light');
        root.render(React.createElement(LoginIntro,{key:'light'}));
        await waitFor(()=>document.querySelector('img')?.style.colorScheme==='light');
        assert.equal(document.querySelector('.core_login_intro.theme_dark'),null);
        const reduced=queries.get('(prefers-reduced-motion: reduce)');
        reduced.matches=true;reduced.listeners.forEach(fn=>fn());
        await waitFor(()=>document.querySelector('img').getAttribute('src').endsWith('#still'));
        const source=await readFile('public/auth/bold-building-loader.svg','utf8');
        const drawing=new JSDOM(source,{contentType:'image/svg+xml'});
        assert.equal(drawing.window.document.querySelectorAll('.brick').length,8);
        assert.equal(drawing.window.document.documentElement.getAttribute('viewBox'),'0 0 320 280');
        assert.match(source,/@media \(prefers-reduced-motion:reduce\).*animation:none/);
        assert.match(source,/@media \(prefers-color-scheme:dark\)/);
        assert.equal(drawing.window.document.querySelector('script,image,foreignObject'),null);
        for(const use of drawing.window.document.querySelectorAll('use'))assert.ok(drawing.window.document.querySelector(use.getAttribute('href')));
        assert.ok(drawing.window.document.getElementById('entry'));
        const entryStyle=source.match(/#entry:target \.brick \{([^}]+)\}/)[1];
        const placement=Number(entryStyle.match(/animation-duration:(\d+)ms/)[1]);
        const stagger=Number(entryStyle.match(/\* (\d+)ms/)[1]);
        assert.ok(LOGIN_INTRO_DURATION_MS>=placement+7*stagger,'fresh login waits until every piece is settled');
        assert.match(entryStyle,/animation-iteration-count:1/);
        drawing.window.close();

        reduced.matches=false;reduced.listeners.forEach(fn=>fn());
        const timers=new Map(),originalTimer=window.setTimeout,originalClear=window.clearTimeout;
        window.setTimeout=(callback,delay)=>{const id=Symbol();timers.set(id,{callback,delay});return id;};
        window.clearTimeout=id=>timers.delete(id);
        let completed=0;const complete=()=>completed++;
        try {
            root.render(React.createElement(LoginIntro,{key:'fresh-login',playOnce:true,onComplete:complete}));
            await waitFor(()=>document.querySelector('img')?.getAttribute('src').endsWith('#entry'));
            assert.equal(timers.size,0,'the entrance clock starts after the SVG loads');
            document.querySelector('img').dispatchEvent(new Event('load'));
            await waitFor(()=>timers.size===1);
            const timer=[...timers.values()][0];
            assert.equal(timer.delay,LOGIN_INTRO_DURATION_MS);assert.equal(completed,0);
            timer.callback();assert.equal(completed,1);
            root.render(React.createElement(LoginIntro,{key:'reduced-entry',playOnce:true,onComplete:complete}));
            await waitFor(()=>timers.size===0);
            reduced.matches=true;reduced.listeners.forEach(fn=>fn());
            await waitFor(()=>completed===2);
            assert.equal(timers.size,0,'reduced motion does not add a loading delay');
            reduced.matches=false;reduced.listeners.forEach(fn=>fn());
            root.render(React.createElement(LoginIntro,{key:'failed-entry',playOnce:true,onComplete:complete}));
            await waitFor(()=>document.querySelector('img')?.getAttribute('src').endsWith('#entry'));
            document.querySelector('img').dispatchEvent(new Event('error'));
            assert.equal(completed,3,'a missing illustration cannot block login');
            root.render(React.createElement('div',null,'Ready'));await waitFor(()=>!document.querySelector('img'));
            assert.equal(timers.size,0,'unmount cleans up the entrance clock');
        } finally {window.setTimeout=originalTimer;window.clearTimeout=originalClear;}
    }finally{
        root.unmount();await settle();await server.close();await settle();dom.window.close();
        for(const key of globals){if(descriptors[key])Object.defineProperty(globalThis,key,descriptors[key]);else delete globalThis[key];}
    }
});
