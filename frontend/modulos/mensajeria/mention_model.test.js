import test from 'node:test';
import assert from 'node:assert/strict';
import {chatMentionAtCaret,mentionParts,insertMention} from './mention_model.js';
import {mentionPeople} from '../tareas/src/mentions.js';

const person={employee_id:'person',name:'Persona de prueba',token:'@person+alias@bold.gt'};
test('soportebold appears by name or alias and inserts a verified mention using the existing format',()=>{
    const bot={employee_id:'bot',name:'soportebold',email:'soportebold@bold.gt',token:'@soportebold@bold.gt',aliases:['Soporte BOLD'],is_bot:true};
    for(const query of ['sop','soportebold','soporte b','Soporte BOLD'])assert.deepEqual(mentionPeople([bot],query),[bot]);
    const selected=insertMention('Hola @sop',bot,5,9);
    assert.equal(selected.text,'Hola @soportebold@bold.gt ');
    assert.equal(mentionParts(selected.text,[bot]).filter(part=>part.mention?.name==='soportebold').length,1);
    assert.deepEqual(mentionPeople([bot],'otra persona'),[]);
});
test('typed @ detects the current name range without treating emails, links or code as mentions',()=>{
    assert.deepEqual(chatMentionAtCaret('Hola @',6),{query:'',start:5,end:6});
    assert.deepEqual(chatMentionAtCaret('Hola @María José final',16),{query:'María José',start:5,end:16});
    for(const body of ['hola@persona','https://example.com/@persona','`@persona`','@person@bold.gt'])assert.equal(chatMentionAtCaret(body,body.length),null);
    assert.equal(chatMentionAtCaret('Hola @persona',7,9),null);
    assert.equal(chatMentionAtCaret('Hola @persona',-1),null);
});
test('only verified explicit mentions render as people, never ordinary email, URLs or code',()=>{
    const body='person+alias@bold.gt @Person+Alias@Bold.gt. `@person+alias@bold.gt` https://example.com/@person+alias@bold.gt @unknown@bold.gt';
    const parts=mentionParts(body,[person]);
    assert.equal(parts.filter(part=>part.mention).length,1);
    assert.equal(parts.map(part=>part.text).join(''),body);
    assert.equal(mentionParts('@person+alias@bold.gt.evil',[person]).some(part=>part.mention),false);
    assert.equal(mentionParts('@person+alias@bold.gt',[]).some(part=>part.mention),false);
});
test('insertion preserves Unicode, surrounding text and the caret without sending anything',()=>{
    const before='👋 Hola equipo';
    const value=insertMention(before,person,8,before.length);
    assert.equal(value.text,'👋 Hola @person+alias@bold.gt ');
    assert.equal(value.caret,value.text.length);
    const middle=insertMention('Hola mundo',person,4,4);
    assert.equal(middle.text,'Hola @person+alias@bold.gt  mundo');
    assert.equal(mentionParts(value.text,[person]).filter(part=>part.mention).length,1);
});
test('invalid selections, forged tokens and the 5000 character boundary preserve the original draft',()=>{
    assert.throws(()=>insertMention('texto',{token:'https://bad.test'}));
    assert.throws(()=>insertMention('texto',person,-1));
    assert.throws(()=>insertMention('texto',person,5,2));
    const original='x'.repeat(4990);assert.throws(()=>insertMention(original,person),/5.000/);assert.equal(original.length,4990);
});
