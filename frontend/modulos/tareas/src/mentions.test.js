import test from 'node:test';
import assert from 'node:assert/strict';
import {mentionAtCaret, mentionPeople} from './mentions.js';
test('menciones detectan @ y nombres sin confundir correos ni texto terminado', () => {
    assert.deepEqual(mentionAtCaret('Hola @'), {query:'',length:1});
    assert.deepEqual(mentionAtCaret('Hola @Sofía Mo'), {query:'Sofía Mo',length:9});
    assert.equal(mentionAtCaret('nombre@bold.gt'),null);
    assert.equal(mentionAtCaret('@sofia@bold.gt '),null);
    assert.equal(mentionAtCaret('Sin mención'),null);
});
test('busca por nombre o correo, ignora acentos y evita duplicar personas de varios cargos', () => {
    const people=[{name:'Sofía Molina',email:'sofia@bold.gt'},{name:'Sofía Molina',email:'sofia@bold.gt'},{name:'Otra persona',email:'otra@bold.gt'}];
    assert.equal(mentionPeople(people,'sofia').length,1);
    assert.equal(mentionPeople(people,'otra@').length,1);
    assert.equal(mentionPeople(people,'inexistente').length,0);
    assert.equal(mentionPeople(Array.from({length:20},(_,i)=>({name:'Persona',email:`p${i}@bold.gt`})),'').length,6);
});
