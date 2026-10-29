// Real React/WebCrypto + synthetic users, socket-free APIs and storage adapter.
// This does not prove a browser's IndexedDB survives closing the PWA.
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import {JSDOM} from "jsdom";
import {createServer} from "vite";
import {installMessagingFixture} from "./messaging_fixture.js";
const dom=new JSDOM('<div id="root"></div>',{url:"http://localhost:5186",pretendToBeVisual:true});
globalThis.BroadcastChannel=undefined;
for(const key of ["window","document","navigator","localStorage","sessionStorage","HTMLElement","HTMLTextAreaElement","MutationObserver","Element","CustomEvent","Event"])Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
globalThis.requestAnimationFrame=callback=>setTimeout(callback,0);
dom.window.HTMLMediaElement.prototype.pause=function(){};
dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
const fixture=installMessagingFixture(),replacements=[
    ["/core/core_provider.jsx","export const useCore=()=>globalThis.__messagingCore;"],
    ["/core/app_shell.jsx","export const useShell=()=>globalThis.__messagingShell;"],
    ["/core/http_client.js","export const is_using_real_backend=()=>true; export const http={request:async()=>{throw Error('No network');}};"],
    ["/mensajeria/messaging_api.js","export const messagingApi=globalThis.__messagingApi;"],
    ["/core/shared/bold_dialog.js","export const confirmBold=async()=>true;"],
];
const server=await createServer({configFile:false,plugins:[{name:"composer-recovery-fixture",enforce:"pre",transform(_,id){return replacements.find(([suffix])=>id.replaceAll("\\","/").endsWith(suffix))?.[1];}}],resolve:{dedupe:["react","react-dom","lucide-react"]},esbuild:{jsx:"automatic",jsxImportSource:"react"},cacheDir:path.join(os.tmpdir(),"bold-composer-recovery-ui"),optimizeDeps:{noDiscovery:true,include:[],entries:[]},server:{middlewareMode:true,hmr:false},appType:"custom"});
const load=file=>server.ssrLoadModule(`/@fs/${path.resolve(file).replaceAll("\\","/")}`);
const {default:React}=await import("react"),{createRoot}=await import("react-dom/client");
const {createDraftVault}=await load("../mensajeria/draft_vault.js"),{draftService}=await load("../mensajeria/draft_service.js"),{captureComposer}=await load("../mensajeria/composer_draft.js"),{protectPrivateWork}=await load("./shared/private_work.js");
const records=new Map(),vault=createDraftVault({storage:{get:async id=>records.get(id),put:async row=>records.set(row.id,row),remove:async id=>{records.delete(id);},purge:async()=>records.clear()}});
draftService.open=async resource=>{const scope={...resource,account_id:__messagingCore.account.id,assignment_id:__messagingCore.activeAssignment.id};return vault.open(scope,async()=>({scope,key:btoa("a".repeat(32)),key_id:"a".repeat(32),can_write:true,retention_seconds:604800}));};
draftService.purge=async()=>vault.purge();
const {default:Chat}=await load("../mensajeria/messaging_module.jsx");let root;
console.log("Composer recovery DOM: modules loaded; mounting Chat…");
const settle=()=>new Promise(resolve=>setTimeout(resolve,30));
const waitFor=async predicate=>{const until=Date.now()+6000;while(!predicate() && Date.now()<until)await settle();assert.ok(predicate(),"expected composer recovery UI state");};
const button=text=>[...document.querySelectorAll("button")].find(node=>node.textContent===text);
const mount=async()=>{root=createRoot(document.getElementById("root"));root.render(React.createElement(Chat));await waitFor(()=>document.querySelector("#messaging_input"));await waitFor(()=>!document.querySelector(".messaging_composer").inert);await settle();};
const unmount=async()=>{root.unmount();await settle();};
const input=text=>{const field=document.querySelector("#messaging_input");Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,"value").set.call(field,text);field.dispatchEvent(new Event("input",{bubbles:true}));};
const submit=()=>document.querySelector("form").dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));
const warnsOnExit=()=>{const event=new dom.window.Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;};
try{
    await mount();console.log("Composer recovery DOM: queueing and protecting an image…");input("Texto junto al recorte");await settle();
    const file=new File(["edited-image-bytes"],"recorte.png",{type:"image/png",lastModified:7}),picker=document.querySelector('input[type="file"]');Object.defineProperty(picker,"files",{value:[file],configurable:true});picker.dispatchEvent(new Event("change",{bubbles:true}));
    await waitFor(()=>document.querySelector(".messaging_image_queue"));assert.equal(await protectPrivateWork(),true);assert.equal(warnsOnExit(),false,'protected image/text must not block the accepted PWA reload');await unmount();
    const sentBefore=fixture.calls.filter(call=>call==="send").length;console.log("Composer recovery DOM: reopening encrypted draft…");await mount();await waitFor(()=>button("Recuperar borrador de conversación"));assert.equal(fixture.calls.filter(call=>call==="send").length,sentBefore);
    button("Recuperar borrador de conversación").click();await waitFor(()=>document.querySelector(".messaging_image_queue") && !button("Recuperar borrador de conversación"));assert.equal(document.querySelector("#messaging_input").value,"Texto junto al recorte");
    console.log("Composer recovery DOM: image restored; simulating lost response…");
    fixture.loseMediaResponseAt=fixture.mediaSends.length+1;submit();await waitFor(()=>document.querySelector('[role="alert"]'));const uncertain=fixture.mediaSends.at(-1),committed=fixture.getRows().length;assert.equal(await protectPrivateWork(),true);await unmount();
    fixture.loseMediaResponseAt=null;await mount();await waitFor(()=>button("Recuperar borrador de conversación"));button("Recuperar borrador de conversación").click();await waitFor(()=>document.querySelector(".messaging_image_queue"));submit();await waitFor(()=>!document.querySelector(".messaging_image_queue"));
    assert.equal(fixture.getRows().length,committed,"lost-response retry never creates a second message");assert.equal(fixture.mediaSends.at(-1).clientId,uncertain.clientId);assert.equal(await fixture.mediaSends.at(-1).file.text(),"edited-image-bytes");await unmount();
    console.log("Composer recovery DOM: image retry passed; recovering audio…");
    const voice=new File(["voice-bytes"],"voz.webm",{type:"audio/webm;codecs=opus"}),captured=captureComposer({text:"",items:[{id:"voice-draft",file:voice,caption:""}]});
    const handle=await draftService.open({kind:"conversation",resource_id:fixture.conversation.id});await handle.save(captured.payload,captured.files);handle.close();
    await mount();await waitFor(()=>button("Recuperar borrador de conversación"));const audioBefore=fixture.mediaSends.length;button("Recuperar borrador de conversación").click();await waitFor(()=>document.querySelector(".messaging_media_draft"));assert.equal(fixture.mediaSends.length,audioBefore);submit();await waitFor(()=>fixture.mediaSends.length===audioBefore+1);assert.equal(await fixture.mediaSends.at(-1).file.text(),"voice-bytes");await waitFor(()=>!document.querySelector(".messaging_media_draft"));
    await unmount();
    const own=fixture.getRows().find(row=>row.author_id===fixture.actor),editCapture=captureComposer({text:"Borrador normal separado",edit:{id:own.id,body:"Edición de una versión antigua",version:own.version+100,editable_until:"2099-01-01T00:00:00Z"}});
    const editHandle=await draftService.open({kind:"conversation",resource_id:fixture.conversation.id});await editHandle.save(editCapture.payload);editHandle.close();
    await mount();await waitFor(()=>button("Recuperar borrador de conversación"));button("Recuperar borrador de conversación").click();await waitFor(()=>document.querySelector("#messaging_input")?.value==="Edición de una versión antigua");assert.ok(document.querySelector('[type="submit"]').disabled);const editsBefore=fixture.calls.filter(call=>call==="edit").length;submit();await settle();assert.equal(fixture.calls.filter(call=>call==="edit").length,editsBefore,"stale recovered edits cannot write or extend their deadline");document.querySelector('[aria-label="Cancelar edición"]').click();await waitFor(()=>document.querySelector("#messaging_input").value==="Borrador normal separado");
    console.log('Forward recovery DOM: partial mixed batch, remount and fixed destination…');
    document.querySelector('[aria-label="Seleccionar mensajes para reenviar"]').click();await settle();
    const forwardText=document.querySelector('.messaging_message_select input');forwardText.click();await settle();
    // Selection mode hides per-message actions, so locate the image itself.
    const imageCheckbox=document.querySelector('.messaging_media_image').closest('.messaging_message_row').querySelector('input[type="checkbox"]');imageCheckbox.click();await settle();
    const beforeBatch=fixture.getRows().length;
    document.querySelector('.messaging_selection_send').click();await waitFor(()=>document.querySelector('dialog[open] input[type="radio"]'));
    document.querySelector('dialog input[type="radio"]').click();await settle();
    fixture.failMediaAt=fixture.mediaSends.length+1;fixture.failMediaStatus=500;
    document.querySelector('dialog form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    await waitFor(()=>document.querySelector('dialog [role="alert"]'));
    const pendingForward=fixture.mediaSends.at(-1);assert.equal(fixture.getRows().length,beforeBatch+1);
    assert.equal(await protectPrivateWork(),true);assert.equal(warnsOnExit(),false,'protected partial forward review can leave without a second native warning');await unmount();fixture.failMediaAt=null;
    const sendsAtRecovery=fixture.calls.filter(value=>value==='send').length;
    await mount();await waitFor(()=>button('Revisar reenvío conservado'));assert.equal(fixture.calls.filter(value=>value==='send').length,sendsAtRecovery);
    button('Revisar reenvío conservado').click();await waitFor(()=>document.querySelector('dialog[open]'));
    assert.equal(document.querySelectorAll('dialog .messaging_forward_preview li').length,1,'confirmed text is not replayed');
    assert.ok(document.querySelector('dialog input[type="radio"]').checked);assert.ok(document.querySelector('dialog fieldset').disabled);
    assert.equal(fixture.calls.filter(value=>value==='send').length,sendsAtRecovery,'recovery/preview do not send');
    document.querySelector('dialog form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await waitFor(()=>!document.querySelector('dialog'));
    assert.equal(fixture.getRows().length,beforeBatch+2);assert.equal(fixture.mediaSends.at(-1).clientId,pendingForward.clientId);assert.equal(await fixture.mediaSends.at(-1).file.text(),await pendingForward.file.text());
    assert.ok(!button('Revisar reenvío pendiente'));
    // Lost text response + later edit must resolve the current protected row,
    // not re-POST the old body under the original nonce and get stuck at 409.
    await waitFor(()=>document.querySelector('[aria-label="Reenviar mensaje"]') && !document.querySelector('[aria-label="Reenviar mensaje"]').disabled);
    document.querySelector('[aria-label="Reenviar mensaje"]').click();await waitFor(()=>document.querySelector('dialog input[type="radio"]'));document.querySelector('dialog input[type="radio"]').click();await settle();
    fixture.loseTextResponse=true;document.querySelector('dialog form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await waitFor(()=>document.querySelector('dialog [role="alert"]'));
    const lostText=fixture.getRows().at(-1);lostText.body='Edición posterior del texto reenviado';lostText.version++;
    fixture.loseTextResponse=false;assert.equal(await protectPrivateWork(),true);await unmount();
    const rowsBeforeResolve=fixture.getRows().length,writesBeforeResolve=fixture.calls.filter(value=>value==='send').length;
    await mount();await waitFor(()=>button('Revisar reenvío conservado'));button('Revisar reenvío conservado').click();await waitFor(()=>document.querySelector('dialog form'));
    document.querySelector('dialog form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await waitFor(()=>!document.querySelector('dialog'));
    assert.equal(fixture.getRows().length,rowsBeforeResolve);assert.equal(fixture.calls.filter(value=>value==='send').length,writesBeforeResolve);assert.equal(lostText.body,'Edición posterior del texto reenviado');
    console.log('Forward recovery UI passed: encrypted remount, no auto-send, exact file/nonce, partial progress, fixed recipient and later edit recovery.');
    // The separate composer review was not restored when we recovered only
    // forwarding. A real user cannot edit that inert composer until deciding.
    if(button('Recuperar borrador de conversación')){button('Recuperar borrador de conversación').click();await waitFor(()=>!button('Recuperar borrador de conversación'));}
    input("No mostrar a otra cuenta");await settle();assert.equal(await protectPrivateWork(),true);
    __messagingCore={...__messagingCore,account:{...__messagingCore.account,id:"another-account"},activeAssignment:{...__messagingCore.activeAssignment,id:"another-assignment"}};root.render(React.createElement(Chat));await settle();
    await waitFor(()=>document.querySelector("#messaging_input")?.value!=="No mostrar a otra cuenta");
    assert.ok(!button("Recuperar borrador de conversación"),"another account cannot read the old account's recovery");
    console.log("Composer recovery UI passed: explicit image/audio recovery, edited file bytes, immutable UUID after lost response, no auto-send and account isolation.");
    await unmount();
    const {channelApi}=await load("../mensajeria/channel_api.js"),{default:Channels}=await load("../mensajeria/channel_module.jsx");
    const channelId="00000000-0000-4000-8000-000000000021",parentId="00000000-0000-4000-8000-000000000022",taskId="00000000-0000-4000-8000-000000000023",clientId="00000000-0000-4000-8000-000000000024";
    const department={id:"it",name:"IT",color:"#4760A8"},channel={id:channelId,name:"Pruebas",department,can_send:true,version:1,activity_version:1,archived_at:null};
    const author={employee_id:fixture.actor,name:"Cuenta ficticia"},parent={id:parentId,body:"Contexto del hilo",parent_id:null,channel_id:channelId,author,department,sequence:1,created_at:new Date().toISOString()},committedMessage={...parent,id:"committed-image",body:"Imagen del hilo",parent_id:parentId,sequence:2,media:{id:clientId,kind:"image",mime_type:"image/png",size_bytes:3}};
    const channelSends=[];
    Object.assign(channelApi,{departments:async()=>({results:[department]}),list:async()=>({results:[channel],next:null}),detail:async()=>channel,message:async()=>({message:parent}),messages:async(_,thread)=>({results:thread ? [committedMessage]:[parent],next:null,channel}),media:async()=>new Blob(["img"],{type:"image/png"}),read:async()=>({channel,read_sequence:2}),sendMedia:async(_,attempt,file)=>{channelSends.push({attempt,file});return {message:committedMessage};}});
    const threadFile=new File(["img"],"hilo.png",{type:"image/png"}),threadCapture=captureComposer({items:[{id:clientId,file:threadFile,caption:"Imagen del hilo",attempted:true,attempt:{client_id:clientId,body:"Imagen del hilo",parent_id:parentId,task_id:taskId}}],taskId});
    const threadHandle=await draftService.open({kind:"channel",resource_id:channelId,parent_id:parentId});await threadHandle.save(threadCapture.payload,threadCapture.files);threadHandle.close();
    const rootHandle=await draftService.open({kind:"channel",resource_id:channelId});await rootHandle.save(captureComposer({text:"Borrador distinto del canal"}).payload);rootHandle.close();
    __messagingShell.slack_target={channel_id:channelId,parent_id:parentId,requestId:"recovery-thread"};root=createRoot(document.getElementById("root"));root.render(React.createElement(Channels));
    await waitFor(()=>document.querySelector(".slack_thread_context") && button("Recuperar borrador de conversación"));assert.equal(channelSends.length,0);button("Recuperar borrador de conversación").click();
    await waitFor(()=>document.querySelector(".messaging_image_queue"));assert.equal(document.querySelector("#slack_message").value,"Imagen del hilo");assert.match(document.querySelector(".slack_task_draft").textContent,/verificará/);
    document.querySelector(".slack_composer").dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));await waitFor(()=>channelSends.length===1 && !document.querySelector(".messaging_image_queue"));
    assert.equal(channelSends[0].attempt.client_id,clientId);assert.equal(channelSends[0].attempt.parent_id,parentId);assert.equal(channelSends[0].attempt.task_id,taskId);assert.equal(await channelSends[0].file.text(),"img");
    document.querySelector('[aria-label="Volver al canal"]').click();await waitFor(()=>button("Recuperar borrador de conversación"));button("Recuperar borrador de conversación").click();await waitFor(()=>document.querySelector("#slack_message")?.value==="Borrador distinto del canal");assert.equal(channelSends.length,1);
    console.log("Channel recovery UI passed: thread/root isolation, task reference without cached title, file bytes and immutable pending destination/UUID.");
}finally{root?.unmount();vault.suspend();await server.close();dom.window.close();}
