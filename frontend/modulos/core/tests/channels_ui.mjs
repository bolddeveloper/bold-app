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
const department={id:departmentId,name:"IT",color:"#4760A8",can_create:true,can_edit_icon:true};
const homeDepartment={id:"00000000-0000-4000-8000-000000000003",name:"Diseño"};
core.activeAssignment.unitId=homeDepartment.id;
let channel={id:channelId,name:"General",description:"Contexto del equipo",department,version:1,activity_version:2,can_manage:true,can_configure:true,can_manage_access:true,can_send:true,archived_at:null,visibility:"public"};
let accessMembers=[],accessReads=0,accessWrites=0,peopleQueries=[],channelUpdates=[];
const invitee={employee_id:"00000000-0000-4000-8000-000000000021",name:"Colega invitado",avatar_url:null,departments:[department]};
let mentionQueries=[],mentionSignals=[],mentionDelay=null,mentionFailure=null,mentionRefine=false;
const makeMessage=(id,body,parent=null,author="me") => ({id,body,parent_id:parent,channel_id:channelId,sequence:Number(id),version:1,author:{employee_id:author,name:author === "me" ? "Mi cuenta" : "Colega"},department:{name:author === "me" ? "IT" : "Marketing",color:"#9250A3"},created_at:new Date().toISOString(),editable_until:new Date(Date.now()+600000).toISOString(),can_edit:author === "me",reply_count:0});
let rows=[makeMessage("1","Guía https://example.com <script>no ejecutar</script>",null,"peer"),makeMessage("2","Mi mensaje")];
let calls=0, sends=0, failSend=false, attempted=[], releaseSend, channelCreates=[];
let channelDeleted=false,channelDeleteFails=false,channelDeletes=[];
let mediaAttempts=[],failMediaAt=0,validationMedia=false,mediaDownloads=0;
const taskId="00000000-0000-4000-8000-000000000010", taskFixture={id:taskId,title:"Revisión de prueba",status:"Pendiente",completed:false};
let taskReadable=true, searches=0;
const readCursors=new Map();let reads=0,deepLoads=0;
const threadPreferences=new Map();let threadWrites=0,threadWriteFails=false;
const pendingCount=()=>rows.filter(row=>row.author.employee_id!=="me" && row.sequence>(readCursors.get(row.parent_id || "root") || 0)).length;
const channelSnapshot=()=>({...channel,activity_version:rows.at(-1)?.sequence || 0,unread_count:pendingCount()});
const confirmed=new Map();
let privateServers=[],serverCreates=[],iconWrites=[],personalServerOrder=[];
const categoryScopes=new Map(),categoryMoves=[],channelCategoryMoves=[],categoryCreations=[];let categoryCreateFails=false,categoryDeleteFails=false;const categoryEdits=[],categoryDeletes=[];
let categoryReadFailure=null,channelReadFailure=null,departmentReadFailure=null,serverReadFailure=null;
const categoryKey=scope=>scope.server ? 'server:'+scope.server:scope.unit;
const categoryCatalog=scope=>({scope:categoryKey(scope),can_manage:true,results:(categoryScopes.get(categoryKey(scope)) || []).map(row=>({...row}))});
const preferenceAttempts=[],preferenceConfirmed=new Map();let preferenceFails=false;
const threadProjection=row=>({...row,can_manage_thread:true,can_edit_thread:true,can_close_thread:!row.thread_deleted_at,can_reply_thread:!(row.thread_closed_at || row.thread_locked || row.thread_deleted_at),...Object.fromEntries(Object.entries(threadPreferences.get(row.id) || {}).filter(([key])=>key!=='parent_id').map(([key,value])=>['thread_'+key,value]))});
globalThis.__channelsApi={
    threadPreferences:async(_,id,values)=>{preferenceAttempts.push(values);let state=preferenceConfirmed.get(values.client_id);if(!state){const before=threadPreferences.get(id) || {state_version:0,following:false};state={...before,parent_id:id,state_version:before.state_version+1,...(values.favorite!=null ? {favorite:values.favorite}:{}),...(values.left!=null ? {left:values.left}:{}),...(values.notifications ? {notifications:values.notifications}:{}),...(values.mute ? {muted_forever:values.mute==='forever',muted_until:values.mute==='1h' ? new Date(Date.now()+3600000).toISOString():null}:{})};threadPreferences.set(id,state);preferenceConfirmed.set(values.client_id,state);}if(preferenceFails)throw {status:0};return state;},
    manageThread:async(_,id,values)=>{const row=rows.find(row=>row.id===id);Object.assign(row,values.action==='rename' ? {thread_title:values.title}:values.action==='close' ? {thread_closed_at:new Date().toISOString()}:values.action==='open' ? {thread_closed_at:null}:values.action==='lock' ? {thread_locked:true,thread_closed_at:new Date().toISOString()}:values.action==='unlock' ? {thread_locked:false}:values.action==='delete' ? {thread_deleted_at:new Date().toISOString(),thread_closed_at:new Date().toISOString()}:{thread_deleted_at:null});row.version++;return {message:threadProjection(row)};},
    readThread:async(_,id)=>({message:{...threadProjection(rows.find(row=>row.id===id)),unread_reply_count:0},channel:channelSnapshot()}),
    categories:async scope=>{if(categoryReadFailure)throw categoryReadFailure;return categoryCatalog(scope);},
    createCategory:async(scope,values)=>{categoryCreations.push(values);const key=categoryKey(scope),rows=categoryScopes.get(key) || [];if(!rows.some(row=>row.id===values.client_id))rows.push({id:values.client_id,name:values.name,position:rows.length,version:1});categoryScopes.set(key,rows);if(categoryCreateFails)throw {status:0};return categoryCatalog(scope);},
    updateCategory:async(scope,id,values)=>{const row=categoryScopes.get(categoryKey(scope)).find(item=>item.id===id);categoryEdits.push({scope,id,values});assert.equal(values.version,row.version);row.name=values.name;row.version++;return categoryCatalog(scope);},
    deleteCategory:async(scope,id,values)=>{categoryDeletes.push({scope,id,values});if(categoryDeleteFails)throw {status:500};const key=categoryKey(scope);categoryScopes.set(key,categoryScopes.get(key).filter(row=>row.id!==id));if(channel.category_id===id)channel={...channel,category_id:null,version:channel.version+1};return categoryCatalog(scope);},
    moveCategory:async(scope,id,values)=>{categoryMoves.push({scope,id,values});const rows=categoryScopes.get(categoryKey(scope)),row=rows.find(item=>item.id===id),rest=rows.filter(item=>item.id!==id),index=rest.findIndex(item=>item.id===values.before_id);rest.splice(index<0 ? rest.length:index,0,row);categoryScopes.set(categoryKey(scope),rest.map((item,i)=>({...item,position:i,version:item.version+1})));return categoryCatalog(scope);},
    moveChannelCategory:async(scope,id,values)=>{channelCategoryMoves.push({scope,id,values});channel={...channel,category_id:values.category_id,version:channel.version+1};return {channel:channelSnapshot()};},
    serverOrder:async()=>personalServerOrder,
    saveServerOrder:async order=>{personalServerOrder=[...order];return {slack_server_order:order};},
    serverIcon:async()=>({avatar_url:null,icon_version:0,can_edit_icon:true}),
    updateServerIcon:async(kind,id,values)=>{iconWrites.push({kind,id,values});return {avatar_url:null,icon_version:1,can_edit_icon:true};},
    servers:async()=>{if(serverReadFailure)throw serverReadFailure;return {results:privateServers};},
    createServer:async values=>{serverCreates.push(values);const row={id:'00000000-0000-4000-8000-000000000055',...values,private:true,can_manage:true,can_create:true,version:1};privateServers.push(row);return row;},
    server:async id=>({...privateServers.find(row=>row.id===id),members:[]}),
    departments:async () => {calls++;if(departmentReadFailure)throw departmentReadFailure;return {results:[department,homeDepartment],can_create_independent:true};},
    people:async (filters,options,next)=>{peopleQueries.push(filters);return {results:next ? [{...invitee,employee_id:"00000000-0000-4000-8000-000000000022",name:"Segunda colega"}] : [invitee],departments:[{...department,count:2}],next:filters.department && !next ? `/api/v2/messaging/channels/people/?channel=${channel.id}&department=${departmentId}&cursor=two` : null};},
    mentionPeople:async(_,query,options)=>{mentionQueries.push(query);mentionSignals.push(options?.signal);if(mentionFailure)throw mentionFailure;if(mentionDelay)return mentionDelay;return {results:[{employee_id:'peer',name:'Colega',email:'peer@bold.gt',token:'@peer@bold.gt'},{employee_id:'other',name:'Otra persona',email:'other@bold.gt',token:'@other@bold.gt'}].filter(row=>!query || row.name.toLowerCase().includes(query.toLowerCase()) || row.email.includes(query)),refine:mentionRefine};},
    managed:async()=>({results:[channel],next:null}),
    access:async()=>{accessReads++;return {...channel,members:accessMembers.map(row=>row.employee_id===invitee.employee_id ? {...invitee,...row}:row)};},
    setAccess:async(_,values)=>{accessWrites++;accessMembers=values.members;channel={...channel,visibility:values.visibility,version:channel.version+1};return {...channel,members:accessMembers};},
    list:async (archived,_next,_options,{unit,server}={}) => {
        calls++;
        const available=!channelReadFailure && !channelDeleted && (!channel.archived_at || archived);
        const scope=channel.department?.id || 'independent';
        const visible=available && (!unit || unit===scope && !channel.server) && (!server || server===channel.server?.id);
        return {results:visible ? [channelSnapshot()] : [],departments:visible && channel.department ? [channel.department] : [],next:null};
    },
    deleteChannel:async(id,version,options)=>{channelDeletes.push({id,version,options});if(channelDeleteFails)throw {status:409,fields:{detail:'El canal cambió. Actualiza su configuración antes de eliminarlo.'}};channelDeleted=true;},
    detail:async()=>{deepLoads++;if(channelReadFailure)throw channelReadFailure;return channelSnapshot();},
    message:async(_,id)=>({message:threadProjection(rows.find(row=>row.id===id))}),
    follow:async(_,following)=>{channel={...channel,following,state_version:(channel.state_version || 0)+1};return channelSnapshot();},
    threads:async(_channel,query='',_next,_options,filters={})=>({results:rows.filter(row=>!row.parent_id && (row.thread_started_at || rows.some(reply=>reply.parent_id===row.id)) && (row.thread_title || row.body).toLowerCase().includes(query.toLowerCase()) && (filters.state==='deleted' ? !!row.thread_deleted_at:!row.thread_deleted_at) && (!filters.favorite || threadPreferences.get(row.id)?.favorite)).map(threadProjection),next:null}),
    pins:async()=>({results:rows.filter(row=>row.pinned_at),next:null}),
    startThread:async(_channel,id,title)=>{const message=rows.find(row=>row.id===id);if(!message.thread_started_at)Object.assign(message,{thread_title:title,thread_started_at:new Date().toISOString(),version:message.version+1});return {message:{...message}};},
    pin:async(_channel,id,pinned)=>{const message=rows.find(row=>row.id===id);Object.assign(message,{pinned_at:pinned ? new Date().toISOString():null,version:message.version+1});return {message:{...message}};},
    followThread:async(_,parent,following)=>{threadWrites++;if(threadWriteFails)throw {status:429};const previous=threadPreferences.get(parent) || {following:false,state_version:0};const state={parent_id:parent,following,state_version:previous.state_version+(previous.following!==following ? 1:0)};threadPreferences.set(parent,state);return state;},
    read:async(_,id)=>{reads++;const row=rows.find(row=>row.id===id);assert.ok(row);const key=row.parent_id || "root";readCursors.set(key,Math.max(readCursors.get(key) || 0,row.sequence));channel={...channel,state_version:(channel.state_version || 0)+1};return {channel:channelSnapshot(),read_sequence:readCursors.get(key),parent_id:row.parent_id};},
    messages:async (_,parent) => {calls++; return {results:rows.filter(row => row.parent_id === (parent || null)).sort((a,b) => b.sequence-a.sequence).map(row => ({...row,thread_following:threadPreferences.get(row.id)?.following || false,thread_state_version:threadPreferences.get(row.id)?.state_version || 0,task:row.task && !taskReadable ? {available:false} : row.task,reply_count:rows.filter(reply => reply.parent_id === row.id).length,unread_reply_count:rows.filter(reply=>reply.parent_id===row.id && reply.author.employee_id!=="me" && reply.sequence>(readCursors.get(row.id) || 0)).length})),next:null,channel:channelSnapshot(),thread_source:parent ? threadProjection(rows.find(row=>row.id===parent)):undefined,thread:parent ? {parent_id:parent,following:false,state_version:0,...threadPreferences.get(parent)}:undefined};},
    tasks:async (_,query) => {searches++;return {results:query.includes("Revisión") && taskReadable ? [taskFixture] : [],next:null};},
    task:async id => {assert.equal(id,taskId);if (!taskReadable) throw {status:404};return taskFixture;},
    send:async (_,values) => {
        sends++; attempted.push(values.client_id);
        if (values.task_id && !taskReadable) throw {status:404};
        if (releaseSend) await new Promise(resolve => {releaseSend=resolve;});
        let message=confirmed.get(values.client_id);
        if (!message) {message={...makeMessage(String(rows.length+1),values.body,values.parent_id),...(values.thread_title ? {thread_title:values.thread_title,thread_started_at:new Date().toISOString()}:{}),task:values.task_id ? {...taskFixture,available:true} : null}; confirmed.set(values.client_id,message); rows.push(message);}
        if (failSend) throw {status:0};
        return {message};
    },
    sendMedia:async (_,values,file) => {
        mediaAttempts.push({values,file});
        if(validationMedia) throw {status:400,fields:{file:["Archivo rechazado."]}};
        let message=confirmed.get(values.client_id);
        if(!message){message={...makeMessage(String(rows.length+1),values.body,values.parent_id),media:{id:values.client_id,kind:file.type.startsWith("image/") ? "image" : file.type.startsWith('audio/') ? "audio":'document',mime_type:file.type,size_bytes:file.size,width:80,height:50,filename:file.name},task:values.task_id ? {...taskFixture,available:true} : null};confirmed.set(values.client_id,message);rows.push(message);}
        if(failMediaAt===mediaAttempts.length) throw {status:0};
        return {message};
    },
    media:async (_,id)=>{mediaDownloads++;assert.ok(rows.find(row=>row.id===id)?.media);return new Blob(["private-pixels"],{type:"image/webp"});},
    edit:async (_,id,values) => {const index=rows.findIndex(row => row.id === id); rows[index]={...rows[index],body:values.body,version:rows[index].version+1,edited_at:new Date().toISOString()}; return {message:rows[index]};},
    update:async (_,values) => {
        channelUpdates.push(values);
        const {access,...settings}=values;
        if(access) accessMembers=access.members;
        channel={...channel,...settings,visibility:access?.visibility || channel.visibility,version:channel.version+1,...("archived" in values ? {archived_at:values.archived ? new Date().toISOString() : null,can_send:!values.archived} : {})};
        return channel;
    },
    create:async values => {channelCreates.push(values);channel={...channel,id:`00000000-0000-4000-8000-${String(channelCreates.length+2).padStart(12,'0')}`,name:values.name,description:values.description,category_id:values.category_id || null,department:values.unit_id ? department : null,server:values.server_id ? privateServers.find(row=>row.id===values.server_id):null,version:1}; return channel;},
};
const replacements=[
    ["/core/core_provider.jsx","export const useCore=()=>globalThis.__channelsCore;"],
    ["/core/app_shell.jsx","export const useShell=()=>globalThis.__channelsShell;"],
    ["/core/shared/bold_dialog.js","export const confirmBold=async()=>globalThis.__channelsConfirm !== false;export const promptBold=async(_,value)=>globalThis.__categoryName===undefined ? value:globalThis.__categoryName;"],
    // Parent-navigation contract only; the real page/CRDT components have their
    // own acceptance suites, including unsaved drafts and recovery.
    ["/mensajeria/channel_pages.jsx",'export default function Pages({onDirty}){return <section aria-label="Página sintética"><button onClick={()=>onDirty(true)}>Simular página pendiente</button></section>;}'],
];
const server=await createServer({configFile:false,plugins:[{name:"isolated-channels",enforce:"pre",transform(_,id) {const name=id.replaceAll("\\","/"); return replacements.find(([suffix]) => name.endsWith(suffix))?.[1];}}],
    resolve:{dedupe:["react","react-dom","lucide-react"]},esbuild:{jsx:"automatic",jsxImportSource:"react"},cacheDir:path.join(os.tmpdir(),"bold-channels-ui"),optimizeDeps:{noDiscovery:true,include:[],entries:[]},server:{middlewareMode:true,hmr:false},appType:"custom"});
