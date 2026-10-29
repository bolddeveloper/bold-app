import test from 'node:test';
import assert from 'node:assert/strict';
import {createForwardReview,captureForwardReview,restoreForwardReview,discardForwardReview,forwardAttemptKey} from './forward_review.js';
import {createMessageForwarder,forwardMessageBatch} from './message_forwarding.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const source={id:id(1),conversation_id:id(2),version:1,body:'Revisión propia',created_at:'2026-10-29T10:00:00Z',author:{name:'Do not persist'},task:{title:'Not part of review'}};
const image={...source,id:id(3),created_at:'2026-10-29T10:01:00Z',media:{kind:'image',drive_file_id:'do-not-persist'}};
const employee=id(4),destination=id(5),nonce=id(6);

test('forward review captures only selected intent fields, files and original nonce, never people or Drive IDs',()=>{
    assert.throws(()=>createForwardReview([{...source,media:{kind:'audio'}}]),/texto o imágenes/);
    const review=createForwardReview([source,image]);review.batch.employeeId=employee;
    const file=new File(['image'],'reenviada.webp',{type:'image/webp'});
    review.attempts.set(forwardAttemptKey(image,employee),{id:nonce,body:image.body,source:image,file,writeStarted:true,destinationId:destination,running:Promise.resolve()});
    const value=captureForwardReview(review),raw=JSON.stringify(value.payload);
    assert.ok(!raw.includes('persist'));assert.ok(!raw.includes('author'));assert.ok(!raw.includes('task'));assert.ok(!raw.includes('running'));
    const restored=restoreForwardReview(value.payload,value.files,source.conversation_id);
    assert.equal(restored.batch.pending.length,2);assert.equal(restored.batch.employeeId,employee);assert.equal(restored.batch.running,null);
    const attempt=[...restored.attempts.values()][0];assert.equal(attempt.id,nonce);assert.equal(attempt.file,file);assert.equal(attempt.writeStarted,true);
    for(const bad of [{...value.payload,pending:[{...source,conversation_id:id(90)}]},{...value.payload,total:11},{...value.payload,confirmed:2},{...value.payload,attempts:[{...value.payload.attempts[0],id:'invalid'}]},{...value.payload,attempts:[{...value.payload.attempts[0],body:'Changed'}]}])assert.throws(()=>restoreForwardReview(bad,value.files,source.conversation_id),/no es válida/);
    assert.throws(()=>restoreForwardReview(value.payload,[],source.conversation_id),/no es válida/);
});

test('durable image retry after reload retains exact bytes/nonce and only resumes explicitly, preserving confirmed progress',async()=>{
    let saved,sends=0,fail=true,next=10;const committed=new Map(),attempts=[];
    const api={open:async()=>({id:destination}),message:async(_,message)=>({message:message===source.id ? source:image}),resolveIntent:async(_,client)=>committed.get(client) || null,
        media:async()=>new Blob(['frozen-image-bytes'],{type:'image/webp'})};
    api.send=async(_,body,client)=>{sends++;const result={message:{id:client,client_id:client,body}};committed.set(client,result);return result;};
    api.sendMedia=async(_,body,client,file)=>{attempts.push({client,file});sends++;const result={message:{id:client,client_id:client,body,media:{kind:'image'}}};committed.set(client,result);if(fail){fail=false;throw Error('Lost response');}return result;};
    let review=createForwardReview([image,source]);
    const protect=async()=>{const value=captureForwardReview(review);saved={payload:structuredClone(value.payload),files:[...value.files]};};
    let forward=createMessageForwarder(api,()=>id(++next),{pending:review.attempts,checkpoint:protect,revalidate:true});
    await assert.rejects(forwardMessageBatch(review.batch,employee,forward,{checkpoint:protect}),/Lost response/);
    assert.equal(review.batch.confirmed,1);assert.equal(sends,2);assert.equal(saved.payload.pending.length,1);
    review=restoreForwardReview(saved.payload,saved.files,source.conversation_id);assert.equal(sends,2,'restore never sends');
    assert.equal([...review.attempts.values()][0].id,attempts[0].client);assert.equal(await [...review.attempts.values()][0].file.text(),'frozen-image-bytes');
    // A later edit must be observed rather than replaying the frozen caption.
    committed.get(attempts[0].client).message.body='Later edit';
    forward=createMessageForwarder(api,()=>{throw Error('Must not allocate a new nonce');},{pending:review.attempts,checkpoint:protect,revalidate:true});
    const recovered=[];await forwardMessageBatch(review.batch,employee,forward,{checkpoint:protect,onConfirmed:value=>recovered.push(value.message)});
    assert.equal(sends,2);assert.equal(review.batch.confirmed,2);assert.equal(saved.payload,null);assert.equal(recovered[0].body,'Later edit');
});

