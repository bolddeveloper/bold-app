import test from 'node:test';
import assert from 'node:assert/strict';
import {mentionParts,insertMention} from './mention_model.js';

const person={employee_id:'person',name:'Persona de prueba',token:'@person+alias@bold.gt'};
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
