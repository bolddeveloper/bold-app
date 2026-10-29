import test from 'node:test';
import assert from 'node:assert/strict';
import {createStagedMediaSender} from './staged_media.js';

const scope='11111111-1111-4111-8111-111111111111',clientId='22222222-2222-4222-8222-222222222222',
    uploadId='33333333-3333-4333-8333-333333333333',messageId='44444444-4444-4444-8444-444444444444';
const file=new File(['synthetic original'],'informe.txt',{type:'text/plain'});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function harness({initial=null,created='ready',confirmed=false,deadlineMs=120000,reconcileAt}={}){
    const calls=[],timers=new Map(),events=new EventTarget(),stages=[];let clock=0,serial=0;
    const h={row:initial ? {id:uploadId,client_id:clientId,state:initial,filename:file.name,can_retry:true}:null,confirmed,
        afterRetry:'ready',getRows:()=>({results:h.row ? [{...h.row}]:[],message_id:h.confirmed ? messageId:null})};
    const client={request:async(path,options={})=>{
        calls.push({path,...options});
        if(path.includes('/uploads/?'))return h.getRows();
        if(path.endsWith('/uploads/')){h.row={id:uploadId,client_id:clientId,state:created,filename:file.name};return {...h.row};}
        if(path.endsWith('/uploads/'+uploadId+'/')){
            if(options.method==='POST'){assert.equal(options.body.action,'retry');h.row.state=h.afterRetry;}
            return {...h.row};
        }
        if(path.endsWith('/messages/'+messageId+'/'))return {message:{id:messageId,client_id:clientId,body:'Edited on another device'}};
        if(path.endsWith('/messages/')){h.confirmed=true;return {message:{id:messageId,client_id:clientId,...options.body}};}
        throw Error(path);
    }};
    const sender=createStagedMediaSender(client,{events,now:()=>clock,deadlineMs,reconcileAt,
        setTimer:(fn,ms)=>{const id=++serial;timers.set(id,{fn,at:clock+ms});return id;},clearTimer:id=>timers.delete(id)});
    h.send=(options={},kind='chat',values={body:'Original caption',client_id:clientId})=>sender(kind,scope,values,file,{onStage:value=>stages.push(value),...options});
    h.tick=async ms=>{clock+=ms;for(const [id,timer] of [...timers])if(timer.at<=clock){timers.delete(id);timer.fn();}await flush();};
    h.hint=(override={})=>events.dispatchEvent(new CustomEvent('bold:upload-event',{detail:{event_version:2,event_type:'messaging.upload.changed',
        payload:{upload_id:uploadId,client_id:clientId,kind:'chat',container_id:scope,...override}}}));
    return Object.assign(h,{calls,timers,stages,events});
}

test('staged send uploads only bytes then publishes JSON, without a multipart message or spoofed fields',async()=>{
    const h=harness(),values={body:'Original caption',client_id:clientId,parent_id:scope,task_id:messageId,author:'spoof'};
    const pending=h.send({},'channel',values);values.body='changed';values.task_id=scope;
    await pending;
    assert.equal(h.calls.length,3);assert.ok(h.calls[1].body instanceof FormData);
    assert.deepEqual([...h.calls[1].body.keys()],['client_id','file']);assert.equal(await h.calls[1].body.get('file').text(),await file.text());
    assert.deepEqual(h.calls[2].body,{body:'Original caption',client_id:clientId,upload_id:uploadId,parent_id:scope,task_id:messageId});
    assert.deepEqual(h.stages.map(row=>row.state),['checking','preparing','ready','publishing']);assert.equal(h.timers.size,0);
    assert.ok(!Object.hasOwn(h.calls[1],'onStage'));
});

test('confirmed retries fetch the current message without reuploading, even after another device edited it',async()=>{
    const h=harness({confirmed:true});const result=await h.send();
    assert.equal(result.message.body,'Edited on another device');assert.equal(h.calls.length,2);
    assert.ok(h.calls.every(row=>!row.method));assert.equal(h.timers.size,0);
});

test('ready upload recovery sends only the original message, with no file request',async()=>{
    const h=harness({initial:'ready'});await h.send();
    assert.equal(h.calls.length,2);assert.equal(h.calls[1].body.upload_id,uploadId);assert.equal(h.timers.size,0);
});

test('private hints coalesce, ignore other scopes and stop every timer/listener after confirmation',async()=>{
    const h=harness({initial:'queued'}),pending=h.send();await flush();await h.tick(0);
    const previous=h.calls.length;
    h.hint({container_id:messageId});h.hint({client_id:messageId});await h.tick(300);
    assert.equal(h.calls.length,previous);
    h.row.state='ready';for(let n=0;n<100;n++)h.hint();await h.tick(300);await pending;
    assert.equal(h.calls.length,previous+2);assert.equal(h.timers.size,0);
    h.hint();h.events.dispatchEvent(new Event('online'));await h.tick(120000);
    assert.equal(h.calls.length,previous+2,'no idle polling or late writes');
});

test('stopping the wait keeps the server job and cannot publish after a late hint',async()=>{
    const h=harness({initial:'queued'}),controller=new AbortController();
    const pending=h.send({signal:controller.signal});await flush();await h.tick(0);
    controller.abort();await assert.rejects(pending,{name:'AbortError'});
    h.row.state='ready';h.hint();await h.tick(120000);
    assert.ok(!h.calls.some(row=>row.path.endsWith('/messages/') || row.body?.action==='cancel'));
    assert.equal(h.timers.size,0);assert.equal(h.row.state,'ready');
    await h.send();assert.equal(h.calls.at(-1).body.upload_id,uploadId);
});

test('fallback reconciliation is bounded to an active wait and does not authorize retries',async()=>{
    const h=harness({initial:'queued',deadlineMs:2000,reconcileAt:[10,100,500]});
    const pending=h.send();const rejected=assert.rejects(pending,error=>error.status===409 && /Conservamos/.test(error.fields.detail));
    await flush();await h.tick(0);await h.tick(10);await h.tick(100);await h.tick(500);await h.tick(2000);await rejected;
    assert.ok(h.calls.length<=5);assert.ok(h.calls.every(row=>!row.method));assert.equal(h.timers.size,0);
});

test('only a new explicit send retries a failed job, with the original reservation',async()=>{
    const h=harness({initial:'failed'});await h.send();
    assert.equal(h.calls.filter(row=>row.body?.action==='retry').length,1);assert.equal(h.calls.at(-1).body.upload_id,uploadId);
    const during=harness({initial:'queued'}),pending=during.send();const rejected=assert.rejects(pending,error=>error.status===409);
    await flush();await during.tick(0);during.row.state='failed';during.hint();await during.tick(300);await rejected;
    assert.equal(during.calls.filter(row=>row.body?.action==='retry').length,0);
});

test('terminal reservations permit a new intent, while invalid responses never publish',async()=>{
    for(const state of ['expired','cancelled']){
        const h=harness({initial:state});await assert.rejects(h.send(),error=>error.status===422 && error.resetUploadAttempt);
        assert.ok(!h.calls.some(row=>row.path.endsWith('/messages/')));assert.equal(h.timers.size,0);
    }
    const h=harness({initial:'ready'});h.row.client_id=messageId;
    await assert.rejects(h.send(),/Estado de subida no válido/);assert.equal(h.calls.length,1);
});
