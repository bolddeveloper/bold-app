import test from 'node:test';
import assert from 'node:assert/strict';
import {createReactionApi} from './reaction_api.js';
import {applyReactions,newestReactions} from './reaction_model.js';
import {mergeMessages} from './messaging_models.js';
import {mergeChannelMessage} from './channel_api.js';
import {createMessagingSession} from '../core/messaging_session.js';
import {createSlackUnread} from '../core/slack_unread.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('reaction snapshots merge independently of edited content and receipts',()=>{
    const current={id:id(1),version:3,body:'Edición',created_at:'2026-10-28',read_at:'read',reactions:{version:8,own_version:5,items:[]}};
    const stale={...current,version:1,body:'Viejo',read_at:null,reactions:{version:9,own_version:5,items:[{key:'heart',count:2,mine:false}]}};
    const result=mergeMessages([current],[stale])[0];
    assert.equal(result.body,'Edición');assert.equal(result.read_at,'read');assert.equal(result.reactions.version,9);
    assert.equal(mergeMessages([result],[{...current,version:4}])[0].reactions.version,9);
    assert.equal(applyReactions([result],[{id:id(1),reactions:current.reactions}])[0].reactions.version,9);
    assert.equal(newestReactions(result.reactions,undefined),result.reactions);
});
test('Slack reactions do not roll back thread-follow preference or message edits',()=>{
    const current={id:id(1),version:3,body:'Editado',thread_state_version:7,thread_following:true,reactions:{version:3,items:[]}};
    const result=mergeChannelMessage(current,{...current,version:1,body:'Original',thread_state_version:2,thread_following:false,reactions:{version:4,items:[]}});
    assert.equal(result.body,'Editado');assert.equal(result.thread_following,true);assert.equal(result.reactions.version,4);
});
test('reaction events use the existing session but never acknowledge a message',()=>{
    const emitted=[],timers=[];
    const session=createMessagingSession({employeeId:id(2),acknowledge:()=>assert.fail(),emit:event=>emitted.push(event),setTimer:job=>timers.push(job)});
    const event={event_version:2,event_type:'messaging.reactions.updated',payload:{conversation_id:id(3),reactions:[{id:id(1),reactions:{version:1,items:[]}}]}};
    session.receive(event);assert.equal(emitted.length,1);assert.equal(timers.length,0);
    session.dispose();session.receive(event);assert.equal(emitted.length,1);
});
test('Slack reactions do not fetch unread summaries',async()=>{
    let calls=0;const unread=createSlackUnread({fetchSummary:async()=>{calls++;return {total:0,by_channel:{}};}});
    await unread.recover();assert.equal(calls,1);
    await unread.receive({event_version:2,event_type:'slack.changed',payload:{kind:'reactions.updated',channel_id:id(1)}});
    assert.equal(calls,1);unread.dispose();
});
test('explicit API is bounded to a message and immutable set/remove intent',async()=>{
    const calls=[],api=createReactionApi({request:async(...args)=>{calls.push(args);return {};}});
    const attempt={key:'heart',active:false,version:4,client_id:id(3)};
    await api.set('chat',id(1),id(2),attempt);
    assert.equal(calls[0][0],`/api/v2/messaging/conversations/${id(1)}/messages/${id(2)}/reactions/`);
    assert.deepEqual(calls[0][1].body,attempt);
    assert.throws(()=>api.set('page',id(1),id(2),attempt));
    assert.throws(()=>api.set('chat','invalid',id(2),attempt));
    assert.throws(()=>api.set('chat',id(1),id(2),{...attempt,active:'toggle'}));
});
