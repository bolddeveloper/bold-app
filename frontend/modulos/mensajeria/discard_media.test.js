import test from 'node:test';
import assert from 'node:assert/strict';
import {createMediaDiscarder} from './discard_media.js';
const container='11111111-1111-4111-8111-111111111111',nonce='22222222-2222-4222-8222-222222222222',
    upload='33333333-3333-4333-8333-333333333333',message='44444444-4444-4444-8444-444444444444';
test('discard explicitly stops exactly one nonce without sending file, text, author or Google identifiers',async()=>{
    const calls=[];const discard=createMediaDiscarder({request:async(path,options)=>{calls.push({path,...options});return {outcome:'cancelled',upload:{id:upload,client_id:nonce,state:'cancelled'}};}});
    const result=await discard('chat',container,nonce);assert.equal(result.outcome,'cancelled');assert.equal(calls.length,1);
    assert.equal(calls[0].path,`/api/v2/messaging/conversations/${container}/uploads/discard/`);
    assert.deepEqual(calls[0].body,{client_id:nonce});assert.equal(calls[0].method,'POST');
});
test('publication wins: discard fetches the current protected message, never deletes it or reuses its old body',async()=>{
    const calls=[],discard=createMediaDiscarder({request:async(path,options)=>{calls.push({path,...options});return calls.length===1 ?
        {outcome:'published',message_id:message}:{message:{id:message,client_id:nonce,body:'Edited elsewhere'}};}});
    const result=await discard('channel',container,nonce);assert.equal(result.outcome,'published');assert.equal(result.message.body,'Edited elsewhere');
    assert.equal(calls[1].path,`/api/v2/messaging/channels/${container}/messages/${message}/`);assert.ok(!calls[1].method);
});
test('ambiguous or cross-attempt results cannot authorize local discard',async()=>{
    for(const result of [{}, {outcome:'cancelled',upload:{id:upload,client_id:message,state:'cancelled'}},
        {outcome:'cancelled',upload:{id:upload,client_id:nonce,state:'ready'}},{outcome:'published',message_id:'wrong'}]){
        await assert.rejects(createMediaDiscarder({request:async()=>result})('chat',container,nonce),/Conservamos/);
    }
    let n=0;const discard=createMediaDiscarder({request:async()=>++n===1 ? {outcome:'published',message_id:message}:{message:{id:message,client_id:message}}});
    await assert.rejects(discard('chat',container,nonce),/Conservamos/);
});
test('abort after a late result and authorization failures preserve the original local attempt',async()=>{
    const controller=new AbortController(),discard=createMediaDiscarder({request:async()=>{controller.abort();return {outcome:'cancelled',upload:{id:upload,client_id:nonce,state:'cancelled'}};}});
    await assert.rejects(discard('chat',container,nonce,{signal:controller.signal}),{name:'AbortError'});
    const denied=Object.assign(Error('Private'),{status:404});
    await assert.rejects(createMediaDiscarder({request:async()=>{throw denied;}})('chat',container,nonce),error=>error===denied);
});
