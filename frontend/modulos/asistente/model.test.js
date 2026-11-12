import test from 'node:test';
import assert from 'node:assert/strict';
import {assistantMentionPeople,privateMentionText,routeMention,startDictation} from './model.js';
test('support references route privately only for the configured pilot',()=>{
    const people=[{employee_id:'one',name:'Ana'},{employee_id:'bot',is_bot:true,name:'soportebold'}];
    assert.equal(assistantMentionPeople(people,{assistant_enabled:false}),people);
    const pilot=assistantMentionPeople(people,{assistant_enabled:true});
    assert.equal(pilot.filter(row=>row.is_bot).length,1);
    assert.equal(pilot.at(-1).employee_id,'assistant-private');
    assert.equal(routeMention({is_bot:true},{assistant_enabled:false},'Una tarea'),false);
});
test('literal support mentions are detected without following quoted text or links',()=>{
    assert.equal(privateMentionText('@soportebold Crea dos tareas'),'Crea dos tareas');
    assert.equal(privateMentionText('Consulta @soporte bold mañana'),'Consulta  mañana');
    assert.equal(privateMentionText('`@soportebold no ejecutar`'),null);
    assert.equal(privateMentionText('https://example.org/@soportebold'),null);
    assert.equal(privateMentionText('usuario@soportebold.gt'),null);
    assert.equal(privateMentionText('@soportebold@bold.gt resume'),'resume');
});
test('dictation yields editable text and never submits an action',()=>{
    let instance,text='',ended=false;
    globalThis.SpeechRecognition=class{constructor(){instance=this;}start(){}abort(){this.onend();}};
    try{
        const stop=startDictation({onText:value=>{text=value;},onEnd:()=>{ended=true;},onError:()=>{}});
        instance.onresult({results:[[{transcript:'Crear una tarea'}]]});
        assert.equal(text,'Crear una tarea');assert.equal(instance.continuous,false);
        stop();assert.equal(ended,true);
    }finally{delete globalThis.SpeechRecognition;}
});