test('checkpoint failure prevents any upload/send, and source edits or revoked reads cannot send frozen private text',async()=>{
    let writes=0;const api={open:async()=>({id:destination}),message:async()=>({message:source}),send:async()=>{writes++;}};
    const review=createForwardReview([source]);
    const forward=createMessageForwarder(api,()=>nonce,{pending:review.attempts,revalidate:true,checkpoint:async()=>{throw Error('Disk full');}});
    await assert.rejects(forward(source,employee),/Disk full/);assert.equal(writes,0);assert.equal([...review.attempts.values()][0].id,nonce);
    api.message=async()=>({message:{...source,version:2}});
    await assert.rejects(createMessageForwarder(api,()=>id(7),{revalidate:true})(source,employee),/origen cambió/);
    api.message=async()=>{throw Object.assign(Error('Forbidden'),{status:403});};
    await assert.rejects(createMessageForwarder(api,()=>id(7),{revalidate:true})(source,employee),{status:403});assert.equal(writes,0);
});

test('discard resolves each started nonce, leaves published messages intact, and retains unknown items through recovery',async()=>{
    let review=createForwardReview([source,image]);review.batch.employeeId=employee;
    for(const row of [source,image])review.attempts.set(forwardAttemptKey(row,employee),{id:row.id,body:row.body,source:row,writeStarted:true,destinationId:destination,...(row.media ? {file:new File(['img'],'img.webp',{type:'image/webp'})}:{})});
    let saved,first=true;const calls=[];
    const api={discardMedia:async(_,client)=>{calls.push(client);if(client===image.id && first){first=false;throw Error('Unknown');}return client===source.id ? {outcome:'cancelled'}:{outcome:'published',message:{client_id:client,body:'Edited after send'}};}};
    const checkpoint=async()=>{saved=captureForwardReview(review);};
    await assert.rejects(discardForwardReview(review,api,{checkpoint}),/Unknown/);
    assert.deepEqual(calls,[source.id,image.id]);assert.equal(review.batch.discarded,1);assert.equal(review.batch.confirmed,0);
    review=restoreForwardReview(saved.payload,saved.files,source.conversation_id);assert.equal(review.batch.pending.length,1);
    const published=[];const result=await discardForwardReview(review,api,{checkpoint,onPublished:value=>published.push(value.message)});
    assert.deepEqual(result,{cancelled:0,published:1});assert.equal(review.batch.confirmed,1);assert.equal(saved.payload,null);assert.equal(published[0].body,'Edited after send');
});

test('unstarted review discard makes no network request and an ambiguous response cannot drop its nonce',async()=>{
    const review=createForwardReview([source]);let calls=0;
    assert.deepEqual(await discardForwardReview(review,{discardMedia:async()=>{calls++;}}),{cancelled:1,published:0});assert.equal(calls,0);
    const uncertain=createForwardReview([source]);uncertain.batch.employeeId=employee;uncertain.attempts.set(forwardAttemptKey(source,employee),{id:nonce,body:source.body,source,writeStarted:true,destinationId:destination});
    await assert.rejects(discardForwardReview(uncertain,{discardMedia:async()=>({outcome:'published',message:{client_id:id(99)}})}),/confirmar/);
    assert.equal(uncertain.batch.pending.length,1);assert.equal([...uncertain.attempts.values()][0].id,nonce);
});
