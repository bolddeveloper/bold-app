import test from 'node:test';
import assert from 'node:assert/strict';
import {createMessagingApi} from './messaging_api.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('forward recovery reads only the original nonce and current protected message; never sends or follows third-party URLs',async()=>{
    const calls=[],conversation=id(1),nonce=id(2),message=id(3);
    const api=createMessagingApi({request:async(path,options)=>{calls.push({path,options});return calls.length===1 ? {message_id:message,results:[]}:{message:{id:message,client_id:nonce,body:'Later edit'}};}});
    const result=await api.resolveIntent(conversation,nonce,{signal:new AbortController().signal});
    assert.equal(result.message.body,'Later edit');assert.equal(calls.length,2);
    assert.equal(calls[0].path,`/api/v2/messaging/conversations/${conversation}/uploads/?client_id=${nonce}`);
    assert.equal(calls[1].path,`/api/v2/messaging/conversations/${conversation}/messages/${message}/`);
    assert.ok(calls.every(row=>!row.options.method));
    const empty=createMessagingApi({request:async()=>({message_id:null,results:[]})});assert.equal(await empty.resolveIntent(conversation,nonce),null);
    const spoofed=createMessagingApi({request:async path=>path.includes('?') ? {message_id:message}:{message:{id:message,client_id:id(90)}}});await assert.rejects(spoofed.resolveIntent(conversation,nonce),/verificar/);
    const external=createMessagingApi({request:async()=>({message_id:'https://example.com/private'})});await assert.rejects(external.resolveIntent(conversation,nonce),/Identificador/);
});
test('a late nonce lookup cannot recover into an aborted identity',async()=>{
    const controller=new AbortController();let reads=0;
    const api=createMessagingApi({request:async()=>{reads++;controller.abort();return {message_id:id(3)};}});
    await assert.rejects(api.resolveIntent(id(1),id(2),{signal:controller.signal}),{name:'AbortError'});assert.equal(reads,1);
});
