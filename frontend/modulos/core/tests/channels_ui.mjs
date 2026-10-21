// Synthetic UI contract checks. No real users, sessions, Drive or network APIs.
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import {JSDOM} from "jsdom";
import {createServer} from "vite";

const dom = new JSDOM('<div id="root"></div>',{url:"http://localhost:5187",pretendToBeVisual:true});
// The private-avatar cache owns a long-lived browser BroadcastChannel; this
// single-window synthetic test must not retain a Node message-port handle.
globalThis.BroadcastChannel = undefined;
for (const key of ["window","document","navigator","HTMLElement","HTMLTextAreaElement","HTMLInputElement","Element","MutationObserver","CustomEvent","Event"]) Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
dom.window.HTMLMediaElement.prototype.pause=function(){};
dom.window.HTMLMediaElement.prototype.play=async function(){this.dispatchEvent(new Event("play"));};
dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
globalThis.Image=dom.window.Image;
const core = {account:{employee:"me"},activeAssignment:{chat_enabled:true},securityUncertain:false,messaging:{connection:"open"}};
const opens = [];
globalThis.__channelsCore = core;
globalThis.__channelsShell = {open_direct_chat:person => opens.push(person.employee_id),set_active_module:module => opens.push(module)};
const channelId="00000000-0000-4000-8000-000000000001", departmentId="00000000-0000-4000-8000-000000000002";
const department={id:departmentId,name:"IT",color:"#4760A8",can_create:true};
let channel={id:channelId,name:"General",description:"Contexto del equipo",department,version:1,activity_version:2,can_manage:true,can_send:true,archived_at:null};
const makeMessage=(id,body,parent=null,author="me") => ({id,body,parent_id:parent,channel_id:channelId,sequence:Number(id),version:1,author:{employee_id:author,name:author === "me" ? "Mi cuenta" : "Colega"},department:{name:author === "me" ? "IT" : "Marketing",color:"#9250A3"},created_at:new Date().toISOString(),editable_until:new Date(Date.now()+600000).toISOString(),can_edit:author === "me",reply_count:0});
let rows=[makeMessage("1","Guía https://example.com <script>no ejecutar</script>",null,"peer"),makeMessage("2","Mi mensaje")];
let calls=0, sends=0, failSend=false, attempted=[], releaseSend;
let mediaAttempts=[],failMediaAt=0,validationMedia=false,mediaDownloads=0;
const taskId="00000000-0000-4000-8000-000000000010", taskFixture={id:taskId,title:"Revisión de prueba",status:"Pendiente",completed:false};
let taskReadable=true, searches=0;
const readCursors=new Map();let reads=0,deepLoads=0;
const pendingCount=()=>rows.filter(row=>row.author.employee_id!=="me" && row.sequence>(readCursors.get(row.parent_id || "root") || 0)).length;
const channelSnapshot=()=>({...channel,activity_version:rows.at(-1)?.sequence || 0,unread_count:pendingCount()});
const confirmed=new Map();
globalThis.__channelsApi={
    departments:async () => {calls++; return {results:[department]};},
    list:async archived => {calls++; return {results:!channel.archived_at || archived ? [channelSnapshot()] : [],next:null};},
    detail:async()=>{deepLoads++;return channelSnapshot();},
    message:async(_,id)=>({message:rows.find(row=>row.id===id)}),
    follow:async(_,following)=>{channel={...channel,following,state_version:(channel.state_version || 0)+1};return channelSnapshot();},
    read:async(_,id)=>{reads++;const row=rows.find(row=>row.id===id);assert.ok(row);const key=row.parent_id || "root";readCursors.set(key,Math.max(readCursors.get(key) || 0,row.sequence));channel={...channel,state_version:(channel.state_version || 0)+1};return {channel:channelSnapshot(),read_sequence:readCursors.get(key),parent_id:row.parent_id};},
    messages:async (_,parent) => {calls++; return {results:rows.filter(row => row.parent_id === (parent || null)).sort((a,b) => b.sequence-a.sequence).map(row => ({...row,task:row.task && !taskReadable ? {available:false} : row.task,reply_count:rows.filter(reply => reply.parent_id === row.id).length,unread_reply_count:rows.filter(reply=>reply.parent_id===row.id && reply.author.employee_id!=="me" && reply.sequence>(readCursors.get(row.id) || 0)).length})),next:null,channel:channelSnapshot()};},
    tasks:async (_,query) => {searches++;return {results:query.includes("Revisión") && taskReadable ? [taskFixture] : [],next:null};},
    task:async id => {assert.equal(id,taskId);if (!taskReadable) throw {status:404};return taskFixture;},
    send:async (_,values) => {
        sends++; attempted.push(values.client_id);
        if (values.task_id && !taskReadable) throw {status:404};
        if (releaseSend) await new Promise(resolve => {releaseSend=resolve;});
        let message=confirmed.get(values.client_id);
        if (!message) {message={...makeMessage(String(rows.length+1),values.body,values.parent_id),task:values.task_id ? {...taskFixture,available:true} : null}; confirmed.set(values.client_id,message); rows.push(message);}
        if (failSend) throw {status:0};
        return {message};
    },
    sendMedia:async (_,values,file) => {
        mediaAttempts.push({values,file});
        if(validationMedia) throw {status:400,fields:{file:["Archivo rechazado."]}};
        let message=confirmed.get(values.client_id);
        if(!message){message={...makeMessage(String(rows.length+1),values.body,values.parent_id),media:{id:values.client_id,kind:file.type.startsWith("image/") ? "image" : "audio",mime_type:file.type,size_bytes:file.size,width:80,height:50},task:values.task_id ? {...taskFixture,available:true} : null};confirmed.set(values.client_id,message);rows.push(message);}
        if(failMediaAt===mediaAttempts.length) throw {status:0};
        return {message};
    },
    media:async (_,id)=>{mediaDownloads++;assert.ok(rows.find(row=>row.id===id)?.media);return new Blob(["private-pixels"],{type:"image/webp"});},
    edit:async (_,id,values) => {const index=rows.findIndex(row => row.id === id); rows[index]={...rows[index],body:values.body,version:rows[index].version+1,edited_at:new Date().toISOString()}; return {message:rows[index]};},
    update:async (_,values) => {channel={...channel,...values,version:channel.version+1,...("archived" in values ? {archived_at:values.archived ? new Date().toISOString() : null,can_send:!values.archived} : {})}; return channel;},
    create:async values => {channel={...channel,name:values.name,description:values.description,version:1}; return channel;},
};
const replacements=[
    ["/core/core_provider.jsx","export const useCore=()=>globalThis.__channelsCore;"],
    ["/core/app_shell.jsx","export const useShell=()=>globalThis.__channelsShell;"],
];
const server=await createServer({configFile:false,plugins:[{name:"isolated-channels",enforce:"pre",transform(_,id) {const name=id.replaceAll("\\","/"); return replacements.find(([suffix]) => name.endsWith(suffix))?.[1];}}],
    resolve:{dedupe:["react","react-dom","lucide-react"]},esbuild:{jsx:"automatic",jsxImportSource:"react"},cacheDir:path.join(os.tmpdir(),"bold-channels-ui"),optimizeDeps:{noDiscovery:true,include:[],entries:[]},server:{middlewareMode:true,hmr:false},appType:"custom"});
