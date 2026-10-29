import test from 'node:test';
import assert from 'node:assert/strict';
import {conversionSection,initialTaskReview,restoreTaskReview,taskAttempt,taskDraft,taskMessageTitle} from './task_conversion_model.js';
import {createTaskConversionApi} from './task_conversion_api.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const form=()=>({...initialTaskReview(),project:id(1),section:id(2),assignee_assignment:id(3),title:'Tarea revisada',description:'Texto privado aprobado',confirmed:true,touched:true,source_version:1});
test('section preference respects last used, hidden unsectioned and visible order',()=>{
    const sections=[{id:id(1)},{id:null},{id:id(2)}];
    assert.equal(conversionSection(sections,id(2)),id(2));assert.equal(conversionSection(sections,'missing'),id(1));
    assert.equal(conversionSection(sections,'unsectioned'),'');assert.equal(conversionSection([{id:id(1)}],'unsectioned'),id(1));
    assert.equal(conversionSection([{id:null},{id:id(1)}],null),'');
    assert.equal(taskMessageTitle('a'.repeat(219)+'😀'),'a'.repeat(219),'title truncation cannot split an emoji surrogate pair');
});
test('review requires explicit consent and preserves immutable retry through encrypted-envelope restoration',()=>{
    assert.equal(taskDraft(initialTaskReview(),null),null);
    assert.throws(()=>taskAttempt({...form(),confirmed:false}));
    const values=form(),attempt=taskAttempt(values,id(4)),captured=taskDraft(values,attempt),restored=restoreTaskReview(captured.payload);
    assert.deepEqual(restored.attempt,attempt);assert.equal(restored.form.confirmed,false,'recovery never grants a fresh approval');
    assert.equal(restored.attempt.share_confirmed,true,'a previously approved pending request stays immutable');
    assert.equal(taskAttempt(values,id(4)).description,'Texto privado aprobado');
    assert.throws(()=>restoreTaskReview({...captured.payload,attempt:{...attempt,description:'Otro texto'}}));
    assert.throws(()=>restoreTaskReview(captured.payload,[new Blob(['not allowed'])]));
    assert.throws(()=>restoreTaskReview({...captured.payload,form:{...values,project:'foreign'}}));
});
test('conversion API binds task links to exact source, authenticated project options and original paging query',async()=>{
    const calls=[],api=createTaskConversionApi({request:async(...args)=>{calls.push(args);return {};}});
    await api.links('chat',id(1),id(2),`https://not-trusted.invalid/api/v2/messaging/conversations/${id(1)}/messages/${id(2)}/tasks/?cursor=old`);
    assert.match(calls[0][0],/^\/api\/v2\/messaging\/conversations\//);assert.match(calls[0][0],/cursor=old/);
    assert.throws(()=>api.links('chat',id(1),id(2),`/api/v2/messaging/channels/${id(1)}/messages/${id(2)}/tasks/?cursor=old`));
    assert.throws(()=>api.projects('other',`/api/v2/messaging/task-conversion-projects/?q=original&cursor=old`));
    await api.origins(id(3));assert.equal(calls.at(-1)[0],`/api/v2/tasks/${id(3)}/message-origins/`);
    await api.create('channel',id(1),id(2),taskAttempt(form(),id(4)));
    assert.equal(calls.at(-1)[1].body.client_id,id(4));
    assert.equal(calls.at(-1)[1].body.project,id(1));
    assert.throws(()=>api.links('page',id(1),id(2)));assert.throws(()=>api.origins('invalid'));
});
