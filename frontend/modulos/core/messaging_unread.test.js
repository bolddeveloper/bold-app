import test from 'node:test';
import assert from 'node:assert/strict';
import {createMessagingUnread} from './messaging_unread.js';
import {hasChatAttention,hasSlackAttention,parseReadingSnapshot,readingScope} from './reading_attention.js';
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

const readingIds=Array.from({length:6},(_,index)=>`00000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`);
const readingRow={id:readingIds[0],document_id:readingIds[1],version:1,scope_key:'chat:'+readingIds[2],
    target:{kind:'chat',conversation_id:readingIds[2],message_id:readingIds[3],employee_id:readingIds[4]}};
const readingEvent=(version,items)=>({event_version:2,event_type:'messaging.reminder.changed',payload:{reading:{version,items}}});
test('personal reminders update indicators without rewriting actual unread counts or fetching on a push',async()=>{
    let calls=0;const h=createMessagingUnread({fetchSummary:async()=>{calls++;return {conversations:[],reading:{version:0,items:[]}};}});
    await h.recover();h.receive(readingEvent(1,[readingRow]));
    assert.equal(h.snapshot().total,0);assert.equal(hasChatAttention(h.snapshot()),true);
    assert.equal(hasChatAttention(h.snapshot(),readingIds[2]),true);assert.equal(hasChatAttention(h.snapshot(),null,readingIds[4]),true);
    assert.equal(calls,1);h.receive(readingEvent(2,[]));assert.equal(hasChatAttention(h.snapshot()),false);
    h.receive(readingEvent(1,[readingRow]));assert.equal(hasChatAttention(h.snapshot()),false,'a delayed mark cannot undo a clear');h.dispose();
});
test('late bootstrap cannot resurrect a cleared reminder while normal receipt versions keep working',async()=>{
    let resolve;const h=createMessagingUnread({fetchSummary:()=>new Promise(done=>{resolve=done;})});
    const request=h.recover();await Promise.resolve();h.receive(readingEvent(3,[]));
    resolve({conversations:[row(2,10)],reading:{version:1,items:[readingRow]}});await request;
    assert.equal(h.snapshot().reading.version,3);assert.equal(h.snapshot().reading.items.length,0);assert.equal(h.snapshot().total,2);h.dispose();
});
test('reading snapshots reject invalid or duplicate scopes atomically and distinguish Slack from Chat',()=>{
    assert.equal(readingScope({kind:'channel',channel_id:readingIds[2],parent_id:readingIds[5]}),'thread:'+readingIds[5]);
    assert.equal(parseReadingSnapshot({version:1,items:[readingRow,readingRow]}),null);
    assert.equal(parseReadingSnapshot({version:1,items:[{...readingRow,scope_key:'thread:'+readingIds[2]}]}),null);
    const channel={...readingRow,scope_key:'channel:'+readingIds[2],target:{kind:'channel',channel_id:readingIds[2],parent_id:null,message_id:readingIds[3]}};
    const state={total:0,reading:parseReadingSnapshot({version:1,items:[channel]})};
    assert.equal(hasChatAttention(state),false);assert.equal(hasSlackAttention({total:0},state),true);
});
