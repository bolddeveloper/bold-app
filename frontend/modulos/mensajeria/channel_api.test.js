import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {channelPage, channelError, followError, createChannelApi, createChannelRefresh, mergeChannelMessage, mergeChannelMessages} from "./channel_api.js";

const channel = "00000000-0000-4000-8000-000000000001", parent = "00000000-0000-4000-8000-000000000002";

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
    assert.match(channelError({status:404}),/canal o hilo/);
    assert.match(channelError({status:0}),/sin duplicarlo/);
    assert.equal(channelError({status:400,fields:{members:["Falta una persona invitada."]}}),"Falta una persona invitada.");
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
    await api.sendMedia(channel,{body:"",client_id:parent,parent_id:channel,task_id:parent},file);
    assert.equal(calls[6][1].body.parent_id,channel);
    assert.equal(calls[6][1].body.task_id,parent);
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
    assert.throws(()=>api.mentionPeople(channel,'x'));assert.throws(()=>api.mentionPeople(channel,'x'.repeat(81)));
    assert.throws(()=>api.mentionPeople('../../private','persona'));
    assert.equal(calls.length,1);
});
