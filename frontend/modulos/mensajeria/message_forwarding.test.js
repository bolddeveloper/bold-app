import test from "node:test";
import assert from "node:assert/strict";
import {canForward, createMessageForwarder} from "./message_forwarding.js";

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
