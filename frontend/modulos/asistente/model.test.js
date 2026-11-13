import test from 'node:test';
import assert from 'node:assert/strict';
import {assistantMentionPeople,supportMentionText,routeMention,startDictation} from './model.js';
import {mentionPeople} from '../tareas/src/mentions.js';
test('channel support and the private assistant are separate choices within the pilot',()=>{
    const bot={employee_id:'bot',is_bot:true,name:'soportebold',email:'soportebold@bold.gt',token:'@soportebold@bold.gt'};
    const people=[{employee_id:'one',name:'Ana',email:'ana@bold.gt'},bot];
    const outside={assistant_enabled:false},inside={assistant_enabled:true};
    assert.equal(assistantMentionPeople(people,outside),people);
    const [channel,privateAssistant]=mentionPeople(assistantMentionPeople(people,inside),'soportebold');
    assert.equal(channel,bot);
    assert.equal(privateAssistant.employee_id,'assistant-private');
    assert.equal(privateAssistant.token,undefined);
    assert.equal(routeMention(channel,inside,'Una tarea'),false);
    assert.equal(routeMention(privateAssistant,outside,'Una tarea'),false);
});
test('literal support mentions are detected without following quoted text or links',()=>{
    assert.equal(supportMentionText('@soportebold Crea dos tareas'),'Crea dos tareas');
    assert.equal(supportMentionText('Consulta @soporte bold mañana'),'Consulta  mañana');
    assert.equal(supportMentionText('`@soportebold no ejecutar`'),null);
    assert.equal(supportMentionText('https://example.org/@soportebold'),null);
    assert.equal(supportMentionText('usuario@soportebold.gt'),null);
    assert.equal(supportMentionText('@soportebold@bold.gt resume'),'resume');
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
