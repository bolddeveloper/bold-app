import test from 'node:test';
import assert from 'node:assert/strict';
import {createAgreementApi} from './agreement_api.js';
import {agreementAttempt,agreementDraft,initialAgreement,restoreAgreement,toggleAgreement} from './agreement_model.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const reviewed=()=>({...initialAgreement(),stage:'review',touched:true,selected:[id(1)],entries:[{message_id:id(1),source_version:1,text:'Texto revisado',source_text:'Texto completo de origen'}],destination:id(2),confirmed:true});
test('agreement selection is explicit, unique, bounded and ordered',()=>{
    let values=[];for(let n=1;n<=20;n++)values=toggleAgreement(values,id(n));
    assert.throws(()=>toggleAgreement(values,id(21)));assert.throws(()=>toggleAgreement(values,'foreign'));
    assert.deepEqual(toggleAgreement(values,id(3)),values.filter(value=>value!==id(3)));
});
test('review recovery resets consent but retains the immutable pending attempt and complete approved text',()=>{
    const form=reviewed(),attempt=agreementAttempt(form,id(9));
    assert.throws(()=>agreementAttempt({...form,confirmed:false}));
    const packed=agreementDraft(form,attempt);assert.equal(packed.files.length,0);
    const restored=restoreAgreement(packed.payload);assert.equal(restored.form.confirmed,false);assert.deepEqual(restored.attempt,attempt);
    assert.throws(()=>restoreAgreement({...packed.payload,form:{...form,title:'Changed'}}));
    assert.throws(()=>restoreAgreement(packed.payload,[{}]));
    assert.throws(()=>restoreAgreement({...packed.payload,form:{...form,selected:[id(3)]}}));
    assert.equal(agreementDraft(initialAgreement(),null),null);
});
test('agreement API binds review and creation to their source and strips pagination hosts',async()=>{
    const calls=[],api=createAgreementApi({request:async(...args)=>{calls.push(args);return {};}});
    await api.review('chat',id(2),[id(1)]);assert.match(calls[0][0],new RegExp(`/conversations/${id(2)}/agreement-review/`));
    assert.throws(()=>api.review('chat',id(2),[id(1),id(1)]));assert.throws(()=>api.create('foreign',id(2),{}));
    await api.destinations('equipo','https://foreign.invalid/api/v2/messaging/agreement-destinations/?q=equipo&cursor=abc');
    assert.equal(calls.at(-1)[0],'/api/v2/messaging/agreement-destinations/?q=equipo&cursor=abc');
    assert.throws(()=>api.destinations('otro','/api/v2/messaging/agreement-destinations/?q=equipo&cursor=abc'));
    await api.create('channel',id(2),agreementAttempt(reviewed(),id(9)));assert.equal(calls.at(-1)[1].body.entries[0].text,'Texto revisado');
});