const {default:React}=await import("react"),{createRoot}=await import("react-dom/client");
const load=file => server.ssrLoadModule(`/@fs/${path.resolve(file).replaceAll("\\","/")}`);
const {channelApi}=await load("../mensajeria/channel_api.js");
Object.assign(channelApi,globalThis.__channelsApi);
const {default:Channels}=await load("../mensajeria/channel_module.jsx");
const {resourceApi}=await load('../mensajeria/resource_api.js');
resourceApi.list=async()=>({results:[],next_cursor:null,first_cursor:'first',snapshot_at:new Date().toISOString()});
const root=createRoot(document.getElementById("root"));
const settle=()=>new Promise(resolve => setTimeout(resolve,40));
const waitFor=async predicate => {const deadline=Date.now()+4000; while (!predicate() && Date.now()<deadline) await settle(); assert.ok(predicate(),"expected channel UI state");};
const button=text => [...document.querySelectorAll("button")].find(node => node.textContent === text);
const threadOption=()=>[...document.querySelectorAll('.messaging_message_menu:not([hidden]) button')].find(node=>['Crear hilo','Abrir hilo'].includes(node.textContent));
const input=(field,text) => {const prototype=field instanceof dom.window.HTMLTextAreaElement ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype,"value").set.call(field,text); field.dispatchEvent(new Event("input",{bubbles:true}));};
const submit=()=>document.querySelector(".slack_composer").dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));
try {
    departmentReadFailure={status:503};
    root.render(React.createElement(Channels));
    await waitFor(()=>document.querySelector(".slack_sidebar nav button"));
    assert.equal(document.querySelector('.slack_sidebar h1').textContent,'IT','the catalog opens the server of an authorized public channel when departments fail');
    assert.equal(document.querySelectorAll('.slack_rail_channel').length,2,'authorized channel scopes still appear in the rail');
    assert.ok(button('Reintentar'),'the partial catalog exposes a retry');
    departmentReadFailure=null;
    button('Reintentar').click();
    await waitFor(()=>document.querySelector('[aria-label="Abrir servidor Diseño"]') && !button('Reintentar'));
    assert.equal(document.querySelector('.slack_sidebar h1').textContent,'IT','an empty active department does not hide authorized channels');
    document.querySelector('.slack_sidebar nav button').click();
    await waitFor(()=>document.querySelectorAll(".slack_active_conversation .slack_message").length===2);
    document.querySelector('.slack_channel_item').dispatchEvent(new dom.window.MouseEvent('contextmenu',{bubbles:true,cancelable:true}));await settle();
    assert.ok(button('Eliminar canal'),'the text-channel context menu exposes deletion');
    assert.ok(button('Configurar canal'),'the text-channel context menu exposes its existing settings');
    button('Configurar canal').click();await waitFor(()=>document.querySelector('.slack_channel_editor'));
    button('Cancelar').click();await waitFor(()=>!document.querySelector('.slack_channel_editor'));
    categoryReadFailure={status:403};
    window.dispatchEvent(new CustomEvent('bold:slack-event',{detail:{payload:{kind:'channel.categories_changed',scope:departmentId}}}));
    await waitFor(()=>document.querySelector('.slack_error'));
    await settle();
    assert.equal(document.querySelectorAll('.slack_active_conversation .slack_message').length,2,'denying category administration must not hide an authorized channel');
    assert.match(document.querySelector('.slack_error').textContent,/El canal sigue disponible/);
    assert.ok(document.querySelector('.slack_sidebar nav button'),'a denied subpanel keeps the text-channel catalog');
    categoryReadFailure=null;
    window.dispatchEvent(new CustomEvent('bold:slack-event',{detail:{payload:{kind:'channel.categories_changed',scope:departmentId}}}));
    const invitedServer={id:'00000000-0000-4000-8000-000000000099',name:'Invitación recibida',private:true,can_manage:false,can_create:false,version:1};
    privateServers.push(invitedServer);
    window.dispatchEvent(new CustomEvent('bold:messaging-reconnect'));
    await waitFor(()=>document.querySelector('[aria-label="Abrir servidor Invitación recibida"]'));
    assert.ok(document.querySelector('.slack_active_conversation'),'receiving a server invitation does not close the current channel');
    serverReadFailure={status:503};
    window.dispatchEvent(new CustomEvent('bold:messaging-reconnect'));
    await waitFor(()=>button('Reintentar'));
    assert.ok(document.querySelector('[aria-label="Abrir servidor Invitación recibida"]'),'a transient catalog failure keeps the last authorized server list');
    assert.ok(document.querySelector('.slack_active_conversation'));
    serverReadFailure=null;
    button('Reintentar').click();await waitFor(()=>!button('Reintentar'));
    channelReadFailure={status:404};categoryReadFailure={status:403};
    window.dispatchEvent(new CustomEvent('bold:slack-event',{detail:{payload:{kind:'channel.categories_changed',scope:departmentId}}}));
    await waitFor(()=>!document.querySelector('.slack_active_conversation'));
    assert.equal(document.querySelector('.slack_message'),null,'confirmed channel revocation still clears private history');
    assert.ok(document.querySelector('[aria-label="Abrir servidor Invitación recibida"]'),'revoking one channel does not hide other invited servers');
    categoryReadFailure=null;channelReadFailure=null;privateServers=[];
    window.dispatchEvent(new CustomEvent('bold:messaging-reconnect'));
    await waitFor(()=>!document.querySelector('[aria-label="Abrir servidor Invitación recibida"]') && document.querySelector('.slack_sidebar nav button'));
    document.querySelector('.slack_sidebar nav button').click();
    await waitFor(()=>document.querySelectorAll('.slack_active_conversation .slack_message').length===2);
    const normalMessages=channelApi.messages;let rejectStale;
    channelApi.messages=async()=>{channelApi.messages=normalMessages;return new Promise((_,reject)=>{rejectStale=reject;});};
    window.dispatchEvent(new CustomEvent('bold:slack-event',{detail:{payload:{channel_id:channelId,kind:'message.created'}}}));
    await waitFor(()=>rejectStale);
    document.querySelector('[aria-label="Abrir servidor Independientes"]').click();await settle();
    rejectStale({status:404});await settle();
    assert.equal(document.querySelector('.slack_error'),null,'a late read failure from the previous channel cannot deny the new view');
    document.querySelector('[aria-label="Abrir servidor IT"]').click();await waitFor(()=>document.querySelector('.slack_sidebar nav button'));
    document.querySelector('.slack_sidebar nav button').click();
    await waitFor(()=>document.querySelectorAll('.slack_active_conversation .slack_message').length===2);
    assert.equal(document.querySelector('.slack_module').classList.contains('slack_explorer_open'),false,'choosing a channel leaves more room for its messages');
    input(document.querySelector('#slack_message'),'Borrador de navegación');await settle();
    const beforeNavigation=calls;
    document.querySelector('[aria-label="Buscar servidores"]').click();await settle();
    assert.equal(document.querySelector('.slack_rail').classList.contains('is_expanded'),true);
    document.querySelector('[aria-label="Cerrar buscador de servidores"]').click();await settle();
    assert.equal(document.querySelector('#slack_message').value,'Borrador de navegación','opening the browser does not replace the channel or its draft');
    assert.equal(calls,beforeNavigation,'expanding the navigator adds no background requests');
    document.querySelector('[aria-label="Buscar servidores"]').click();await settle();
    input(document.querySelector('[aria-label="Servidores de Slack"] input'),'indepen');await settle();
    assert.equal(document.querySelectorAll('.slack_rail_channel').length,1,'server search filters server names, not text channels');
    assert.equal(document.querySelector('.slack_rail_channel').getAttribute('aria-label'),'Abrir servidor Independientes');
    document.querySelector('[aria-label="Cerrar buscador de servidores"]').click();await settle();
    input(document.querySelector('#slack_message'),'');await settle();
    const railButton=document.querySelector('.slack_rail_channel');railButton.focus();
    document.querySelector('.slack_rail_channels').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));
    assert.equal(document.activeElement,document.querySelectorAll('.slack_rail_channel')[1],'server rail supports keyboard navigation');
    assert.equal(document.querySelector(".slack_message script"),null);
    assert.match(document.querySelector(".slack_message_body").textContent,/<script>/);
    assert.match(document.querySelector(".slack_message_card .slack_department").textContent,/Marketing/);
    assert.equal(document.querySelector(".slack_message_body a").rel,"noopener noreferrer");
    assert.equal([...document.querySelectorAll("button")].filter(node=>node.textContent === "Editar mi mensaje").length,1);
    document.querySelector('[aria-label="Abrir chat con Colega"]').click(); assert.deepEqual(opens,["peer"]);
    document.querySelector('[aria-label="Abrir servidor IT"]').dispatchEvent(new dom.window.MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:50,clientY:50}));
    await waitFor(()=>document.querySelector('.slack_server_context'));
    button('Cambiar imagen del servidor').click();await waitFor(()=>document.querySelector('.slack_icon_editor'));
    assert.equal(document.querySelector('.slack_icon_editor input:not([type=file])'),null,'server appearance has no name editor');
    assert.ok(document.querySelector('.slack_main').hasAttribute('inert'));
    assert.equal(iconWrites.length,0,'opening appearance never changes the icon');
    document.querySelector('[aria-label="Cerrar imagen del servidor"]').click();await waitFor(()=>!document.querySelector('.slack_icon_editor'));
    const idle=calls; await settle(); assert.equal(calls,idle,"idle does not poll");
    button('Archivos y enlaces').click();await waitFor(()=>document.querySelector('.resource_library'));
    assert.ok(document.querySelector('.slack_main').hasAttribute('inert'));assert.ok(document.querySelector('.slack_sidebar').hasAttribute('inert'));
    document.querySelector('[aria-label="Cerrar biblioteca"]').click();await waitFor(()=>!document.querySelector('.resource_library'));
    input(document.querySelector('#slack_message'),'Hola colega');await settle();
    document.querySelector('[aria-label="Mencionar a una persona"]').click();await waitFor(()=>document.querySelector('.slack_mention_picker'));
    assert.ok(document.querySelector('.slack_main').hasAttribute('inert'));
    input(document.querySelector('.slack_mention_picker input'),'Colega');await settle();assert.equal(mentionQueries.length,0);
    document.querySelector('.slack_mention_picker form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    await waitFor(()=>document.querySelector('.slack_mention_picker .slack_task_results button'));
    document.querySelector('.slack_mention_picker .slack_task_results button').click();await waitFor(()=>!document.querySelector('.slack_mention_picker'));
    assert.equal(document.querySelector('#slack_message').value,'Hola colega @peer@bold.gt ');
    await waitFor(()=>document.activeElement===document.querySelector('#slack_message'));
    assert.equal(sends,0,'choosing a mention never sends the draft');
    input(document.querySelector('#slack_message'),'');await settle();
    const inlineSends=sends,beforeInline=mentionQueries.length,composerField=document.querySelector('#slack_message');
    composerField.focus();input(composerField,'persona@bold.gt');await settle();assert.equal(document.querySelector('.messaging_mention_suggestions'),null);
    input(composerField,'Hola @');await waitFor(()=>document.querySelectorAll('.messaging_mention_suggestions [role=option]').length===2);
    assert.equal(document.activeElement,composerField);assert.equal(document.querySelector('.slack_main').hasAttribute('inert'),false);
    composerField.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));await settle();
    assert.match(document.querySelector('.messaging_mention_suggestions [aria-selected=true]').textContent,/Otra persona/);
    input(composerField,'Hola @col');await waitFor(()=>document.querySelectorAll('.messaging_mention_suggestions [role=option]').length===1);
    assert.equal(mentionQueries.length,beforeInline+1,'complete authorized roster filters locally');
    assert.equal(composerField.getAttribute('aria-activedescendant'),document.querySelector('.messaging_mention_suggestions [role=option]').id);
    composerField.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await waitFor(()=>!document.querySelector('.messaging_mention_suggestions'));
    assert.equal(composerField.value,'Hola @peer@bold.gt ');assert.equal(sends,inlineSends,'Enter selects without sending');
    let releaseMention;mentionDelay=new Promise(resolve=>{releaseMention=resolve;});input(composerField,'@');await waitFor(()=>mentionQueries.length===beforeInline+2);
    composerField.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await waitFor(()=>!document.querySelector('.messaging_mention_suggestions'));
    assert.equal(mentionSignals.at(-1).aborted,true);assert.equal(composerField.value,'@');
    releaseMention({results:[{employee_id:'late',name:'Tardío',email:'late@bold.gt',token:'@late@bold.gt'}],refine:false});mentionDelay=null;await settle();assert.equal(document.querySelector('.messaging_mention_suggestions'),null);
    input(composerField,'');await settle();mentionFailure={status:500};input(composerField,'@');await waitFor(()=>document.querySelector('.messaging_mention_suggestions [role=alert]'));
    assert.equal(composerField.value,'@');mentionFailure=null;document.querySelector('.messaging_mention_suggestions [role=alert] button').click();await waitFor(()=>document.querySelectorAll('.messaging_mention_suggestions [role=option]').length===2);
    composerField.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));input(composerField,'');await settle();
    mentionRefine=true;const beforeRefine=mentionQueries.length;input(composerField,'@');await waitFor(()=>document.querySelectorAll('.messaging_mention_suggestions [role=option]').length===2);
    input(composerField,'@p');await settle();input(composerField,'@pe');await settle();input(composerField,'@peer');
    await waitFor(()=>mentionQueries.length===beforeRefine+2);await waitFor(()=>document.querySelectorAll('.messaging_mention_suggestions [role=option]').length===1);
    assert.equal(mentionQueries.at(-1),'peer','a partial roster searches the server after typing settles');
    composerField.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));mentionRefine=false;input(composerField,'');await settle();
    const channelSearch=document.querySelector('.slack_channel_search input');
    input(channelSearch,'genreal');await settle();assert.match(document.querySelector('.slack_sidebar nav').textContent,/General/);
    assert.equal(document.querySelector('.slack_sidebar h1').textContent,'IT','search remains inside the active server');
    input(channelSearch,'inexistente');await settle();assert.equal(document.querySelector('.slack_sidebar nav section'),null);
    document.querySelector('[aria-label="Limpiar buscar canal"]').click();await settle();await waitFor(()=>document.querySelector('.slack_sidebar nav button'));
    assert.equal(reads,0,"loading history without visibility evidence never acknowledges it");
    document.querySelector('.slack_sidebar nav button').click();await settle();assert.equal(document.querySelectorAll('.slack_message').length,2,"reselecting the same channel keeps its history");
    button("Seguir canal").click();await waitFor(()=>button("Dejar de seguir canal"));assert.equal(button("Dejar de seguir canal").getAttribute("aria-pressed"),"true");
    button("Dejar de seguir canal").click();await waitFor(()=>button("Seguir canal"));assert.equal(pendingCount(),1,"unfollowing keeps unread history");
    button("Marcar vista como leída").click();await waitFor(()=>reads===1);await settle();assert.equal(pendingCount(),0);
    input(document.querySelector("#slack_message"),"Mensaje de prueba"); await settle();
    releaseSend=true; submit(); submit(); await settle(); assert.equal(sends,1);
    releaseSend(); releaseSend=null;
    await waitFor(()=>document.querySelectorAll(".slack_active_conversation .slack_message").length===3);
    assert.equal(document.querySelector("#slack_message").value,"");
    failSend=true; input(document.querySelector("#slack_message"),"Respuesta perdida"); await settle(); submit();
    await waitFor(()=>document.querySelector('[role="alert"]'));
    assert.ok(document.querySelector("#slack_message").disabled,"uncertain send payload stays immutable");
    const retryId=attempted.at(-1); failSend=false; submit();
    await waitFor(()=>document.querySelectorAll(".slack_active_conversation .slack_message").length===4);
    assert.equal(attempted.at(-1),retryId); assert.equal(rows.filter(row=>row.body === "Respuesta perdida").length,1);
    document.querySelector('.slack_active_conversation [aria-label="Opciones de este mensaje"]').click();await waitFor(()=>button('Fijar mensaje'));
    button('Fijar mensaje').click();await waitFor(()=>rows[0].pinned_at);
    document.querySelector('.slack_active_conversation [aria-label="Opciones de este mensaje"]').click();await settle();
    document.querySelector('[aria-label="Mensajes fijados"]').click();await waitFor(()=>document.querySelector('.slack_catalog_card'));
    assert.ok(document.querySelector('.slack_catalog_card').textContent.includes(rows[0].body));
    document.querySelector('[aria-label="Cerrar lista"]').click();
    assert.equal(button('Responder en hilo'),undefined,'thread actions no longer occupy a footer below each message');
    document.querySelector('.slack_active_conversation [aria-label="Opciones de este mensaje"]').click();await waitFor(()=>threadOption());
    threadOption().click(); await waitFor(()=>document.querySelector(".slack_thread_context")); await settle();
    assert.ok(document.querySelector('.slack_channel_context'),'opening a thread keeps the channel alongside it');
    assert.equal(document.querySelector('.slack_thread_link'),null,'the source preview uses the same compact message actions');
    input(document.querySelector('[aria-label="Nombre del hilo"]'),'Revisión de diseño');await settle();document.querySelector('.slack_thread_name button').click();
    await waitFor(()=>rows[0].thread_title==='Revisión de diseño');
    await waitFor(()=>!document.querySelector('[aria-label="Hilos del canal"]').disabled);
    await waitFor(()=>document.querySelector('.slack_channel_context .slack_thread_started button'));
    document.querySelector('.slack_channel_context .slack_thread_started button').click();await waitFor(()=>document.querySelector('.slack_catalog_card')?.textContent.includes('Revisión de diseño'));
    assert.match(document.querySelector('.slack_catalog_card').textContent,/Revisión de diseño/);
    input(document.querySelector('[aria-label="Buscar hilo"]'),'No existe');await waitFor(()=>!document.querySelector('.slack_catalog_card'));
    document.querySelector('[aria-label="Cerrar lista"]').click();
    await waitFor(()=>button("Seguir hilo") && !button("Seguir hilo").disabled);
    input(document.querySelector("#slack_message"),"Borrador del hilo");await settle();
    threadWriteFails=true;button("Seguir hilo").click();await waitFor(()=>document.querySelector('[role="alert"]')?.textContent.includes("Espera"));
    assert.equal(button("Seguir hilo").getAttribute("aria-pressed"),"false");
    assert.equal(document.querySelector("#slack_message").value,"Borrador del hilo");
    threadWriteFails=false;button("Seguir hilo").click();await waitFor(()=>button("Dejar de seguir hilo"));
    assert.equal(button("Dejar de seguir hilo").getAttribute("aria-pressed"),"true");
    assert.equal(document.querySelector("#slack_message").value,"Borrador del hilo");
    button("Dejar de seguir hilo").click();await waitFor(()=>button("Seguir hilo"));
    assert.equal(threadWrites,3);assert.equal(channel.following,false,"thread following never opts into the channel");
    input(document.querySelector('#slack_message'),'@col');await waitFor(()=>document.querySelector('.messaging_mention_suggestions [role=option]'));
    document.querySelector('.messaging_mention_suggestions [role=option]').click();await waitFor(()=>!document.querySelector('.messaging_mention_suggestions'));
    assert.equal(document.querySelector('#slack_message').value,'@peer@bold.gt ');assert.ok(document.querySelector('.slack_thread_context'),'mention stays inside the thread');
    input(document.querySelector("#slack_message"),"En el hilo"); await settle(); submit();
    await waitFor(()=>document.querySelectorAll(".slack_active_conversation .slack_message").length===1);
    assert.equal(rows.at(-1).parent_id,"1");
    document.querySelector('.slack_channel_context [aria-label="Opciones de este mensaje"]').click();await waitFor(()=>threadOption());
    threadOption().click();await settle();
    assert.equal(document.querySelectorAll('.slack_active_conversation .slack_message').length,1,'reopening the same thread preserves its loaded replies');
    document.querySelector('[aria-label="Volver al canal"]').click(); await waitFor(()=>document.querySelectorAll(".slack_active_conversation .slack_message").length===4);
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
    const taskOpens=[];const onTask=event=>taskOpens.push(event.detail);window.addEventListener('bold:brand-resource',onTask);
    document.querySelector('.slack_task_card').click();await waitFor(()=>taskOpens.length===1);assert.deepEqual(taskOpens,[{task:taskId,context:'slack'}]);
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
    const messageCard=document.querySelector('.slack_active_conversation .slack_message_card');
    await waitFor(()=>!messageCard.querySelector('[aria-label="Opciones de este mensaje"]').disabled);await settle();
    const contextMenu=new dom.window.MouseEvent('contextmenu',{bubbles:true,cancelable:true});messageCard.dispatchEvent(contextMenu);
    assert.ok(contextMenu.defaultPrevented,'right click opens message actions instead of the browser menu');await waitFor(()=>threadOption());
    threadOption().click();await waitFor(()=>document.querySelector('.slack_thread_context'));
    assert.equal(document.querySelector('.messaging_image_queue'),null);
    const threadPaste=new Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(threadPaste,'clipboardData',{value:{files:[secondImage]}});
    const sentBeforePreview=mediaAttempts.length;document.querySelector('.slack_active_conversation .slack_messages').dispatchEvent(threadPaste);
    await waitFor(()=>document.querySelector('.slack_active_conversation .messaging_image_queue'));assert.ok(threadPaste.defaultPrevented);
    assert.equal(mediaAttempts.length,sentBeforePreview,'pasting into a thread only prepares the local queue');
    document.querySelector('[aria-label="Quitar todas las imágenes"]').click();await waitFor(()=>!document.querySelector('.messaging_image_queue'));
    document.querySelector('[aria-label="Volver al canal"]').click();await waitFor(()=>document.querySelector('.messaging_image_queue'));
    document.querySelector('[aria-label="Quitar todas las imágenes"]').click();await waitFor(()=>!document.querySelector('.messaging_image_queue'));
    const drop=new Event('drop',{bubbles:true,cancelable:true});Object.defineProperty(drop,'dataTransfer',{value:{items:[{kind:'file',getAsFile:()=>secondImage}]}});document.querySelector('.slack_active_conversation .slack_messages').dispatchEvent(drop);
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
    // An ambiguous attachment is never silently removed. Explicit discard
    // preserves caption/file until acknowledged, then permits a fresh nonce.
    const normalMedia=channelApi.sendMedia;let abandonedMedia,discardCalls=0;
    channelApi.sendMedia=async(_id,values,file)=>{abandonedMedia={values,file};throw {status:0};};
    const pendingPicker=document.querySelector('input[type="file"][multiple]');Object.defineProperty(pendingPicker,'files',{value:[firstImage],configurable:true});pendingPicker.dispatchEvent(new Event('change',{bubbles:true}));
    await waitFor(()=>document.querySelector('.messaging_image_queue'));input(document.querySelector('#slack_message'),'Conservar esta descripción');await settle();submit();
    await waitFor(()=>document.querySelector('[aria-label="Preparación sin confirmar"] button')?.disabled===false);
    assert.ok(document.querySelector('[aria-label="Quitar imagen seleccionada"]').disabled);
    assert.ok(document.querySelector('[aria-label="Quitar todas las imágenes"]').disabled);
    channelApi.discardMedia=async(_id,nonce)=>{discardCalls++;assert.equal(nonce,abandonedMedia.values.client_id);throw {status:0};};
    globalThis.__channelsConfirm=false;document.querySelector('[aria-label="Preparación sin confirmar"] button').click();await settle();assert.equal(discardCalls,0);
    globalThis.__channelsConfirm=true;document.querySelector('[aria-label="Preparación sin confirmar"] button').click();
    await waitFor(()=>discardCalls===1 && !document.querySelector('[aria-label="Preparación sin confirmar"] button').disabled);
    assert.ok(document.querySelector('#slack_message').disabled);assert.ok(document.querySelector('.messaging_image_queue'));
    channelApi.discardMedia=async()=>({outcome:'cancelled'});document.querySelector('[aria-label="Preparación sin confirmar"] button').click();
    await waitFor(()=>!document.querySelector('[aria-label="Preparación sin confirmar"]') && !document.querySelector('#slack_message').disabled);
    assert.equal(document.querySelector('#slack_message').value,abandonedMedia.values.body);assert.ok(document.querySelector('.messaging_image_queue'));
    channelApi.sendMedia=normalMedia;submit();await waitFor(()=>!document.querySelector('.messaging_image_queue'));
    assert.notEqual(mediaAttempts.at(-1).values.client_id,abandonedMedia.values.client_id);assert.equal(mediaAttempts.at(-1).file,abandonedMedia.file);
    // A notification opens an authorized root/thread through Shell's target,
    // not a blind injection of the notification's content into the view.
    const hiddenReply=makeMessage(String(rows.length+1),'Respuesta pendiente','1','peer');rows.push(hiddenReply);
    window.dispatchEvent(new CustomEvent('bold:slack-event',{detail:{payload:{channel_id:channelId,kind:'message.created'}}}));
    await waitFor(()=>document.querySelector('.slack_thread_started .slack_unread_badge'));
    button('Marcar vista como leída').click();await settle();assert.equal(pendingCount(),1,'reading the channel keeps unseen thread replies unread');
    globalThis.__channelsShell.slack_target={channel_id:channelId,parent_id:'1',requestId:'notice-1'};root.render(React.createElement(Channels));
    await waitFor(()=>document.querySelector('.slack_thread_context'));await waitFor(()=>document.querySelector('.slack_active_conversation .slack_message_body')?.textContent==='En el hilo');
    await waitFor(()=>!button('Marcar vista como leída').disabled);
    button('Marcar vista como leída').click();await waitFor(()=>pendingCount()===0);
    const opened=deepLoads;input(document.querySelector('#slack_message'),'No reabrir por cada envío');await settle();submit();await waitFor(()=>document.querySelector('#slack_message').value==='');
    assert.equal(deepLoads,opened,'a consumed notification target is not reopened after sending');
    globalThis.__channelsShell.slack_target={channel_id:channelId,parent_id:'1',requestId:'notice-2'};root.render(React.createElement(Channels));
    await waitFor(()=>deepLoads===opened+1);await settle();assert.ok(document.querySelectorAll('.slack_message').length>0,'opening another notice for the same thread preserves its history');
    button('Páginas').click();await waitFor(()=>button('Simular página pendiente'));
    const arrivedWhileAway=makeMessage(String(rows.length+1),'Resultado recibido fuera de Mensajes','1');rows.push(arrivedWhileAway);
    button('Mensajes').click();await waitFor(()=>document.querySelector(`[data-slack-message="${arrivedWhileAway.id}"]`));
    button('Páginas').click();await waitFor(()=>button('Simular página pendiente'));
    button('Simular página pendiente').click();await settle();globalThis.__channelsConfirm=false;
    globalThis.__channelsShell.slack_target={channel_id:channelId,parent_id:'1',requestId:'notice-from-page-cancel'};root.render(React.createElement(Channels));
    await waitFor(()=>deepLoads===opened+2);await settle();
    assert.equal(button('Páginas').getAttribute('aria-pressed'),'true','opening a thread notice cannot bypass an unconfirmed page');
    assert.equal(document.querySelector('.slack_thread_context'),null);
    globalThis.__channelsConfirm=true;
    globalThis.__channelsShell.slack_target={channel_id:channelId,parent_id:'1',requestId:'notice-from-page-accept'};root.render(React.createElement(Channels));
    await waitFor(()=>document.querySelector('.slack_thread_context'));
    assert.equal(button('Mensajes').getAttribute('aria-pressed'),'true','a notice switches from Pages to the same previously opened thread');
    await waitFor(()=>document.querySelectorAll('.slack_message').length>0);
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
    const clippedMain=document.querySelector('.slack_main');clippedMain.style.overflowY='auto';
    clippedMain.getBoundingClientRect=()=>({top:-200,bottom:-10});
    checkVisible();await settle();assert.equal(reads,beforeObserved,'a scroll ancestor clipping the entire message list cannot confirm a read');
    clippedMain.getBoundingClientRect=()=>({top:0,bottom:100});
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
    assert.equal(document.querySelector('.slack_unread_badge').textContent,'9','the text-channel list uses the verified unread count');
    // Independent creation uses an actual null department, not the active unit.
    document.querySelector('[aria-label="Abrir servidor Independientes"]').click();await settle();
    await waitFor(()=>document.querySelector('.slack_sidebar h1')?.textContent==='Independientes');
    document.querySelector('[aria-label="Crear canal"]').click();await waitFor(()=>document.querySelector('.slack_editor'));
    assert.match(document.querySelector('.slack_channel_editor > header p').textContent,/Independientes/);
    assert.equal(document.querySelector('.slack_channel_editor .slack_server_context'),null,'server metadata must not use the floating context-menu class');
    assert.equal(document.querySelector('.slack_channel_appearance').open,false,'optional appearance starts collapsed');
    assert.ok(document.querySelector('.slack_access_fields.is_compact'));
    assert.ok(!document.querySelector('.slack_channel_access_help').open);
    const independentName=[...document.querySelectorAll('.slack_editor label')].find(node=>node.textContent.startsWith('Nombre')).querySelector('input');
    input(independentName,'Espacio independiente');await settle();
    document.querySelector('.slack_channel_appearance summary').click();await settle();
    input(document.querySelector('.slack_channel_editor textarea'),'Acuerdos del equipo');await settle();
    document.querySelector('[aria-label="Usar color #9250A3"]').click();await settle();
    document.querySelector('.slack_channel_appearance summary').click();await settle();
    document.querySelector('.slack_editor form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    await waitFor(()=>!document.querySelector('.slack_editor'));
    assert.equal(channelCreates.at(-1).unit_id,null);
    assert.equal(channelCreates.at(-1).color,'#9250A3');
    assert.equal(channelCreates.at(-1).description,'Acuerdos del equipo','collapsing optional fields preserves their values');
    assert.match(document.querySelector('.slack_header').textContent,/Sin departamento/);
    assert.match(document.querySelector('.slack_sidebar nav').textContent,/Espacio independiente/);
    document.querySelector('[aria-label="Abrir servidor IT"]').click();await settle();
    assert.doesNotMatch(document.querySelector('.slack_sidebar nav').textContent,/Espacio independiente/,'other servers never mix channels');
    document.querySelector('[aria-label="Abrir servidor Independientes"]').click();await settle();
    await waitFor(()=>document.querySelector('.slack_sidebar nav button'));
    document.querySelector('.slack_sidebar nav button').click();await waitFor(()=>document.querySelector('#slack_message'));
    document.querySelector('[aria-label="Configurar canal"]').click();await waitFor(()=>document.querySelector('.slack_editor'));
    assert.equal(document.querySelector('.slack_editor select'),null,'editing an independent channel does not dereference its missing department');
    const visibilityDisclosure=[...document.querySelectorAll('.slack_editor summary')].find(node=>node.textContent.includes('Visibilidad e invitaciones'));
    visibilityDisclosure.click();
    await waitFor(()=>document.querySelector('.slack_editor .slack_access_fields select'));
    const inlineVisibility=document.querySelector('.slack_editor .slack_access_fields select');
    assert.deepEqual([...inlineVisibility.options].map(option=>option.value),['public','private']);
    inlineVisibility.value='private';inlineVisibility.dispatchEvent(new Event('change',{bubbles:true}));
    button('Invitar personas').click();await waitFor(()=>document.querySelector('[aria-label="Añadir a Colega invitado"]'));
    document.querySelector('[aria-label="Añadir a Colega invitado"]').click();await settle();
    input(document.querySelector('.slack_channel_editor textarea'),'Descripción y acceso');await settle();
    const updatesBefore=channelUpdates.length;
    button('Guardar cambios').click();await waitFor(()=>!document.querySelector('.slack_editor'));
    assert.equal(channelUpdates.length,updatesBefore+1);
    assert.equal(channelUpdates.at(-1).description,'Descripción y acceso');
    assert.deepEqual(channelUpdates.at(-1).access,{visibility:'private',members:[{employee_id:invitee.employee_id,access:'write'}]});
    assert.equal(accessWrites,0,'settings and invitations use the same write');

    channel={...channel,can_configure:false,can_manage_access:false};
    document.querySelector('[aria-label="Actualizar canales"]').click();
    await waitFor(()=>!document.querySelector('[aria-label="Configurar canal"]') && !document.querySelector('.slack_channel_move'));
    assert.equal(document.querySelector('[aria-label="Privacidad e invitaciones"]'),null);
    assert.ok(document.querySelector('#slack_message'),'an invited writer can still participate');
    channel={...channel,can_configure:true,can_manage_access:true};
    document.querySelector('[aria-label="Actualizar canales"]').click();
    await waitFor(()=>document.querySelector('[aria-label="Configurar canal"]'));
    // Invitation management is separate from opening a readable channel.
    const readsBefore=accessReads;
    button('Administrar acceso').click();await waitFor(()=>document.querySelector('.slack_access_catalog button'));
    document.querySelector('.slack_access_catalog button').click();await waitFor(()=>document.querySelector('.slack_access_catalog [data-picker-option]'));
    document.querySelector('.slack_access_catalog [data-picker-option]').click();await waitFor(()=>document.querySelector('.slack_access_fields'));
    assert.equal(accessReads,readsBefore+1);
    assert.equal(document.querySelector('.slack_access_fields select').value,'private');
    button('Invitar personas').click();
    await waitFor(()=>document.querySelector('[aria-label="Colega invitado, ya añadido"]'));
    assert.ok(peopleQueries.length>0);
    assert.match(document.querySelector('.slack_access_candidates').textContent,/IT/);
    const escape=new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true});
    document.querySelector('.slack_access_candidates').dispatchEvent(escape);await settle();
    assert.ok(document.querySelector('.slack_access_editor'),'Escape closes the dropdown, not the parent editor');
    [...document.querySelectorAll('.slack_dropdown_trigger')].find(node=>node.textContent.includes('Personas con acceso')).click();await settle();
    const memberAccess=document.querySelector('.slack_access_members select');memberAccess.value='read';memberAccess.dispatchEvent(new Event('change',{bubbles:true}));await settle();
    assert.match(document.querySelector('.slack_access_members').textContent,/IT/);
    button('Invitar personas').click();await settle();
    button('Departamentos').click();await waitFor(()=>document.querySelector('[aria-label="Invitar departamento IT"]'));
    document.querySelector('[aria-label="Invitar departamento IT"]').click();await waitFor(()=>[...document.querySelectorAll('.slack_dropdown_trigger')].some(node=>node.textContent.includes('Personas con acceso o excepción (2)')));
    const invitedTrigger=[...document.querySelectorAll('.slack_dropdown_trigger')].find(node=>node.textContent.includes('Personas con acceso'));
    if(invitedTrigger.getAttribute('aria-expanded')!=='true')invitedTrigger.click();await settle();
    assert.equal(document.querySelector('.slack_access_candidates'),null,'switching disclosures closes the other panel after the trigger click');
    assert.equal(document.querySelectorAll('.slack_access_members li').length,2,'bulk invitations fetch every page and deduplicate');
    assert.equal(document.querySelector('.slack_access_members select').value,'read','bulk invitations preserve an existing read-only rule');
    assert.match(document.querySelector('.slack_access_hint').textContent,/administradores/);
    button('Guardar acceso').click();await waitFor(()=>!document.querySelector('.slack_access_editor'));
    assert.equal(accessWrites,1);assert.equal(channel.visibility,'private');assert.equal(accessMembers[0].access,'read');assert.equal(accessMembers.length,2);
    assert.equal(document.querySelector('.slack_message'),null,'saving privacy clears the open history before reauthorization');
    document.querySelector('.slack_sidebar nav button').click();await waitFor(()=>document.querySelector('#slack_message'));
    const documentInput=document.querySelector('[aria-label="Seleccionar documento para el canal"]');
    const documentFile=new File(['Contenido de prueba'],'entrega.txt',{type:'text/plain'});
    Object.defineProperty(documentInput,'files',{configurable:true,value:[documentFile]});documentInput.dispatchEvent(new Event('change',{bubbles:true}));
    await waitFor(()=>document.querySelector('.messaging_media_draft .messaging_document'));
    assert.equal(document.querySelector('.messaging_media_draft audio'),null);
    assert.equal(document.querySelector('label[for="slack_message"]').textContent,'Texto del documento');
    const beforeDocument=mediaAttempts.length;submit();await waitFor(()=>mediaAttempts.length===beforeDocument+1 && !document.querySelector('.messaging_media_draft'));
    assert.equal(mediaAttempts.at(-1).file,documentFile);assert.ok(document.querySelector('.messaging_media_document'));
    input(document.querySelector('#slack_message'),'Borrador privado');await settle();
    core.authorizationRevision=1;root.render(React.createElement(Channels));await waitFor(()=>!document.querySelector('#slack_message'));
    assert.equal(document.querySelector('.slack_message'),null,'a resource-access revision purges history even without session uncertainty');
    document.querySelector('[aria-label="Abrir servidor Independientes"]').click();await settle();
    await waitFor(()=>document.querySelector('.slack_sidebar nav button'));
    document.querySelector('.slack_sidebar nav button').click();await waitFor(()=>document.querySelector('#slack_message'));
    assert.equal(document.querySelector('#slack_message').value,'','private drafts are not retained across revocation');
    document.querySelector('[aria-label="Crear servidor privado"]').click();await waitFor(()=>document.querySelector('.slack_server_editor'));
    input(document.querySelector('.slack_server_editor input'),'Proyecto reservado');await settle();
    assert.equal(document.querySelector('.slack_server_editor select'),null,'private server creation never offers public visibility');
    button('Crear servidor').click();await waitFor(()=>!document.querySelector('.slack_server_editor'));
    await waitFor(()=>document.querySelector('[aria-label="Abrir servidor Proyecto reservado"]'));
    assert.equal(serverCreates.length,1);assert.match(document.querySelector('.slack_sidebar h1').textContent,/Proyecto reservado/);
    assert.equal(document.querySelector('.slack_sidebar nav button'),null,'private server starts with its own empty channel list');
    document.querySelector('[aria-label="Crear canal"]').click();await waitFor(()=>document.querySelector('.slack_channel_editor'));
    input([...document.querySelectorAll('.slack_editor label')].find(node=>node.textContent.startsWith('Nombre')).querySelector('input'),'general');await settle();
    assert.equal(document.querySelector('.slack_channel_editor .slack_access_fields'),null,'server channels inherit invitations');
    document.querySelector('.slack_channel_editor button[type=submit]').click();await waitFor(()=>!document.querySelector('.slack_editor'));
    assert.equal(channelCreates.at(-1).server_id,privateServers[0].id);assert.equal(channelCreates.at(-1).unit_id,null);
    assert.equal(channelCreates.at(-1).visibility,'private');
    document.querySelector('[aria-label="Configurar canal"]').click();await waitFor(()=>document.querySelector('.slack_channel_editor'));
    assert.match(document.querySelector('.slack_channel_editor').textContent,/usa las invitaciones del servidor privado/);
    assert.equal(document.querySelector('.slack_channel_editor .slack_access_fields'),null);
    button('Cancelar').click();await waitFor(()=>!document.querySelector('.slack_channel_editor'));
    await waitFor(()=>!document.querySelector('[aria-label="Hilos del canal"]').disabled);
    document.querySelector('[aria-label="Hilos del canal"]').click();await waitFor(()=>button('Crear'));
    button('Crear').click();await waitFor(()=>document.querySelector('.slack_thread_create'));
    input(document.querySelector('.slack_thread_create input'),'Plan del lanzamiento');await settle();
    failSend=true;document.querySelector('.slack_thread_create').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    await waitFor(()=>document.querySelector('.slack_thread_create button')?.textContent==='Reintentar creación');
    const threadAttempt=attempted.at(-1);failSend=false;
    document.querySelector('.slack_thread_create').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    await waitFor(()=>document.querySelector('.slack_thread_context')?.textContent.includes('Plan del lanzamiento'));
    assert.equal(attempted.at(-1),threadAttempt,'a lost thread creation response preserves its send identifier');
    assert.equal(rows.filter(row=>row.thread_title==='Plan del lanzamiento').length,1);
    // Shared categories: blank-area context menu, retry identity and native drag/drop.
    await waitFor(()=>button('Crear categoría'));
    document.querySelector('.slack_categorized_channels').dispatchEvent(new dom.window.MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:120,clientY:200}));
    await waitFor(()=>document.querySelector('.slack_organization_menu'));
    [...document.querySelectorAll('.slack_organization_menu button')].find(node=>node.textContent==='Crear categoría').click();
    await waitFor(()=>document.querySelector('.slack_category_form input'));
    document.querySelector('.slack_category_form input').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
    await waitFor(()=>!document.querySelector('.slack_category_form'));
    assert.equal(document.activeElement.textContent,'Crear categoría');
    button('Crear categoría').click();await waitFor(()=>document.querySelector('.slack_category_form input'));
    input(document.querySelector('.slack_category_form input'),'App BOLD');await settle();categoryCreateFails=true;
    document.querySelector('.slack_category_form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    await waitFor(()=>document.querySelector('.slack_category_form input')?.disabled && !document.querySelector('.slack_category_form button[type=submit]').disabled);
    const categoryAttempt=categoryCreations.at(-1).client_id;categoryCreateFails=false;
    document.querySelector('.slack_category_form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    await waitFor(()=>!document.querySelector('.slack_category_form'));
    assert.equal(categoryCreations.at(-1).client_id,categoryAttempt);
    button('Crear categoría').click();await waitFor(()=>document.querySelector('.slack_category_form input'));
    input(document.querySelector('.slack_category_form input'),'Reuniones');await settle();
    document.querySelector('.slack_category_form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    await waitFor(()=>document.querySelectorAll('.slack_category').length===2 && !document.querySelector('.slack_category_form'));
    const firstCategory=document.querySelectorAll('.slack_category')[0],secondCategory=document.querySelectorAll('.slack_category')[1];
    const firstId=firstCategory.dataset.category,secondId=secondCategory.dataset.category;
    const dropUI=(source,target)=>{const transfer={setData(){},effectAllowed:'',dropEffect:''};for(const [node,type] of [[source,'dragstart'],[target,'dragover'],[target,'drop'],[source,'dragend']]){const event=new Event(type,{bubbles:true,cancelable:true});Object.defineProperty(event,'dataTransfer',{value:transfer});node.dispatchEvent(event);}};
    assert.equal(document.querySelector('.slack_channel_item > button').getAttribute('draggable'),'true');
    dropUI(document.querySelector('.slack_channel_item > button'),firstCategory);
    await waitFor(()=>channel.category_id===firstId && document.querySelector(`[data-category="${firstId}"] .slack_channel_item`));
    assert.equal(channelCategoryMoves.at(-1).values.category_id,firstId);
    assert.ok(document.querySelector('.slack_thread_context'),'organizing preserves the open thread');
    dropUI(secondCategory.querySelector('.slack_category_toggle'),firstCategory);
    await waitFor(()=>document.querySelector('.slack_category').dataset.category===secondId && !document.querySelector('.slack_categorized_channels').getAttribute('aria-busy').includes('true'));
    assert.ok(document.querySelector(`[data-category="${firstId}"] .slack_channel_item`),'category moves carry their channels');
    assert.equal(categoryMoves.at(-1).values.before_id,firstId);
    document.querySelector(`[data-category="${firstId}"] .slack_category_toggle`).click();await settle();
    assert.ok(document.querySelector(`[data-category="${firstId}"] .slack_category_content`).hidden);
    document.querySelector(`[aria-label="Opciones de categoría Reuniones"]`).click();await waitFor(()=>button('Bajar categoría'));
    button('Bajar categoría').click();await waitFor(()=>document.querySelector('.slack_category').dataset.category===firstId);
    document.querySelector(`[aria-label="Crear canal en App BOLD"]`).click();await waitFor(()=>document.querySelector('.slack_channel_editor'));
    input([...document.querySelectorAll('.slack_editor label')].find(node=>node.textContent.startsWith('Nombre')).querySelector('input'),'dentro-de-categoria');await settle();
    document.querySelector('.slack_channel_editor button[type=submit]').click();await waitFor(()=>!document.querySelector('.slack_editor'));
    assert.equal(channelCreates.at(-1).category_id,firstId);
    document.querySelector(`[data-category="${firstId}"] .slack_category_header`).dispatchEvent(new dom.window.MouseEvent('contextmenu',{bubbles:true,cancelable:true}));await waitFor(()=>button('Editar nombre'));
    globalThis.__categoryName=null;button('Editar nombre').click();await settle();assert.equal(categoryEdits.length,0,'canceling rename writes nothing');
    document.querySelector('[aria-label="Opciones de categoría App BOLD"]').click();await waitFor(()=>button('Editar nombre'));
    globalThis.__categoryName='App renovada';button('Editar nombre').click();await waitFor(()=>document.querySelector('[aria-label="Opciones de categoría App renovada"]'));
    assert.equal(categoryEdits.at(-1).values.name,'App renovada');assert.equal(channel.category_id,firstId,'rename keeps child channels in the same category');
    document.querySelector('[aria-label="Opciones de categoría App renovada"]').click();await waitFor(()=>button('Eliminar categoría'));
    globalThis.__channelsConfirm=false;button('Eliminar categoría').click();await settle();assert.equal(categoryDeletes.length,0,'canceling deletion keeps the category');
    globalThis.__channelsConfirm=true;categoryDeleteFails=true;document.querySelector('[aria-label="Opciones de categoría App renovada"]').click();await waitFor(()=>button('Eliminar categoría'));button('Eliminar categoría').click();
    await waitFor(()=>document.querySelector('.slack_categories_error'));assert.ok(document.querySelector(`[data-category="${firstId}"]`),'failed deletion preserves the category and its channels');
    categoryDeleteFails=false;await waitFor(()=>!document.querySelector('[aria-label="Opciones de categoría App renovada"]').disabled);document.querySelector('[aria-label="Opciones de categoría App renovada"]').click();await waitFor(()=>button('Eliminar categoría'));button('Eliminar categoría').click();
    await waitFor(()=>!document.querySelector(`[data-category="${firstId}"]`) && document.querySelector('.slack_uncategorized .slack_channel_item'));
    assert.equal(channel.category_id,null);assert.ok(rows.length,'ungrouping does not remove channel messages');delete globalThis.__categoryName;

    // Thread context menus are usable by keyboard, touch button and right click.
    const menu=()=>[...document.querySelectorAll('.slack_thread_menu')].find(node=>!node.hidden);
    const menuItem=text=>[...menu().querySelectorAll('button')].find(node=>node.textContent.trim()===text);
    const openThreadMenu=async()=>{document.querySelector('.slack_thread_context .slack_thread_more').click();await waitFor(()=>menu());};
    document.querySelector('[aria-label="Hilos del canal"]').click();await waitFor(()=>[...document.querySelectorAll('.slack_catalog_card')].some(node=>node.textContent.includes('Plan del lanzamiento')));
    [...document.querySelectorAll('.slack_catalog_card')].find(node=>node.textContent.includes('Plan del lanzamiento')).click();await waitFor(()=>document.querySelector('.slack_thread_context .slack_thread_more'));
    await waitFor(()=>!document.querySelector('#slack_message').disabled);
    input(document.querySelector('#slack_message'),'Borrador que se conserva');await settle();
    await openThreadMenu();menuItem('Cerrar hilo').click();await waitFor(()=>document.querySelector('.slack_thread_readonly'));
    assert.ok(document.querySelector('#slack_message').disabled);assert.equal(document.querySelector('#slack_message').value,'Borrador que se conserva');
    await openThreadMenu();menuItem('Reabrir hilo').click();await waitFor(()=>!document.querySelector('#slack_message').disabled);
    assert.equal(document.querySelector('#slack_message').value,'Borrador que se conserva');
    await openThreadMenu();menuItem('Bloquear hilo').click();await waitFor(()=>document.querySelector('.slack_thread_readonly')?.textContent.includes('bloqueado'));
    await openThreadMenu();assert.ok(menuItem('Reabrir hilo').disabled);menuItem('Desbloquear hilo').click();await waitFor(()=>!menu());
    await openThreadMenu();menuItem('Reabrir hilo').click();await waitFor(()=>!document.querySelector('#slack_message').disabled);
    await openThreadMenu();menuItem('Editar hilo').click();await waitFor(()=>menu()?.querySelector('form input'));
    input(menu().querySelector('input'),'Nuevo nombre del hilo');await settle();menu().querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    await waitFor(()=>document.querySelector('.slack_thread_context>div>strong').textContent.includes('Nuevo nombre del hilo'));
    await openThreadMenu();preferenceFails=true;menuItem('Añadir a favoritos').click();await waitFor(()=>menu()?.querySelector('[role=alert]'));
    const lostPreference=preferenceAttempts.at(-1);preferenceFails=false;menuItem('Reintentar cambio').click();await waitFor(()=>!menu());
    assert.equal(preferenceAttempts.at(-1).client_id,lostPreference.client_id);
    await openThreadMenu();assert.ok(menuItem('Quitar de favoritos'));menuItem('Silenciar hilo').click();await waitFor(()=>menuItem('1 hora'));menuItem('1 hora').click();await waitFor(()=>!menu());
    await openThreadMenu();menuItem('Ajustes de notificaciones').click();await waitFor(()=>menuItem('Solo menciones'));menuItem('Solo menciones').click();await waitFor(()=>!menu());
    await openThreadMenu();menuItem('Abandonar hilo').click();await waitFor(()=>!menu());
    await openThreadMenu();assert.ok(menuItem('Volver al hilo'));menuItem('Marcar como leído').click();await waitFor(()=>!menu());
    await openThreadMenu();menuItem('Eliminar hilo').click();await waitFor(()=>menu()?.getAttribute('role')==='alertdialog');
    assert.ok(!document.querySelector('.slack_thread_readonly'),'delete must wait for confirmation');
    menuItem('Confirmar eliminación').click();await waitFor(()=>document.querySelector('.slack_thread_readonly')?.textContent.includes('Eliminados'));
    await openThreadMenu();menuItem('Restaurar hilo').click();await waitFor(()=>document.querySelector('.slack_thread_readonly')?.textContent.includes('cerrado'));
    await openThreadMenu();menuItem('Reabrir hilo').click();await waitFor(()=>!document.querySelector('#slack_message').disabled);
    const renamedThread=()=>[...document.querySelectorAll('.slack_catalog_card')].find(node=>node.textContent.includes('Nuevo nombre del hilo'));
    document.querySelector('[aria-label="Hilos del canal"]').click();await waitFor(renamedThread);
    button('Activos').click();
    await waitFor(()=>button('Activos').getAttribute('aria-pressed')==='true' && renamedThread());
    renamedThread().dispatchEvent(new dom.window.MouseEvent('contextmenu',{bubbles:true,cancelable:true}));await waitFor(()=>menu());
    menu().dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'End',bubbles:true}));assert.equal(document.activeElement.textContent.trim(),'Volver al hilo');
    menu().dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await waitFor(()=>!menu());
    document.querySelector('[aria-label="Configurar canal"]').click();await waitFor(()=>button('Eliminar canal'));
    globalThis.__channelsConfirm=false;button('Eliminar canal').click();await settle();
    assert.equal(channelDeletes.length,0,'canceling deletion never sends a destructive request');
    globalThis.__channelsConfirm=true;channelDeleteFails=true;button('Eliminar canal').click();
    await waitFor(()=>document.querySelector('.slack_channel_editor [role=alert]'));
    assert.equal(channelDeleted,false);assert.ok(document.querySelector('.slack_active_conversation'),'a conflict keeps the conversation and editor open');
    assert.match(document.querySelector('.slack_channel_editor [role=alert]').textContent,/canal cambió/);
    button('Cancelar').click();await waitFor(()=>!document.querySelector('.slack_channel_editor'));
    const openChannelMenu=async()=>{document.querySelector('.slack_channel_item').dispatchEvent(new dom.window.MouseEvent('contextmenu',{bubbles:true,cancelable:true}));await waitFor(()=>button('Eliminar canal'));};
    const beforeMenuDeletes=channelDeletes.length;
    await openChannelMenu();globalThis.__channelsConfirm=false;button('Eliminar canal').click();await settle();
    assert.equal(channelDeletes.length,beforeMenuDeletes,'canceling the context-menu deletion sends no request');
    globalThis.__channelsConfirm=true;await openChannelMenu();button('Eliminar canal').click();
    await waitFor(()=>document.querySelector('.slack_categories_error'));
    assert.match(document.querySelector('.slack_categories_error').textContent,/canal cambió/);
    assert.ok(document.querySelector('.slack_active_conversation'),'a rejected menu deletion preserves the conversation');
    channelDeleteFails=false;await waitFor(()=>!document.querySelector('.slack_channel_move').disabled);
    document.querySelector('.slack_channel_move').click();await waitFor(()=>button('Eliminar canal'));
    button('Eliminar canal').click();
    await waitFor(()=>!document.querySelector('.slack_active_conversation'));
    assert.equal(channelDeletes.at(-1).id,channel.id);assert.equal(channelDeletes.at(-1).version,channel.version);
    assert.ok(channelDeletes.at(-1).options.signal instanceof AbortSignal);
    assert.equal(document.querySelectorAll('.slack_channel_item').length,0,'successful deletion removes the channel from the sidebar');
    core.securityUncertain=true; root.render(React.createElement(Channels)); await settle();
    assert.equal(document.querySelector(".slack_message"),null);
    assert.match(document.querySelector('[role="status"]').textContent,/sesión autorizada/);
    console.log("Slack DOM passed: channels, independent creation, invitation management/read-only, scoped visible reads, notifications/threads, tasks, multimedia, revision purge and no idle polling.");
} finally {root.unmount(); await server.close(); dom.window.close();}
