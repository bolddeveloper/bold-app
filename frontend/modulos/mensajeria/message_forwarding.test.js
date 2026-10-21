import test from "node:test";
import assert from "node:assert/strict";
import {canForward, createMessageForwarder, createForwardBatch, forwardMessageBatch, MAX_FORWARD_MESSAGES, toggleForwardSelection} from "./message_forwarding.js";

const source = {id:"source-message", conversation_id:"private-source", version:1, body:"Texto con https://example.com", author_id:"original-author"};

test("forwarding supports text and images but not empty messages or voice", () => {
    assert.ok(canForward(source)); assert.ok(canForward({...source, body:"", media:{kind:"image"}}));
    assert.ok(!canForward({...source, body:" "})); assert.ok(!canForward({...source, media:{kind:"audio"}}));
});

test("text forwarding sends only a new body/client id, never source identity or chat access", async () => {
    const calls = [], conversation = {id:"destination"};
    const forward = createMessageForwarder({open:async (...args) => {calls.push(["open",...args]); return conversation;}, send:async (...args) => {calls.push(["send",...args]); return {message:{id:"new-message"}};}}, () => "new-client-id");
    const result = await forward(source,"recipient");
    assert.equal(result.conversation,conversation);
    assert.equal(calls[0][1],"recipient");
    assert.deepEqual(calls[1].slice(1,4),["destination",source.body,"new-client-id"]);
    assert.ok(!JSON.stringify(calls).includes("private-source")); assert.ok(!JSON.stringify(calls).includes("original-author"));
});

test("image retries preserve file, caption and id after a lost response; parallel clicks coalesce", async () => {
    const calls = [], attempts = [], original = new Blob(["private image"],{type:"image/webp"});
    let release, sends=0;
    const gate = new Promise(resolve => {release=resolve;});
    const forward = createMessageForwarder({
        open:async () => ({id:"destination"}),
        media:async (...args) => {calls.push(args); return original;},
        sendMedia:async (...args) => {attempts.push(args); sends++; await gate; if(sends===1) throw new Error("response lost after commit"); return {message:{id:"stored"}};},
    }, () => "stable-client-id");
    const image = {...source,media:{kind:"image",drive_file_id:"never-export"}};
    const a=forward(image,"recipient"), b=forward(image,"recipient");
    release(); const outcomes=await Promise.allSettled([a,b]);
    assert.ok(outcomes.every(row=>row.status==="rejected")); assert.equal(attempts.length,1);
    await forward(image,"recipient");
    assert.equal(calls.length,1); assert.deepEqual(calls[0].slice(0,2),[source.conversation_id,source.id]);
    assert.equal(attempts.length,2); assert.equal(attempts[0][2],attempts[1][2]); assert.equal(attempts[0][3],attempts[1][3]);
    assert.equal(attempts[1][1],source.body); assert.equal(await attempts[1][3].text(),"private image");
    assert.ok(!JSON.stringify(attempts).includes("never-export"));
});

test("denied source media or unavailable destination never sends content", async () => {
    let sends=0, reads=0;
    const denied = Object.assign(new Error("forbidden"),{status:403});
    const forward=createMessageForwarder({open:async id=>{if(id==="outside-it") throw denied; return {id:"destination"};},media:async()=>{reads++;throw denied;},sendMedia:async()=>{sends++;},send:async()=>{sends++;}});
    await assert.rejects(forward({...source,media:{kind:"image"}},"recipient"),{status:403});
    await assert.rejects(forward(source,"outside-it"),{status:403});
    assert.equal(sends,0); assert.equal(reads,1);
});

test("unmount/identity abort prevents sending and invalid blobs are rejected", async () => {
    const controller=new AbortController(); let sends=0;
    const api={open:async()=>{controller.abort(); return {id:"destination"};},send:async()=>{sends++;}};
    await assert.rejects(createMessageForwarder(api)(source,"recipient",{signal:controller.signal}),{name:"AbortError"});
    const forward=createMessageForwarder({open:async()=>({id:"destination"}),media:async()=>new Blob(["html"],{type:"text/html"}),sendMedia:async()=>{sends++;}});
    await assert.rejects(forward({...source,media:{kind:"image"}},"recipient"),/PNG, JPEG o WebP/);
    assert.equal(sends,0);
});

