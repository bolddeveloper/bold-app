import test from "node:test";
import assert from "node:assert/strict";
import {createSlackUnread} from "../core/slack_unread.js";
const id="00000000-0000-4000-8000-000000000001",event={event_version:2,event_type:"slack.changed",payload:{channel_id:id}};

test("Slack attention reads once on entry and coalesces live bursts with one trailing refresh",async()=>{
    let calls=0,release,clock=0,seen=[];
    const sync=createSlackUnread({now:()=>clock,fetchSummary:async()=>{calls++;if(calls===1)await new Promise(resolve=>release=resolve);return {total:calls,by_channel:{[id]:calls}};},onChange:value=>seen.push(value)});
    const work=sync.recover();sync.recover();sync.receive(event);sync.receive(event);assert.equal(calls,1);
    release();await work;assert.equal(calls,2);assert.equal(seen.at(-1).total,2);
    await sync.recover();assert.equal(calls,2);clock=15001;await sync.recover();assert.equal(calls,3);
    await Promise.resolve();assert.equal(calls,3,"quiet tabs do not create an interval");sync.dispose();
});

test("hidden Slack events recover on focus; unrelated events and disposed identities do not query",async()=>{
    let visible=false,calls=0;
    const sync=createSlackUnread({visible:()=>visible,fetchSummary:async()=>{calls++;return {total:0,by_channel:{}};}});
    await sync.receive(event);await sync.recover();assert.equal(calls,0);
    visible=true;await sync.recover();assert.equal(calls,1);
    await sync.receive({...event,event_type:"messaging.created"});assert.equal(calls,1);
    await sync.receive({...event,payload:{channel_id:id,kind:"page.changed"}});assert.equal(calls,1,"document saves never trigger unread-summary requests");
    sync.dispose();await sync.invalidate();await sync.receive(event);assert.equal(calls,1);
});

test("Slack errors respect Retry-After without scheduled retries, and forbidden responses clear counts",async()=>{
    let clock=0,calls=0,seen;
    const sync=createSlackUnread({now:()=>clock,fetchSummary:async()=>{calls++;throw {status:403,retryAfterMs:120000};},onChange:value=>seen=value});
    await sync.recover();assert.equal(seen.total,0);
    clock=60000;await sync.receive(event);await sync.recover();assert.equal(calls,1);
    clock=120001;await sync.recover();assert.equal(calls,2);sync.dispose();
});

test("an old assignment's aborted response cannot restore Slack badges",async()=>{
    let release,signal,changes=0;
    const sync=createSlackUnread({fetchSummary:options=>{signal=options.signal;return new Promise(resolve=>release=resolve);},onChange:()=>changes++});
    const work=sync.recover();sync.dispose();assert.ok(signal.aborted);release({total:5,by_channel:{[id]:5}});await work;assert.equal(changes,0);
});
