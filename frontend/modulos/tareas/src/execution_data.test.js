import test from 'node:test';
import assert from 'node:assert/strict';
import {copyPhaseTemplate,checkPhaseGraph,phaseDefinition} from './execution_data.js';

test('applying a template creates fresh identities and rewires its dependencies',()=>{
    const rows=[{id:'a',name:'Revisar',lead:'person',unit:'it',responsible:['person']},{id:'b',name:'Publicar',lead:'person',unit:'it',prerequisites:['a']}];
    let count=0;const copy=copyPhaseTemplate(rows,()=>`copy-${++count}`);
    assert.deepEqual(copy.map(row=>row.id),['copy-1','copy-2']);assert.deepEqual(copy[1].prerequisites,['copy-1']);
    copy[0].name='Otro proceso';assert.equal(rows[0].name,'Revisar');
    assert.equal(checkPhaseGraph(copy),'');
});
test('parallel dependencies are accepted and cycles or dangling references rejected',()=>{
    const rows=['a','b','c'].map(id=>({id,name:id,lead:'person',unit:'it',prerequisites:[]}));
    rows[2].prerequisites=['a','b'];assert.equal(checkPhaseGraph(rows),'');
    rows[0].prerequisites=['c'];assert.match(checkPhaseGraph(rows),/ciclos/);
    rows[0].prerequisites=['missing'];assert.match(checkPhaseGraph(rows),/dependencias/);
});
test('an editable definition never includes server state, dates or permissions',()=>{
    const definition=phaseDefinition({id:'a',name:'Paso',status:'completed',can_act:true,completed_at:'2026-01-01'});
    for(const key of ['status','can_act','completed_at'])assert.equal(key in definition,false);
});