test("selection toggles immutable snapshots, is bounded and keeps chronological rather than click order", () => {
    const rows=Array.from({length:MAX_FORWARD_MESSAGES},(_,index)=>({...source,id:`row-${index}`,created_at:new Date(index*1000).toISOString()}));
    let selected=[];
    for (const row of rows.toReversed()) selected=toggleForwardSelection(selected,row);
    assert.deepEqual(createForwardBatch(selected).pending.map(row=>row.id),rows.map(row=>row.id));
    assert.throws(()=>toggleForwardSelection(selected,{...source,id:"extra"}),/hasta 10/);
    assert.equal(toggleForwardSelection(selected,rows[0]).length,9);
    assert.throws(()=>toggleForwardSelection([],{...source,media:{kind:"audio"}}),/texto o imágenes/);
    const copied=createForwardBatch([rows[0],rows[0]]); assert.equal(copied.total,1);
    rows[0].body="edited after selection"; assert.equal(copied.pending[0].body,source.body);
    assert.throws(()=>createForwardBatch([]),/uno a 10/);
    assert.throws(()=>createForwardBatch([rows[0],{...rows[1],conversation_id:"other-private-chat"}]),/misma conversación/);
});

test("mixed batches are serial, reuse one destination and resume after a lost image response without repeating confirmed text", async () => {
    const sent=new Map(), attempts=[], confirmed=[]; let opens=0, fail=true, active=0, maximum=0, next=0;
    const api={open:async()=>{opens++;return {id:"destination"};},media:async()=>new Blob(["private image"],{type:"image/webp"})};
    const send=async (destination,body,id,file) => {
        active++; maximum=Math.max(maximum,active); attempts.push({destination,body,id,file});
        await Promise.resolve(); active--;
        if (!sent.has(id)) sent.set(id,{message:{id,body,conversation_id:destination}});
        if (file && fail) {fail=false;throw new Error("image response lost");}
        return sent.get(id);
    };
    api.send=(destination,body,id)=>send(destination,body,id);
    api.sendMedia=(destination,body,id,file)=>send(destination,body,id,file);
    const forward=createMessageForwarder(api,()=>`client-${++next}`);
    const rows=[{...source,id:"one",created_at:"2026-10-20T10:00:00Z",body:"First"},
        {...source,id:"two",created_at:"2026-10-20T10:01:00Z",body:"Caption",media:{kind:"image"}},
        {...source,id:"three",created_at:"2026-10-20T10:02:00Z",body:"Last"}];
    const batch=createForwardBatch(rows.toReversed());
    await assert.rejects(forwardMessageBatch(batch,"recipient",forward,{onConfirmed:(_result,row)=>confirmed.push(row.id)}),/response lost/);
    assert.equal(batch.confirmed,1);assert.deepEqual(batch.pending.map(row=>row.id),["two","three"]);
    const lost=attempts.at(-1);
    await assert.rejects(forwardMessageBatch(batch,"different-recipient",forward),/destinatario/);
    const result=await forwardMessageBatch(batch,"recipient",forward,{onConfirmed:(_result,row)=>confirmed.push(row.id)});
    assert.deepEqual(result,{confirmed:3,total:3});assert.equal(batch.pending.length,0);
    assert.deepEqual(confirmed,["one","two","three"]);assert.equal(sent.size,3);assert.equal(maximum,1);assert.equal(opens,1);
    assert.deepEqual(attempts.map(row=>row.body),["First","Caption","Caption","Last"]);
    assert.equal(attempts[2].id,lost.id);assert.equal(attempts[2].file,lost.file);
});

test("batch abort stops later sends and a repeated submit cannot start a parallel batch", async () => {
    let release, count=0;const gate=new Promise(resolve=>{release=resolve;});const controller=new AbortController();
    const rows=[{...source,id:"one"},{...source,id:"two"}];const batch=createForwardBatch(rows);
    const forward=async()=>{count++;await gate;controller.abort();return {message:{id:"stored"}};};
    const a=forwardMessageBatch(batch,"recipient",forward,{signal:controller.signal});
    const b=forwardMessageBatch(batch,"recipient",forward,{signal:controller.signal});
    release();const outcomes=await Promise.allSettled([a,b]);
    assert.ok(outcomes.every(row=>row.status==="rejected" && row.reason.name==="AbortError"));
    assert.equal(count,1);assert.equal(batch.confirmed,1);assert.equal(batch.pending.length,1);
});

test("a cached destination never bypasses server denial and is reopened before another attempt", async () => {
    let opens=0, sends=0;
    const forward=createMessageForwarder({open:async()=>{opens++;return {id:"destination"};},send:async()=>{
        sends++;if (sends===1) throw Object.assign(new Error("permission revoked"),{status:403});
        return {message:{id:"authorized-after-recheck"}};
    }});
    await assert.rejects(forward(source,"recipient"),{status:403});
    assert.equal(opens,1);await forward(source,"recipient");assert.equal(opens,2);
});
