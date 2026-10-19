import test from 'node:test';
import assert from 'node:assert/strict';
import {createMessagingUnread} from './messaging_unread.js';
const row=(count=1,version=1)=>({conversation_id:'c',employee_id:'peer',count,version});
const event=value=>({event_version:2,event_type:'messaging.receipt.updated',payload:{unread:value}});
test('bootstrap restores delivered-but-unread messages, pushes update all badge projections without reads',async()=>{
    let calls=0; const h=createMessagingUnread({fetchSummary:async()=>{calls++;return {conversations:[row()]};}});
    await h.recover();assert.equal(h.snapshot().total,1);assert.equal(h.snapshot().byEmployee.peer,1);
    h.receive(event(row(0,2)));assert.equal(h.snapshot().total,0);
    h.receive(event(row(1,1)));assert.equal(h.snapshot().total,0,'late old frame cannot restore badge');
    assert.equal(calls,1);h.dispose();
});
test('late bootstrap cannot overwrite live state or remove a conversation created during the read',async()=>{
    let resolve;const h=createMessagingUnread({fetchSummary:()=>new Promise(done=>{resolve=done;})});
    const initial=h.recover();await Promise.resolve();h.receive(event(row(2,3)));
    resolve({conversations:[row(1,2)]});await initial;assert.equal(h.snapshot().total,2);h.dispose();
});
test('focus storms coalesce; quiet sessions never start a timer; errors respect Retry-After',async()=>{
    let clock=100000,calls=0; const h=createMessagingUnread({now:()=>clock,fetchSummary:async()=>{calls++;throw Object.assign(new Error('rate limited'),{retryAfterMs:90000});}});
    await Promise.all(Array.from({length:20},()=>h.recover()));assert.equal(calls,1);
    clock+=60000;await h.recover();assert.equal(calls,1);clock+=30000;await h.recover();assert.equal(calls,2);h.dispose();
});
test('unrelated events and disposed or unauthorized contexts cannot retain badges',async()=>{
    let published=0;const h=createMessagingUnread({fetchSummary:async()=>{throw Object.assign(new Error(),{status:403});},onChange:()=>published++});
    h.receive(event(row()));assert.equal(h.snapshot().total,1);await h.recover();assert.equal(h.snapshot().total,0);
    h.dispose();h.receive(event(row(2,4)));assert.equal(h.snapshot().total,0);assert.equal(published,2);
});
