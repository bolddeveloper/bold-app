// Shared task panel hosted over Slack. Synthetic tasks, no application accounts.
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost:5187',pretendToBeVisual:true});
for(const key of ['window','document','navigator','HTMLElement','Element','Event','CustomEvent','KeyboardEvent','MutationObserver','sessionStorage','localStorage','DOMParser'])Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
globalThis.BroadcastChannel=undefined;
globalThis.ResizeObserver=class{observe(){}disconnect(){}};
window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
const navigation=[];
globalThis.__slackTaskShell={active_module:'slack',set_active_module:value=>{navigation.push(value);},set_is_sidebar_open:()=>{},open_direct_chat:()=>{},open_channel:()=>{},open_profile:()=>{}};
const server=await createServer({configFile:false,plugins:[{name:'slack-task-host',enforce:'pre',transform(_,file){
    if(file.replaceAll('\\','/').endsWith('/core/app_shell.jsx'))return `import React from 'react';export const useShell=()=>globalThis.__slackTaskShell;export function AppShell({children,overlays}){return React.createElement(React.Fragment,null,children,overlays);}`;
}}],define:{'import.meta.env.VITE_USE_REAL_BACKEND':'"false"'},resolve:{dedupe:['react','react-dom','lucide-react','sweetalert2','qrcode','driver.js']},esbuild:{jsx:'automatic',jsxImportSource:'react'},cacheDir:path.join(os.tmpdir(),'bold-slack-task-host'),optimizeDeps:{noDiscovery:true,entries:[]},server:{middlewareMode:true,hmr:false},appType:'custom'});
const load=file=>server.ssrLoadModule(`/@fs/${path.resolve(file).replaceAll('\\','/')}`);
const {default:React}=await import('react'),{createRoot}=await import('react-dom/client');
const {CoreProvider}=await load('core_provider.jsx'),{default:TasksModule}=await load('../tareas/src/task_app.jsx');
const {starter_tasks}=await load('../tareas/src/services/presentation_data.js');
const root=createRoot(document.getElementById('root'));
const settle=()=>new Promise(resolve=>setTimeout(resolve,30));
const wait=async check=>{for(let i=0;i<100 && !check();i++)await settle();assert.ok(check(),'expected in-place task state');};
let mounts=0;
function Slack(){React.useEffect(()=>{mounts++;},[]);return React.createElement('section',{'data-slack-channel':true},React.createElement('textarea',{'aria-label':'Borrador Slack',defaultValue:'Mensaje sin enviar'}));}
const externalModules={slack:React.createElement(Slack)},identity={activeAssignment:{id:'fixture',chat_enabled:false},account:{id:'fixture'},directory:[],units:[]};
const open=task=>window.dispatchEvent(new CustomEvent('bold:brand-resource',{detail:{task,context:'slack'}}));
const tab=name=>[...document.querySelectorAll('.task_detail_tabs [role=tab]')].find(node=>node.textContent.startsWith(name));
try{
    root.render(React.createElement(CoreProvider,{mockIdentity:identity},React.createElement(TasksModule,{externalModules})));
    await wait(()=>document.querySelector('[data-slack-channel]'));await settle();
    const channel=document.querySelector('[data-slack-channel]'),draft=channel.querySelector('textarea');
    const task=starter_tasks.find(task=>task.subtasks?.length) || starter_tasks[0];assert.ok(task);
    open(task.id);await wait(()=>document.querySelector('.task_detail_rework'));
    assert.equal(document.querySelector('.detail_task_title').textContent,task.title);
    assert.ok(tab('Comentarios'));assert.ok(tab('Subtareas'));assert.deepEqual(navigation,[]);
    tab('Comentarios').click();await settle();tab('Subtareas').click();await settle();
    if(task.subtasks?.length){
        document.querySelector('.subtask_details_link').click();await wait(()=>document.querySelector('.task_parent_link'));
        assert.equal(document.querySelector('.detail_task_title').textContent,task.subtasks[0].title);
        document.querySelector('.task_parent_link').click();await wait(()=>document.querySelector('.detail_task_title')?.textContent===task.title);
    }
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await wait(()=>!document.querySelector('[data-task-drawer]'));
    assert.equal(document.querySelector('[data-slack-channel]'),channel);assert.equal(draft.value,'Mensaje sin enviar');assert.equal(mounts,1);assert.deepEqual(navigation,[]);
    open('no-access');await wait(()=>document.querySelector('[data-task-drawer] [role=alert]'));
    assert.match(document.querySelector('[data-task-drawer] [role=alert]').textContent,/no está disponible/);
    assert.equal(document.querySelector('.detail_task_title'),null,'an unavailable task never keeps the previous task title');
    assert.equal(document.querySelector('[data-slack-channel]'),channel);assert.deepEqual(navigation,[]);
    console.log('Slack task details UI passed: shared details, comments/subtask tabs, child navigation, no module redirect, same mounted channel/draft, Escape and denied reference.');
}finally{root.unmount();await server.close();dom.window.close();}
