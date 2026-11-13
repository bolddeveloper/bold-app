import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {channelPage, channelError, followError, createChannelApi, createChannelRefresh, mergeChannelMessage, mergeChannelMessages,threadPreferenceMessage} from "./channel_api.js";
import {channelLinkTarget,threadLink} from './channel_links.js';

const channel = "00000000-0000-4000-8000-000000000001", parent = "00000000-0000-4000-8000-000000000002";

test('deleting a text channel sends its reviewed version and respects cancellation',async()=>{
    const calls=[],api=createChannelApi({request:async(...args)=>calls.push(args)});
    const controller=new AbortController();
    await api.deleteChannel(channel,3,{signal:controller.signal});
    assert.deepEqual(calls,[[`/api/v2/messaging/channels/${channel}/`,{method:'DELETE',body:{version:3},signal:controller.signal}]]);
    assert.throws(()=>api.deleteChannel('../outside',3));
});

test('server order reads and updates only the authenticated account preferences',async()=>{
    const calls=[],order=['independent',channel],api=createChannelApi({request:async(path,options)=>{calls.push({path,options});return {slack_server_order:order};}});
    assert.deepEqual(await api.serverOrder(),order);
    await api.saveServerOrder(order);
    assert.deepEqual(calls.map(call=>call.path),['/api/v2/auth/interface-settings/','/api/v2/auth/interface-settings/']);
    assert.deepEqual(calls[1].options,{method:'PATCH',body:{slack_server_order:order}});
});

test('thread menus use scoped routes and preserve all independently versioned personal settings',async()=>{
    const calls=[],api=createChannelApi({request:async(...args)=>calls.push(args)});
    await api.manageThread(channel,parent,{action:'lock',version:1});
    await api.threadPreferences(channel,parent,{favorite:true,version:0,client_id:parent});
    await api.readThread(channel,parent);
    await api.threads(channel,'',null,undefined,{favorite:'true'});
    assert.match(calls[0][0],/thread-settings\/$/);assert.equal(calls[0][1].method,'PATCH');
    assert.match(calls[1][0],/thread-preferences\/$/);assert.equal(calls[1][1].body.favorite,true);
    assert.match(calls[2][0],/thread-read\/$/);assert.match(calls[3][0],/favorite=true$/);
    assert.throws(()=>api.manageThread(channel,'../bad',{}));
    assert.throws(()=>channelPage(`/api/v2/messaging/channels/${channel}/threads/`,`/api/v2/messaging/channels/${channel}/threads/?cursor=abc&favorite=true`,{}));
    const current=threadPreferenceMessage({id:parent,version:2},{favorite:true,left:true,notifications:'none',muted_forever:true,state_version:3});
    const merged=mergeChannelMessage(current,threadPreferenceMessage({id:parent,version:4},{favorite:false,left:false,notifications:'all',state_version:2}));
    assert.equal(merged.version,4);assert.equal(merged.thread_favorite,true);assert.equal(merged.thread_left,true);assert.equal(merged.thread_notifications,'none');assert.equal(merged.thread_muted_forever,true);
});

test('copied thread links open their authorized channel and preserve existing page links',()=>{
    const link=threadLink(channel,parent,'https://app.example/path?other=private#unrelated');
    assert.equal(link,`https://app.example/path?slack_channel=${channel}&slack_thread=${parent}`);
    assert.deepEqual(channelLinkTarget(new URL(link).search),{channel_id:channel,parent_id:parent});
    assert.deepEqual(channelLinkTarget(`?slack_channel=${channel}&slack_page=${parent}`),{channel_id:channel,page_id:parent});
    assert.equal(channelLinkTarget('?slack_channel=bad&slack_thread=bad'),null);
    assert.throws(()=>threadLink(channel,'../private','https://app.example/'));
});

