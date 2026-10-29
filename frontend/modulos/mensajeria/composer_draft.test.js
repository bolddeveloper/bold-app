import test from "node:test";
import assert from "node:assert/strict";
import {captureComposer,restoreComposer} from "./composer_draft.js";
import {packDraft,unpackDraft} from "./draft_vault.js";
test("image/audio queues and immutable unknown sends survive binary persistence without duplicating files",async()=>{
    const image=new File(["image"],"recorte.png",{type:"image/png"}),audio=new File(["voice"],"voz.webm",{type:"audio/webm;codecs=opus"});
    const value=captureComposer({text:"Borrador",items:[{id:"image-id",file:image,caption:"Resaltar",attempted:true,attempt:{body:"Resaltar",client_id:"image-id",parent_id:"thread-id",task_id:"task-id"}},{id:"voice-id",file:audio,caption:"Audio"}],attempt:{client_id:"unknown-id",body:"Original",file:audio},taskId:"task-id",edit:{id:"my-message",body:"Edición pendiente",version:2,task:{title:"Never persist projections"}}});
    assert.equal(value.files.length,2);assert.equal(JSON.stringify(value.payload).includes("Never persist"),false);
    const envelope=unpackDraft(await packDraft(value.payload,value.files)),restored=restoreComposer(envelope.payload,envelope.files);
    assert.equal(restored.items[0].id,"image-id");assert.equal(restored.items[0].attempt.parent_id,"thread-id");assert.equal(restored.attempt.client_id,"unknown-id");assert.equal(restored.attempt.file,restored.items[1].file);assert.equal(await restored.items[0].file.text(),"image");assert.equal(restored.edit.version,2);
});
test("empty capture clears storage; whitespace, task-only and an in-flight attempt remain recoverable",()=>{
    assert.equal(captureComposer().payload,null);assert.ok(captureComposer({text:" "}).payload);assert.ok(captureComposer({taskId:"task"}).payload);assert.ok(captureComposer({attempt:{client_id:"same",body:"pending"}}).payload);
});
test("missing files, invalid media and damaged envelopes fail atomically before changing any draft",()=>{
    const file=new File(["x"],"one.png",{type:"image/png"}),value=captureComposer({items:[{id:"same",file}]});
    assert.throws(()=>restoreComposer(value.payload,[]),/Falta/);assert.throws(()=>restoreComposer(value.payload,[new File(["x"],"bad.svg",{type:"image/svg+xml"})]),/PNG/);
    assert.throws(()=>restoreComposer({...value.payload,items:[...value.payload.items,...value.payload.items]},[file]),/cola/);
});
