// Real React controls with synthetic replies; native/server acceptance is separate.
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';

const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost:5192',pretendToBeVisual:true});
globalThis.BroadcastChannel=undefined;
for(const key of ['window','document','navigator','HTMLElement','Event','CustomEvent'])Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
const [reminder,documentId,conversationId,messageId,employeeId,otherMessage]=Array.from({length:6},(_,n)=>`00000000-0000-4000-8000-${String(n+1).padStart(12,'0')}`);
const target={kind:'chat',conversation_id:conversationId,message_id:messageId,employee_id:employeeId};
const item=(version=1,source=messageId)=>({id:reminder,document_id:documentId,scope_key:'chat:'+conversationId,version,target:{...target,message_id:source}});
globalThis.__readingCore={account:{id:'account'},activeAssignment:{id:'it',chat_enabled:true},authorizationRevision:1,securityUncertain:false,
    messaging:{unread:{total:0,byConversation:{},byEmployee:{},reading:{version:0,items:[]}}}};
const server=await createServer({configFile:false,plugins:[{name:'isolated-reading',enforce:'pre',transform(_,id){if(id.replaceAll('\\','/').endsWith('/core/core_provider.jsx'))return 'export const useCore=()=>globalThis.__readingCore;';}}],
    resolve:{dedupe:['react','react-dom','lucide-react']},esbuild:{jsx:'automatic',jsxImportSource:'react'},cacheDir:path.join(os.tmpdir(),'bold-reading-reminder-ui'),optimizeDeps:{noDiscovery:true,include:[],entries:[]},server:{middlewareMode:true,hmr:false},appType:'custom'});
const {default:React}=await import('react'),{createRoot}=await import('react-dom/client');
const load=file=>server.ssrLoadModule(`/@fs/${path.resolve(file).replaceAll('\\','/')}`);
const {readingApi}=await load('../mensajeria/reading_api.js');
const {default:ReadingReminder,ReadingReminderBanner}=await load('../mensajeria/reading_reminder.jsx');
const root=createRoot(document.getElementById('root'));
const settle=()=>new Promise(resolve=>setTimeout(resolve,20));
async function until(predicate){const end=Date.now()+5000;while(!predicate() && Date.now()<end)await settle();assert.ok(predicate(),'expected personal reading control state');}
const changes=[],opens=[],attempts=[];
let state={id:null,version:0,marked:false},fail=false,late=null,lateSignal=null,stateCalls=0;
readingApi.state=async()=>{stateCalls++;return state;};
readingApi.mark=async(kind,source,attempt,options)=>{
    assert.equal(kind,'chat');assert.equal(source,messageId);attempts.push({...attempt});
    if(fail)throw {status:500};
    if(late){lateSignal=options.signal;return new Promise(resolve=>{late=resolve;});}
    return {reading:{version:1,items:[item()]}};
};
readingApi.clear=async(id,attempt)=>{assert.equal(id,reminder);assert.equal(attempt.version,state.version);return {reading:{version:2,items:[]}};};
readingApi.recover=async()=>({reading:{version:4,items:[item(4,otherMessage)]}});
const mount=()=>root.render(React.createElement(React.Fragment,null,
    React.createElement(ReadingReminder,{kind:'chat',sourceId:messageId,scopeKey:'chat:'+conversationId,onChange:value=>changes.push(value)}),
    React.createElement(ReadingReminderBanner,{scopeKey:'chat:'+conversationId,onOpen:value=>opens.push(value)})));
const receive=event=>{globalThis.__readingCore.messaging.unread.reading=event.detail.payload.reading;mount();};
window.addEventListener('bold:messaging-event',receive);
const markButton=()=>document.querySelector('.reading_reminder_control button');
try{
    mount();await until(()=>markButton());assert.equal(stateCalls,0,'rendering never polls marker state');
    fail=true;markButton().click();await until(()=>document.querySelector('[role="alert"]'));
    assert.equal(markButton().getAttribute('aria-pressed'),'false');assert.match(markButton().textContent,/Reintentar/);
    const client=attempts[0].client_id;
    fail=false;markButton().click();await until(()=>markButton()?.getAttribute('aria-pressed')==='true');
    assert.equal(attempts[1].client_id,client);assert.equal(stateCalls,1,'unknown delivery reuses the original optimistic request');
    assert.ok(document.querySelector('.reading_reminder_banner'));
    document.querySelector('.reading_reminder_banner>button').click();assert.equal(opens[0].message_id,messageId);
    state={id:reminder,version:1,marked:true};markButton().click();await until(()=>markButton()?.getAttribute('aria-pressed')==='false');
    assert.equal(document.querySelector('.reading_reminder_banner'),null);
    globalThis.__readingCore.messaging.unread.reading={version:3,items:[item(3,otherMessage)]};state={id:reminder,version:4,marked:true};mount();await settle();
    const before=attempts.length;markButton().click();await until(()=>document.querySelector('[role="alert"]'));
    assert.match(document.querySelector('[role="alert"]').textContent,/otro dispositivo/);assert.equal(attempts.length,before,'a changed version cannot silently overwrite another device');
    assert.equal(globalThis.__readingCore.messaging.unread.reading.version,4);
    root.render(null);await settle();
    globalThis.__readingCore.messaging.unread.reading={version:0,items:[]};state={id:null,version:0,marked:false};late=true;mount();await until(()=>markButton());
    markButton().click();await until(()=>lateSignal);const resolveLate=late,oldChanges=changes.length;
    globalThis.__readingCore={...globalThis.__readingCore,account:{id:'another'},messaging:{unread:{reading:{version:0,items:[]}}}};mount();await until(()=>lateSignal.aborted);
    resolveLate({reading:{version:99,items:[item(99)]}});await settle();assert.equal(changes.length,oldChanges);assert.equal(globalThis.__readingCore.messaging.unread.reading.version,0);
    globalThis.__readingCore={...globalThis.__readingCore,securityUncertain:true};mount();await settle();assert.equal(document.querySelector('.reading_reminder_control'),null);
    console.log('Reading reminder UI passed: no polling, confirmed state only, immutable retry, explicit clear, context action, conflict refresh, late account response discarded, uncertain identity hidden.');
}finally{window.removeEventListener('bold:messaging-event',receive);root.unmount();await server.close();dom.window.close();}
