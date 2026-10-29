import test from 'node:test';
import assert from 'node:assert/strict';
import {automationInput,emptyAutomationForm,localSchedule,automationDefinitive,captureAutomationReview,restoreAutomationReview} from './automation_model.js';
import {createAutomationApi,automationPage} from './automation_api.js';
const id='11111111-2222-4333-8444-555555555555',other='11111111-2222-4333-8444-555555555556',now=new Date('2026-10-29T12:00:00Z').getTime();
test('three strict payload shapes, explicit consent and no private source snapshots',()=>{
    let form={...emptyAutomationForm(),name:'Estado',project_id:id,to_status_id:other,share_confirmed:true,body:'NO COPIAR'};
    let result=automationInput(form,id,{now});assert.deepEqual(result.errors,{});assert.equal(result.values.body,undefined);
    assert.equal(automationInput({...form,from_status_id:other},id,{now}).errors.from_status_id.length>0,true);
    form={...form,kind:'reminder',body:'Recordatorio',next_at:localSchedule(now+600000),interval_days:'7'};
    result=automationInput(form,id,{now});assert.deepEqual(result.errors,{});assert.equal(result.values.project_id,undefined);assert.equal(result.values.interval_days,7);
    assert.equal(result.values.next_at,new Date(now+600000).toISOString());
    result=automationInput({...form,kind:'recurring_page',template_id:other,template_version:2},id,{now});
    assert.deepEqual(result.errors,{});assert.equal(result.values.body,undefined);assert.equal(result.values.template_version,2);
    assert.ok(automationInput({...form,share_confirmed:false},id,{now}).errors.share_confirmed);
});
test('date bounds, invalid calendar normalization and recurrence are checked before writes',()=>{
    const form={...emptyAutomationForm(),kind:'reminder',name:'R',body:'Texto',share_confirmed:true,next_at:'2026-02-31T10:00'};
    assert.ok(automationInput(form,id,{now}).errors.next_at);
    assert.ok(automationInput({...form,next_at:localSchedule(now)},id,{now}).errors.next_at);
    assert.ok(automationInput({...form,next_at:localSchedule(now+366*86400000)},id,{now}).errors.next_at);
    for(const interval_days of ['0','366','1.5','-1'])assert.ok(automationInput({...form,next_at:localSchedule(now+600000),interval_days},id,{now}).errors.interval_days);
    assert.equal(automationDefinitive({status:408}),false);assert.equal(automationDefinitive({status:500}),false);assert.equal(automationDefinitive({status:409}),true);
});
test('API carries the exact attempt/version and fences pagination to the selected scope',async()=>{
    const calls=[],api=createAutomationApi({request:async(...args)=>{calls.push(args);return {};}}),values={client_id:other,version:2,active:true,share_confirmed:true};
    await api.action(id,other,values);assert.equal(calls[0][0],`/api/v2/messaging/channels/${id}/automations/${other}/`);assert.equal(calls[0][1].body,values);assert.equal(calls[0][1].method,'PATCH');
    const path=`/api/v2/messaging/channels/${id}/automation-projects/`;
    assert.equal(automationPage(path,path+'?q=Prueba&cursor=two','Prueba'),path+'?q=Prueba&cursor=two');
    for(const next of [path+'?q=Otra&cursor=two',path+'?q=Prueba&cursor=a&cursor=b',path.replace(id,other)+'?q=Prueba&cursor=two',path+'?q=Prueba&cursor=a&extra=1'])assert.throws(()=>automationPage(path,next,'Prueba'));
    assert.throws(()=>api.get('../otra',other));
});
test('encrypted review payload preserves old nonce/version/time without replaying or copying metadata',()=>{
    const form={...emptyAutomationForm(),kind:'reminder',name:'Regla',body:'Texto privado',next_at:localSchedule(now+600000),share_confirmed:true},baseline=emptyAutomationForm();
    const values=automationInput(form,other,{now}).values;
    const attempt={action:'create',rule:null,values},capture=captureAutomationReview({editing:true,form,baseline,attempt,selected:null,baseVersion:null},id);
    const restored=restoreAutomationReview(capture.payload,id);
    assert.deepEqual(restored.attempt.values,values);assert.equal(restored.attempt.values.client_id,other);
    assert.equal(Object.isFrozen(restored.attempt.values),true);assert.equal(restored.form.next_at,form.next_at);
    assert.throws(()=>restoreAutomationReview(capture.payload,other));
    assert.throws(()=>restoreAutomationReview({...capture.payload,attempt:{...attempt,values:{...values,body:'Otros bytes'}}},id));
    assert.equal(captureAutomationReview({editing:false,form,baseline,attempt:null},id).payload,null);
    const updating={...capture.payload,base_rule:{id:other,version:3},attempt:{action:'replace',rule:other,values:{...values,version:3}}};
    assert.equal(restoreAutomationReview(updating,id).base_rule.version,3);
    assert.throws(()=>restoreAutomationReview({...updating,attempt:{...updating.attempt,values:{...updating.attempt.values,version:4}}},id));
});
