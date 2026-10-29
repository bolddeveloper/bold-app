import test from "node:test";
import assert from "node:assert/strict";
import {createDraftVault,packDraft,unpackDraft,draftIdentity} from "./draft_vault.js";
const scope={kind:"page",resource_id:"page-a",channel_id:"channel-a",account_id:"alice",assignment_id:"it"};
const grant=(extra={})=>({scope,key:btoa("a".repeat(32)),key_id:"a".repeat(32),can_write:true,retention_seconds:604800,...extra});
function setup(){const records=new Map(),storage={get:async id=>records.get(id),put:async row=>records.set(row.id,row),remove:async id=>records.delete(id),purge:async predicate=>{for(const [id,row] of records)if(predicate(row))records.delete(id);}};return {records,vault:createDraftVault({storage})};}

test("encrypted draft and raw file bytes survive reopening only after fresh ACL validation",async()=>{
    const {records,vault}=setup();let validations=0;
    const authorize=async()=>{validations++;return grant();};
    const first=await vault.open(scope,authorize),file=new File([new Uint8Array([0,255,42])],"privada.png",{type:"image/png",lastModified:5});
    await first.save({text:"Texto privado",attempt:"immutable-client-id"},[file]);first.close();
    const record=records.get(draftIdentity(scope));assert.equal(JSON.stringify(record).includes("Texto privado"),false);assert.equal(JSON.stringify(record).includes("privada.png"),false);assert.equal("key" in record,false);assert.equal("payload" in record,false);
    const second=await vault.open(scope,authorize),recovered=await second.recover();assert.equal(validations,2);assert.deepEqual(recovered.payload,{text:"Texto privado",attempt:"immutable-client-id"});assert.equal(recovered.files[0].name,"privada.png");assert.deepEqual(new Uint8Array(await recovered.files[0].arrayBuffer()),new Uint8Array([0,255,42]));second.close();
});

test("denial, wrong account/assignment and authenticated-data tampering never expose plaintext",async()=>{
    const {records,vault}=setup(),handle=await vault.open(scope,async()=>grant());await handle.save({text:"secret"});handle.close();
    await assert.rejects(vault.open(scope,async()=>{throw Object.assign(Error("revoked"),{status:403});}),/revoked/);
    await assert.rejects(vault.open({...scope,assignment_id:"other"},async()=>grant()),/verificar/);
    const record=records.get(draftIdentity(scope));record.iv[0]^=1;
    const reopened=await vault.open(scope,async()=>grant());await assert.rejects(reopened.recover());reopened.close();
});

test("expired and rotated-key drafts are discarded; readonly recovery cannot grant write access",async()=>{
    const {records,vault}=setup();const handle=await vault.open(scope,async()=>grant());await handle.save({text:"draft"});handle.close();
    let reopened=await vault.open(scope,async()=>grant({can_write:false}));assert.equal((await reopened.recover()).canWrite,false);reopened.close();
    reopened=await vault.open(scope,async()=>grant({key_id:"b".repeat(32)}));assert.equal(await reopened.recover(),null);assert.equal(records.size,0);reopened.close();
    const original=await vault.open(scope,async()=>grant());await original.save({text:"expired"});records.get(draftIdentity(scope)).expiresAt=0;assert.equal(await original.recover(),null);original.close();
});

test("serialized saves and clear preserve newest state; suspend blocks queued writes",async()=>{
    const {records,vault}=setup(),handle=await vault.open(scope,async()=>grant());await Promise.all([handle.save({text:"old"}),handle.save({text:"new"})]);assert.equal((await handle.recover()).payload.text,"new");await Promise.all([handle.save({text:"pending"}),handle.clear()]);assert.equal(records.size,0);
    const pending=handle.save({text:"must not return"});vault.suspend();assert.equal(await pending,false);assert.equal(records.size,0);
});

test("file envelope rejects oversized or malformed drafts and preserves Unicode",async()=>{
    assert.equal(unpackDraft(await packDraft({text:"Señor 🚀"})).payload.text,"Señor 🚀");
    await assert.rejects(packDraft({},[new Blob([new Uint8Array(65*1024*1024)])]),/64 MB/);
    assert.throws(()=>unpackDraft(new Uint8Array([255,255,255,255])),/completo/);
    await assert.rejects(packDraft({},Array(31).fill(new Blob())),/30 archivos/);
});

test("storage failures are explicit and a failed save can retry without losing the current value",async()=>{
    let fail=true,row;const vault=createDraftVault({storage:{put:async value=>{if(fail)throw Error("quota");row=value;},get:async()=>row}}),handle=await vault.open(scope,async()=>grant());await assert.rejects(handle.save({text:"one"}),/quota/);fail=false;await handle.save({text:"two"});assert.equal((await handle.recover()).payload.text,"two");handle.close();
});

test("logout during grant acquisition cannot recreate an active handle",async()=>{
    const {vault}=setup();let finish;const opening=vault.open(scope,()=>new Promise(resolve=>finish=resolve));vault.suspend();finish(grant());await assert.rejects(opening,error=>error.name==="AbortError");
});