test('category creation and moves stay in their explicit server scope',async()=>{
    const calls=[],api=createChannelApi({request:async(...args)=>{calls.push(args);return {};}});
    const scope={server:channel};
    await api.categories(scope);await api.createCategory(scope,{name:'App BOLD',client_id:parent});
    await api.moveCategory(scope,parent,{version:1,before_id:null});
    await api.moveChannelCategory(scope,channel,{version:2,category_id:parent});
    await api.updateCategory(scope,parent,{version:3,name:'Nuevo nombre'});
    await api.deleteCategory(scope,parent,{version:4});
    assert.equal(calls[0][0],`/api/v2/messaging/channel-categories/?server=${channel}`);
    assert.equal(calls[1][1].body.client_id,parent);
    assert.equal(calls[2][0],`/api/v2/messaging/channel-categories/${parent}/position/?server=${channel}`);
    assert.deepEqual(calls[3],[`/api/v2/messaging/channels/${channel}/category/?server=${channel}`,{method:'PUT',body:{version:2,category_id:parent}}]);
    assert.deepEqual(calls[4],[`/api/v2/messaging/channel-categories/${parent}/?server=${channel}`,{method:'PATCH',body:{version:3,name:'Nuevo nombre'}}]);
    assert.deepEqual(calls[5],[`/api/v2/messaging/channel-categories/${parent}/?server=${channel}`,{method:'DELETE',body:{version:4}}]);
    assert.throws(()=>api.deleteCategory(scope,'../outside',{version:4}));
});

test('thread and shared-pin APIs retain the channel and search context',async()=>{
    const calls=[],api=createChannelApi({request:async(...args)=>{calls.push(args);return {};}});
    const root=`/api/v2/messaging/channels/${channel}/`;
    await api.threads(channel,'Diseño');await api.pins(channel);
    await api.startThread(channel,parent,'Revisión');await api.pin(channel,parent,true);
    assert.equal(calls[0][0],root+'threads/?q=Dise%C3%B1o');
    assert.equal(calls[1][0],root+'pins/');
    assert.deepEqual(calls[2],[root+`messages/${parent}/thread/`,{method:'PUT',body:{title:'Revisión'}}]);
    assert.deepEqual(calls[3],[root+`messages/${parent}/pin/`,{method:'PUT',body:{pinned:true}}]);
    assert.throws(()=>api.threads(parent,'Actual',root+'threads/?q=Actual&cursor=abc'));
    assert.throws(()=>api.threads(channel,'Actual',root+'threads/?q=Otro&cursor=abc'));
});

test("channel pagination retains its thread/archive context and cannot follow another resource", () => {
    const collection = `/api/v2/messaging/channels/${channel}/messages/`;
    assert.equal(channelPage(collection,`http://private.invalid${collection}?cursor=abc&parent=${parent}`,{parent}),`${collection}?parent=${parent}&cursor=abc`);
    assert.throws(() => channelPage(collection, "/api/v2/messaging/conversations/?cursor=abc"));
    assert.throws(() => channelPage(collection,`${collection}?cursor=abc&parent=${parent}`));
    assert.throws(() => channelPage(collection,`${collection}?cursor=abc`,{parent}));
    assert.throws(() => channelPage(collection,`${collection}?cursor=abc&q=otro`,{q:"actual"}));
});

test("channel errors describe the actual fields without borrowing private-chat media instructions", () => {
    assert.equal(channelError({status:400,fields:['Documento no admitido: el PDF está incompleto.']}),'Documento no admitido: el PDF está incompleto.');
    assert.equal(channelError({status:400,fields:{name:["Usa un nombre más corto."]}}),"Usa un nombre más corto.");
    assert.equal(channelError({status:400,fields:{image:["La imagen debe ser WebP."]}}),"La imagen debe ser WebP.");
    assert.match(channelError({status:404}),/canal o hilo/);
    assert.match(channelError({status:0}),/sin duplicarlo/);
    assert.equal(channelError({status:400,fields:{members:["Falta una persona invitada."]}}),"Falta una persona invitada.");
    assert.equal(channelError({status:400,fields:{access:{visibility:["Elige una visibilidad válida."]}}}),"Elige una visibilidad válida.");
});

