import test from "node:test";
import assert from "node:assert/strict";
import {channelPage, channelError, createChannelApi, createChannelRefresh, mergeChannelMessages} from "./channel_api.js";

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
    assert.equal(channelError({status:400,fields:{name:["Usa un nombre más corto."]}}),"Usa un nombre más corto.");
    assert.match(channelError({status:404}),/canal o hilo/);
    assert.match(channelError({status:0}),/sin duplicarlo/);
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

test("channel media uses bounded multipart and an authenticated blob endpoint", async () => {
    const calls=[], api=createChannelApi({request:async(...args)=>calls.push(args)});
    const file=new File(["pixels"],"captura.png",{type:"image/png"}),controller=new AbortController();
    await api.sendMedia(channel,{body:"Contexto",client_id:parent,parent_id:null,author:"spoof",department:"spoof"},file,{signal:controller.signal});
    const options=calls[0][1];
    assert.ok(options.body instanceof FormData);
    assert.deepEqual([...options.body.keys()],["body","client_id","file"]);
    assert.equal(options.body.get("file").name,"captura.png");
    assert.equal(options.signal,controller.signal);
    assert.equal(options.method,"POST");
    await api.media(channel,parent);
    assert.deepEqual(calls[1],[`/api/v2/messaging/channels/${channel}/messages/${parent}/media/`,{responseType:"blob"}]);
    await api.sendMedia(channel,{body:"",client_id:parent,parent_id:channel,task_id:parent},file);
    assert.equal(calls[2][1].body.get("parent_id"),channel);
    assert.equal(calls[2][1].body.get("task_id"),parent);
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
