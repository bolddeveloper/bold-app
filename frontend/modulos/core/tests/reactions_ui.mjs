// Actual React controls, with synthetic HTTP. Live two-account checks are separate.
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost:5192',pretendToBeVisual:true});
globalThis.BroadcastChannel=undefined;
for(const key of ['window','document','navigator','HTMLElement','Event','CustomEvent'])Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
globalThis.__reactionCore={account:{id:'alpha'},activeAssignment:{id:'it',chat_enabled:true},authorizationRevision:1,securityUncertain:false};
console.log('Reactions DOM: starting isolated Vite server…');
const server=await createServer({configFile:false,plugins:[{name:'isolated-reactions',enforce:'pre',transform(_,id){if(id.replaceAll('\\','/').endsWith('/core/core_provider.jsx'))return 'export const useCore=()=>globalThis.__reactionCore;';}}],resolve:{dedupe:['react','react-dom','lucide-react']},esbuild:{jsx:'automatic',jsxImportSource:'react'},cacheDir:path.join(os.tmpdir(),'bold-reactions-ui'),optimizeDeps:{noDiscovery:true,include:[],entries:[]},server:{middlewareMode:true,hmr:false},appType:'custom'});
const {default:React}=await import('react'),{createRoot}=await import('react-dom/client');
console.log('Reactions DOM: loading API and controls…');
const load=file=>server.ssrLoadModule(`/@fs/${path.resolve(file).replaceAll('\\','/')}`);
const {reactionApi}=await load('../mensajeria/reaction_api.js');
console.log('Reactions DOM: API loaded; loading controls…');
const {default:MessageReactions}=await load('../mensajeria/message_reactions.jsx');
console.log('Reactions DOM: checking interactions…');
const root=createRoot(document.getElementById('root')),settle=()=>new Promise(resolve=>setTimeout(resolve,20));
async function until(predicate){const end=Date.now()+5000;while(!predicate() && Date.now()<end)await settle();assert.ok(predicate(),'reaction control state');}
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,choice={key:'heart',emoji:'❤️',label:'Corazón'};
let snapshot={version:0,own_version:0,items:[]},canChange=true,reads=0,fail=false,late=null,lateSignal;
const attempts=[];
reactionApi.state=async()=>{reads++;return {reactions:snapshot,choices:[choice],can_change:canChange,max_own:8};};
reactionApi.set=async(kind,container,message,attempt,options)=>{
    attempts.push({...attempt});if(fail)throw {status:500};
    if(late){lateSignal=options.signal;return new Promise(resolve=>late=resolve);}
    snapshot={version:snapshot.version+1,own_version:snapshot.version+1,items:attempt.active ? [{...choice,count:1,mine:true}]:[]};
    return {reactions:snapshot,choices:[choice],can_change:canChange,max_own:8};
};
const mount=()=>root.render(React.createElement(MessageReactions,{kind:'chat',containerId:id(1),message:{id:id(2),reactions:{version:0,own_version:0,items:[]}}}));
const button=label=>[...document.querySelectorAll('button')].find(node=>node.getAttribute('aria-label')===label);
const push=reactions=>window.dispatchEvent(new CustomEvent('bold:messaging-event',{detail:{event_type:'messaging.reactions.updated',payload:{conversation_id:id(1),reactions:[{id:id(2),reactions}]}}}));
try{
    mount();await until(()=>button('Elegir reacción'));assert.equal(reads,0,'render has no background read');
    button('Elegir reacción').click();await until(()=>button('Corazón'));
    assert.equal(document.activeElement,button('Cerrar reacciones'),'keyboard enters the inline picker');
    fail=true;button('Corazón').click();await until(()=>document.querySelector('[role="alert"]'));
    const token=attempts[0].client_id;fail=false;
    [...document.querySelectorAll('button')].find(node=>node.textContent==='Reintentar reacción pendiente').click();
    await until(()=>button('Corazón')?.getAttribute('aria-pressed')==='true');assert.equal(attempts[1].client_id,token);
    assert.match(document.querySelector('[role="status"]').textContent,/añadió/);
    document.querySelector('.message_reaction_choices').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    await until(()=>!document.querySelector('.message_reaction_picker'));assert.equal(document.activeElement,button('Elegir reacción'));
    const chip=document.querySelector('.message_reaction_chips button[aria-pressed="true"]');chip.click();
    await until(()=>document.querySelectorAll('.message_reaction_chips button').length===1);assert.equal(attempts.at(-1).active,false);
    assert.equal(document.querySelector('.message_reaction_picker'),null,'a chip toggles without forcing the picker open');
    push({version:9,own_version:2,items:[{...choice,count:2,mine:false}]});
    await until(()=>document.querySelector('.message_reaction_chips button')?.textContent.includes('2'));
    push({version:1,own_version:1,items:[]});
    await settle();assert.match(document.querySelector('.message_reaction_chips').textContent,/2/,'old events cannot erase a newer count');
    root.render(null);await settle();canChange=false;snapshot={version:0,own_version:0,items:[]};mount();await until(()=>button('Elegir reacción'));
    button('Elegir reacción').click();await until(()=>button('Corazón'));assert.equal(button('Corazón').disabled,true);
    root.render(null);await settle();canChange=true;late=true;mount();await until(()=>button('Elegir reacción'));
    button('Elegir reacción').click();await until(()=>button('Corazón'));button('Corazón').click();await until(()=>lateSignal);
    const resolve=late;globalThis.__reactionCore={...globalThis.__reactionCore,account:{id:'beta'}};mount();await until(()=>lateSignal.aborted);
    resolve({reactions:{version:20,own_version:20,items:[{...choice,count:1,mine:true}]},choices:[choice],can_change:true,max_own:8});await settle();assert.equal(document.querySelector('[aria-pressed="true"]'),null);
    globalThis.__reactionCore.securityUncertain=true;mount();await settle();assert.equal(document.querySelector('.message_reactions'),null);
    console.log('Reactions UI passed: no polling, keyboard/Escape, confirmed counts, immutable retry, own removal, ordered live snapshots, readonly permission, identity cancellation.');
}finally{root.unmount();await server.close();dom.window.close();}