test("channel access management has its own API and invalidates Core unread state on a security revision", async()=>{
    const calls=[];const api=createChannelApi({request:async(...args)=>{calls.push(args);return {};}});
    await api.managed(null);await api.access(channel);await api.setAccess(channel,{visibility:"private",members:[],version:1});await api.people({channel,q:"Persona"});
    assert.equal(calls[0][0],"/api/v2/messaging/channels/managed/");
    assert.equal(calls[1][0],`/api/v2/messaging/channels/${channel}/access/`);
    assert.equal(calls[2][1].method,"PATCH");assert.equal(calls[2][1].body.visibility,"private");
    assert.equal(calls[3][0],`/api/v2/messaging/channels/people/?channel=${channel}&q=Persona`);
    const provider=readFileSync(new URL("../core/core_provider.jsx",import.meta.url),"utf8");
    assert.match(provider,/\[chatAllowed,state\.activeAssignment\?\.id,state\.authorizationRevision\]/);
});

test("channel API uses authenticated bounded endpoints and never supplies author or department", async () => {
    const calls = [], api = createChannelApi({request:async(...args) => calls.push(args)});
    await api.send(channel,{body:"Hola",client_id:parent,parent_id:null});
    assert.deepEqual(calls[0],[`/api/v2/messaging/channels/${channel}/messages/`,{method:"POST",body:{body:"Hola",client_id:parent,parent_id:null}}]);
    await api.messages(channel,parent,null);
    assert.match(calls[1][0],new RegExp(`parent=${parent}$`));
    assert.throws(() => api.messages("../../admin",null,null));
    await api.tasks(channel,"Revisión",null);
    assert.match(calls[2][0],/\/tasks\/\?q=Revisi%C3%B3n$/);
    await api.task(parent);
    assert.equal(calls[3][0],`/api/v2/tasks/${parent}/`);
    await api.send(channel,{body:'@soportebold Resume el canal',client_id:parent,parent_id:null});
    assert.equal(calls[4][1].body.support_in_channel,true);
    await api.send(channel,{body:'`@soportebold`',client_id:parent,parent_id:null});
    assert.equal(calls[5][1].body.support_in_channel,undefined);
});

test("channel refresh coalesces bursts, preserves a trailing event and never polls while idle", async () => {
    let calls = 0, release;
    const queue = createChannelRefresh(async () => {calls++; if (calls === 1) await new Promise(resolve => {release=resolve;});}, assert.fail);
    const pending = queue.request(); queue.request(); queue.request();
    assert.equal(calls,1); release(); await pending; assert.equal(calls,2);
    await Promise.resolve(); assert.equal(calls,2);
    queue.dispose(); await queue.request(); assert.equal(calls,2);
});

test("channel media stages only the file, publishes JSON and keeps authenticated downloads", async () => {
    const calls=[], api=createChannelApi({request:async(path,options)=>{
        calls.push([path,options]);
        if(path.includes('/uploads/?'))return {results:[]};
        if(path.endsWith('/uploads/'))return {id:channel,client_id:parent,state:'ready'};
        return {message:{id:parent,client_id:parent}};
    }});
    const file=new File(["pixels"],"captura.png",{type:"image/png"}),controller=new AbortController();
    await api.sendMedia(channel,{body:"Contexto",client_id:parent,parent_id:null,author:"spoof",department:"spoof"},file,{signal:controller.signal});
    const options=calls[1][1];
    assert.ok(options.body instanceof FormData);
    assert.deepEqual([...options.body.keys()],["client_id","file"]);
    assert.equal(options.body.get("file").name,"captura.png");
    assert.equal(options.signal,controller.signal);
    assert.equal(options.method,"POST");
    assert.deepEqual(calls[2][1].body,{body:'Contexto',client_id:parent,upload_id:channel});
    await api.media(channel,parent);
    assert.deepEqual(calls[3],[`/api/v2/messaging/channels/${channel}/messages/${parent}/media/`,{responseType:"blob"}]);
    await api.sendMedia(channel,{body:"@soportebold Revisa la captura",client_id:parent,parent_id:channel,task_id:parent},file);
    assert.equal(calls[6][1].body.parent_id,channel);
    assert.equal(calls[6][1].body.task_id,parent);
    assert.equal(calls[6][1].body.support_in_channel,true);
});