const {default:React}=await import("react"),{createRoot}=await import("react-dom/client");
const load=file => server.ssrLoadModule(`/@fs/${path.resolve(file).replaceAll("\\","/")}`);
const {channelApi}=await load("../mensajeria/channel_api.js");
Object.assign(channelApi,globalThis.__channelsApi);
const {default:Channels}=await load("../mensajeria/channel_module.jsx");
const root=createRoot(document.getElementById("root"));
const settle=()=>new Promise(resolve => setTimeout(resolve,40));
const waitFor=async predicate => {const deadline=Date.now()+4000; while (!predicate() && Date.now()<deadline) await settle(); assert.ok(predicate(),"expected channel UI state");};
const button=text => [...document.querySelectorAll("button")].find(node => node.textContent === text);
const input=(field,text) => {const prototype=field instanceof dom.window.HTMLTextAreaElement ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype,"value").set.call(field,text); field.dispatchEvent(new Event("input",{bubbles:true}));};
const submit=()=>document.querySelector(".slack_composer").dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));
try {
    root.render(React.createElement(Channels));
    await waitFor(()=>document.querySelector(".slack_sidebar nav button"));
    document.querySelector(".slack_sidebar nav button").click();
    await waitFor(()=>document.querySelectorAll(".slack_message").length===2);
    assert.equal(document.querySelector(".slack_message script"),null);
    assert.match(document.querySelector(".slack_message_body").textContent,/<script>/);
    assert.match(document.querySelector(".slack_message_card .slack_department").textContent,/Marketing/);
    assert.equal(document.querySelector(".slack_message_body a").rel,"noopener noreferrer");
    assert.equal([...document.querySelectorAll("button")].filter(node=>node.textContent === "Editar mi mensaje").length,1);
    document.querySelector('[aria-label="Abrir chat con Colega"]').click(); assert.deepEqual(opens,["peer"]);
    const idle=calls; await settle(); assert.equal(calls,idle,"idle does not poll");
    assert.equal(reads,0,"loading history without visibility evidence never acknowledges it");
    document.querySelector('.slack_sidebar nav button').click();await settle();assert.equal(document.querySelectorAll('.slack_message').length,2,"reselecting the same channel keeps its history");
    button("Seguir canal").click();await waitFor(()=>button("Dejar de seguir canal"));assert.equal(button("Dejar de seguir canal").getAttribute("aria-pressed"),"true");
    button("Dejar de seguir canal").click();await waitFor(()=>button("Seguir canal"));assert.equal(pendingCount(),1,"unfollowing keeps unread history");
    button("Marcar vista como leída").click();await waitFor(()=>reads===1);await settle();assert.equal(pendingCount(),0);
    input(document.querySelector("#slack_message"),"Mensaje de prueba"); await settle();
    releaseSend=true; submit(); submit(); await settle(); assert.equal(sends,1);
    releaseSend(); releaseSend=null;
    await waitFor(()=>document.querySelectorAll(".slack_message").length===3);
    assert.equal(document.querySelector("#slack_message").value,"");
    failSend=true; input(document.querySelector("#slack_message"),"Respuesta perdida"); await settle(); submit();
    await waitFor(()=>document.querySelector('[role="alert"]'));
    assert.ok(document.querySelector("#slack_message").disabled,"uncertain send payload stays immutable");
    const retryId=attempted.at(-1); failSend=false; submit();
    await waitFor(()=>document.querySelectorAll(".slack_message").length===4);
    assert.equal(attempted.at(-1),retryId); assert.equal(rows.filter(row=>row.body === "Respuesta perdida").length,1);
    button("Responder en hilo").click(); await waitFor(()=>document.querySelector(".slack_thread_context")); await settle();
    input(document.querySelector("#slack_message"),"En el hilo"); await settle(); submit();
    await waitFor(()=>document.querySelectorAll(".slack_message").length===1);
    assert.equal(rows.at(-1).parent_id,"1");
    document.querySelector('[aria-label="Volver al canal"]').click(); await waitFor(()=>document.querySelectorAll(".slack_message").length===4);
    document.querySelector('[aria-label="Configurar canal"]').click(); await waitFor(()=>document.querySelector(".slack_editor"));
    assert.ok(document.querySelector(".slack_main").hasAttribute("inert"));
    const field=[...document.querySelectorAll(".slack_editor label")].find(node=>node.textContent.startsWith("Nombre" )).querySelector("input");
    input(field,"Coordinación"); await settle();
    document.querySelector(".slack_editor form").dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));
    await waitFor(()=>!document.querySelector(".slack_editor"));
    assert.match(document.querySelector(".slack_header h2").textContent,/Coordinación/);
    document.querySelector('[aria-label="Archivar canal"]').click(); await waitFor(()=>document.querySelector('[aria-label="Restaurar canal"]'));
    assert.ok(document.querySelector("#slack_message").disabled);
    document.querySelector('[aria-label="Restaurar canal"]').click(); await waitFor(()=>!document.querySelector("#slack_message").disabled);
    button("Compartir tarea").click();await waitFor(()=>document.querySelector(".slack_task_picker"));
    assert.ok(document.querySelector(".slack_main").hasAttribute("inert"));
    input(document.querySelector('.slack_task_search input'),"Revisión");await settle();assert.equal(searches,0,"typing does not poll task search");
    document.querySelector('.slack_task_search').dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));
    await waitFor(()=>document.querySelector('.slack_task_results button'));
    document.querySelector('.slack_task_results button').click();await waitFor(()=>document.querySelector('.slack_task_draft'));
    assert.match(document.querySelector('.slack_task_draft').textContent,/Revisión de prueba/);
    submit();await waitFor(()=>document.querySelector('.slack_task_card'));
    assert.equal(rows.at(-1).body,"");assert.equal(rows.at(-1).task.id,taskId,"a task can be sent without caption");
    const taskOpens=[];const onTask=event=>taskOpens.push(event.detail.task);window.addEventListener('bold:brand-resource',onTask);
    document.querySelector('.slack_task_card').click();await waitFor(()=>taskOpens.length===1);assert.deepEqual(taskOpens,[taskId]);
    taskReadable=false;document.querySelector('.slack_task_card').click();
    await waitFor(()=>document.querySelector('.slack_task_unavailable'));
    assert.equal(document.querySelector('.slack_task_card'),null);assert.equal(taskOpens.length,1,"lost task access cannot open an old card");
    assert.ok(document.querySelector('#slack_message'),"a revoked reference does not close the channel");
    window.removeEventListener('bold:brand-resource',onTask);
    taskReadable=true;button("Compartir tarea").click();await waitFor(()=>document.querySelector('.slack_task_search'));
    input(document.querySelector('.slack_task_search input'),"Revisión");await settle();document.querySelector('.slack_task_search').dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));
    await waitFor(()=>document.querySelector('.slack_task_results button'));document.querySelector('.slack_task_results button').click();await waitFor(()=>document.querySelector('.slack_task_draft'));
    input(document.querySelector('#slack_message'),"Conservar contexto escrito");await settle();taskReadable=false;const beforeFailedReference=rows.length;submit();
    await waitFor(()=>!document.querySelector('.slack_task_draft'));
    assert.equal(rows.length,beforeFailedReference);assert.equal(document.querySelector('#slack_message').value,"Conservar contexto escrito");
    assert.match(document.querySelector('[role="alert"]').textContent,/Quitamos su referencia/);
    // Two-image batch: confirmed first is removed, uncertain second is immutable
    // and retries the exact same file/payload without duplicating the message.
    const addFiles=files=>{const picker=document.querySelector('[aria-label="Seleccionar imágenes para el canal"]');Object.defineProperty(picker,"files",{value:files,configurable:true});picker.dispatchEvent(new Event("change",{bubbles:true}));};
    const firstImage=new File(["first pixels"],"primera.png",{type:"image/png"}),secondImage=new File(["second pixels"],"segunda.png",{type:"image/png"});
    taskReadable=true;button("Compartir tarea").click();await waitFor(()=>document.querySelector('.slack_task_search'));
    input(document.querySelector('.slack_task_search input'),"Revisión");await settle();document.querySelector('.slack_task_search').dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));
    await waitFor(()=>document.querySelector('.slack_task_results button'));document.querySelector('.slack_task_results button').click();await waitFor(()=>document.querySelector('.slack_task_draft'));
    addFiles([firstImage,secondImage]);await waitFor(()=>document.querySelectorAll('.messaging_queue_thumb').length===2);
    assert.equal(document.querySelector('dialog'),null,"adding images never opens the editor automatically");
    assert.equal(document.querySelector('#slack_message').value,"Conservar contexto escrito");
    document.querySelector('[aria-label="Editar imagen seleccionada"]').click();await waitFor(()=>document.querySelector('.messaging_media_dialog'));
    assert.ok(document.querySelector('.slack_main').hasAttribute('inert'));
    document.querySelector('[aria-label="Cerrar editor de imagen"]').click();await waitFor(()=>!document.querySelector('dialog'));
    document.querySelectorAll('.messaging_queue_thumb')[1].click();await settle();input(document.querySelector('#slack_message'),"Segunda captura");await settle();
    failMediaAt=2;const beforeMedia=rows.length;submit();submit();
    await waitFor(()=>document.querySelector('.messaging_queue_pending'));
    assert.equal(mediaAttempts.length,2);assert.equal(rows.length,beforeMedia+2);
    assert.equal(document.querySelectorAll('.messaging_queue_thumb').length,1);
    assert.ok(document.querySelector('#slack_message').disabled);
    assert.ok(document.querySelector('[aria-label="Añadir más imágenes"]').disabled);
    assert.equal(mediaAttempts[0].values.body,"Conservar contexto escrito");assert.equal(mediaAttempts[1].values.body,"Segunda captura");
    assert.equal(mediaAttempts[0].values.task_id,taskId);assert.equal(mediaAttempts[1].values.task_id,undefined,"a shared task attaches only to the first confirmed image");
    const pendingAttempt=mediaAttempts.at(-1);failMediaAt=0;submit();await waitFor(()=>!document.querySelector('.messaging_image_queue'));
    assert.equal(rows.length,beforeMedia+2);assert.equal(mediaAttempts.at(-1).file,pendingAttempt.file);assert.deepEqual(mediaAttempts.at(-1).values,pendingAttempt.values);
    document.querySelector('.messaging_media_load').click();await waitFor(()=>document.querySelector('.messaging_image_open'));
    assert.equal(mediaDownloads,1);document.querySelector('.messaging_image_open').click();await waitFor(()=>document.querySelector('.messaging_image_viewer'));
    assert.match(document.querySelector('.messaging_image_viewer a[download]').href,/^blob:/);
    document.querySelector('[aria-label="Cerrar imagen"]').click();await waitFor(()=>!document.querySelector('dialog'));
    // Definitively rejected uploads may be revised; pasted images use the same
    // bounded queue, and a thread draft stays separate from the channel draft.
    const paste=new Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(paste,'clipboardData',{value:{items:[{kind:'file',getAsFile:()=>firstImage}]}});
    document.querySelector('#slack_message').dispatchEvent(paste);await waitFor(()=>document.querySelector('.messaging_image_queue'));
    validationMedia=true;submit();await waitFor(()=>document.querySelector('[role="alert"]')?.textContent.includes('Archivo rechazado'));
    assert.equal(document.querySelector('#slack_message').disabled,false);validationMedia=false;
    button("Responder en hilo").click();await waitFor(()=>document.querySelector('.slack_thread_context'));
    assert.equal(document.querySelector('.messaging_image_queue'),null);
    document.querySelector('[aria-label="Volver al canal"]').click();await waitFor(()=>document.querySelector('.messaging_image_queue'));
    document.querySelector('[aria-label="Quitar todas las imágenes"]').click();await waitFor(()=>!document.querySelector('.messaging_image_queue'));
    const drop=new Event('drop',{bubbles:true,cancelable:true});Object.defineProperty(drop,'dataTransfer',{value:{files:[secondImage]}});document.querySelector('.slack_composer').dispatchEvent(drop);
    await waitFor(()=>document.querySelector('.messaging_image_queue'));assert.ok(drop.defaultPrevented);
    document.querySelector('[aria-label="Quitar todas las imágenes"]').click();await waitFor(()=>!document.querySelector('.messaging_image_queue'));
    // Real recorder component, synthetic microphone/codec: no hardware or data
    // leaves the test. The same audio UI exposes 1x/1.5x/2x playback.
    let stopped=0;
    Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>({getTracks:()=>[{stop(){stopped++;}}]})},configurable:true});
    globalThis.MediaRecorder=class {static isTypeSupported(){return true;}constructor(_,options){this.mimeType=options.mimeType;this.state='inactive';}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable({data:new Blob(['audio'],{type:this.mimeType})});this.onstop();}};
    document.querySelector('[aria-label="Grabar nota de voz"]').click();await waitFor(()=>document.querySelector('[aria-label="Detener y escuchar grabación"]'));
    assert.ok(document.querySelector('#slack_message').disabled);
    assert.ok(document.querySelector('[aria-label="Ver canales"]').disabled);
    document.querySelector('[aria-label="Detener y escuchar grabación"]').click();await waitFor(()=>document.querySelector('.messaging_media_draft'));
    assert.ok(stopped>0);const beforeAudio=rows.length;submit();await waitFor(()=>rows.length===beforeAudio+1 && !document.querySelector('.messaging_media_draft'));
    assert.equal(rows.at(-1).media.kind,'audio');
    const rate=document.querySelector('.messaging_audio_rate');assert.equal(rate.textContent,'1×');rate.click();await settle();assert.equal(rate.textContent,'1.5×');rate.click();await settle();assert.equal(rate.textContent,'2×');
    // A notification opens an authorized root/thread through Shell's target,
    // not a blind injection of the notification's content into the view.
    const hiddenReply=makeMessage(String(rows.length+1),'Respuesta pendiente','1','peer');rows.push(hiddenReply);
    window.dispatchEvent(new CustomEvent('bold:slack-event',{detail:{payload:{channel_id:channelId,kind:'message.created'}}}));
    await waitFor(()=>document.querySelector('.slack_message_card footer .slack_unread_badge'));
    button('Marcar vista como leída').click();await settle();assert.equal(pendingCount(),1,'reading the channel keeps unseen thread replies unread');
    globalThis.__channelsShell.slack_target={channel_id:channelId,parent_id:'1',requestId:'notice-1'};root.render(React.createElement(Channels));
    await waitFor(()=>document.querySelector('.slack_thread_context'));await waitFor(()=>document.querySelector('.slack_message_body')?.textContent==='En el hilo');
    await waitFor(()=>!button('Marcar vista como leída').disabled);
    button('Marcar vista como leída').click();await waitFor(()=>pendingCount()===0);
    const opened=deepLoads;input(document.querySelector('#slack_message'),'No reabrir por cada envío');await settle();submit();await waitFor(()=>document.querySelector('#slack_message').value==='');
    assert.equal(deepLoads,opened,'a consumed notification target is not reopened after sending');
    globalThis.__channelsShell.slack_target={channel_id:channelId,parent_id:'1',requestId:'notice-2'};root.render(React.createElement(Channels));
    await waitFor(()=>deepLoads===opened+1);await settle();assert.ok(document.querySelectorAll('.slack_message').length>0,'opening another notice for the same thread preserves its history');
    // Synthetic intersection/focus evidence: hidden or unfocused tabs cannot
    // acknowledge messages, nor can viewing roots acknowledge a reply.
    document.querySelector('[aria-label="Volver al canal"]').click();await waitFor(()=>!document.querySelector('.slack_thread_context'));
    let focused=false;Object.defineProperty(document,'hasFocus',{value:()=>focused,configurable:true});Object.defineProperty(document,'hidden',{value:true,configurable:true});
    const observers=[];globalThis.IntersectionObserver=class{constructor(callback,options){this.callback=callback;this.root=options.root;observers.push(this);}observe(){}disconnect(){}};
    const observedRoot=makeMessage(String(rows.length+1),'Mensaje visible',null,'peer');rows.push(observedRoot);
    rows.push(makeMessage(String(rows.length+1),'Otra respuesta no visitada','1','peer'));
    window.dispatchEvent(new CustomEvent('bold:slack-event',{detail:{payload:{channel_id:channelId,kind:'message.created'}}}));
    await waitFor(()=>document.querySelector(`[data-slack-message="${observedRoot.id}"]`));await settle();
    const host=document.querySelector('.slack_messages');host.getBoundingClientRect=()=>({top:0,bottom:100,height:100});
    for(const node of host.querySelectorAll('[data-slack-message]'))node.getBoundingClientRect=()=>node.dataset.slackMessage===observedRoot.id ? {top:20,bottom:80,height:60} : {top:-100,bottom:-20,height:80};
    const beforeObserved=reads;const checkVisible=()=>observers.filter(row=>row.root===host).at(-1).callback([]);
    checkVisible();await settle();assert.equal(reads,beforeObserved);
    Object.defineProperty(document,'hidden',{value:false,configurable:true});checkVisible();await settle();assert.equal(reads,beforeObserved);
    focused=true;const modal=document.createElement('dialog');modal.setAttribute('open','');document.body.append(modal);
    checkVisible();await settle();assert.equal(reads,beforeObserved,'a modal image viewer blocks background acknowledgement');modal.remove();
    document.dispatchEvent(new Event('focusin',{bubbles:true}));await waitFor(()=>reads===beforeObserved+1);await settle();assert.equal(pendingCount(),1,'the invisible reply remains unread');
    // New remote messages must not pull a reader away from older context; an
    // arriving image may anchor only a reader who is already at the bottom.
    focused=false;let scrollHeight=1000;const scrollHost=document.querySelector('.slack_messages');
    Object.defineProperty(scrollHost,'scrollHeight',{get:()=>scrollHeight,configurable:true});Object.defineProperty(scrollHost,'clientHeight',{value:300,configurable:true});
    scrollHost.scrollTo=options=>{scrollHost.scrollTop=Math.max(0,options.top-scrollHost.clientHeight);};scrollHost.scrollTop=0;scrollHost.dispatchEvent(new Event('scroll',{bubbles:true}));
    const arriving=makeMessage(String(rows.length+1),'No interrumpir el historial',null,'peer');rows.push(arriving);
    window.dispatchEvent(new CustomEvent('bold:slack-event',{detail:{payload:{channel_id:channelId,kind:'message.created'}}}));
    await waitFor(()=>document.querySelector('.slack_jump_latest'));assert.equal(scrollHost.scrollTop,0);
    document.querySelector('.slack_jump_latest').click();await waitFor(()=>!document.querySelector('.slack_jump_latest'));assert.equal(scrollHost.scrollTop,700);
    scrollHeight=1200;scrollHost.dispatchEvent(new CustomEvent('bold:chat-media-loaded',{bubbles:true}));await settle();assert.equal(scrollHost.scrollTop,900);
    // Sidebar counts follow Core's complete live projection, even if no channel
    // is selected or another channel's message did not fetch this list again.
    core.slack={unread:{ready:true,total:9,byChannel:{[channelId]:9},truncated:false}};root.render(React.createElement(Channels));await settle();
    assert.match(document.querySelector('.slack_sidebar nav button').getAttribute('aria-label'),/9 mensajes sin leer/);
    core.securityUncertain=true; root.render(React.createElement(Channels)); await settle();
    assert.equal(document.querySelector(".slack_message"),null);
    assert.match(document.querySelector('[role="status"]').textContent,/sesión autorizada/);
    console.log("Slack DOM passed: channels, following/unread, scoped visible reads, notification thread targets, tasks/permissions, image queues/editor/viewer, partial retry, voice, security uncertainty and no idle polling.");
} finally {root.unmount(); await server.close(); dom.window.close();}