test("channel refresh aborts old identity work and stops after error without automatic retries", async () => {
    let errors = 0, seenSignal, release;
    const queue = createChannelRefresh(async signal => {seenSignal=signal; await new Promise(resolve => {release=resolve;}); throw Error("offline");}, () => errors++);
    const pending=queue.request(); queue.dispose(); release(); await pending;
    assert.ok(seenSignal.aborted); assert.equal(errors,0);
    let calls=0;
    const failed=createChannelRefresh(async () => {calls++; throw Error("offline");},() => errors++);
    await failed.request(); assert.equal(calls,1); assert.equal(errors,1); failed.dispose();
});

test("recent channel reconciliation retains racing sends and edits but starts a contiguous pagination window", () => {
    const row=(id,sequence,version=1) => ({id,sequence,version});
    assert.deepEqual(mergeChannelMessages([row("older",1),row("edit",5,2),row("racing",6)],[row("edit",5)],{recent:true}),[row("edit",5,2),row("racing",6)]);
    assert.deepEqual(mergeChannelMessages([row("edit",5,2)],[row("older",1),row("edit",5,1)]),[row("older",1),row("edit",5,2)]);
});

test("thread opt-ins have strict authenticated root routes and cannot impersonate another employee",async()=>{
    const calls=[],api=createChannelApi({request:async(...args)=>calls.push(args)});
    await api.threadState(channel,parent,{signal:"read"});
    await api.followThread(channel,parent,true,{signal:"write"});
    assert.deepEqual(calls[0],[`/api/v2/messaging/channels/${channel}/messages/${parent}/following/`,{signal:"read"}]);
    assert.deepEqual(calls[1],[`/api/v2/messaging/channels/${channel}/messages/${parent}/following/`,{signal:"write",method:"PUT",body:{following:true}}]);
    assert.throws(()=>api.followThread(channel,"../../private",true));
    assert.match(followError({status:0}),/No se pudo confirmar el seguimiento/);
    assert.match(followError({status:429}),/Espera/);
});

test("thread preferences and message content merge with independent revisions",()=>{
    const current={id:parent,body:"Newer content",version:3,thread_following:false,thread_state_version:2};
    const staleContent={...current,body:"Old content",version:1,thread_following:true,thread_state_version:3};
    const result=mergeChannelMessage(current,staleContent);
    assert.equal(result.body,"Newer content");assert.equal(result.thread_following,true);assert.equal(result.thread_state_version,3);
    const newContent={...current,body:"Newest content",version:4,thread_following:false,thread_state_version:1};
    const merged=mergeChannelMessages([result],[newContent])[0];
    assert.equal(merged.body,"Newest content");assert.equal(merged.thread_following,true);
    assert.equal(mergeChannelMessages([merged],[{id:parent,body:"Without projection",version:5}])[0].thread_following,true);
});

test('mention discovery stays inside the authenticated channel and uses an explicit bounded query',async()=>{
    const calls=[],api=createChannelApi({request:async(...args)=>calls.push(args)});
    await api.mentionPeople(channel,' Persona & correo ',{signal:'current'});
    assert.deepEqual(calls[0],[`/api/v2/messaging/channels/${channel}/mention-people/?q=Persona+%26+correo`,{signal:'current'}]);
    await api.mentionPeople(channel,'');await api.mentionPeople(channel,'x');
    assert.equal(calls[1][0],`/api/v2/messaging/channels/${channel}/mention-people/?q=`);
    assert.equal(calls[2][0],`/api/v2/messaging/channels/${channel}/mention-people/?q=x`);
    assert.throws(()=>api.mentionPeople(channel,null));assert.throws(()=>api.mentionPeople(channel,'x'.repeat(81)));
    assert.throws(()=>api.mentionPeople('../../private','persona'));
    assert.equal(calls.length,3);
});
