import test from "node:test";
import assert from "node:assert/strict";
import {defaultStages,distributeStages,reorderStages,validateStages} from "./pipeline_stages.js";

test("normal stages distribute automatically and terminals stay last",()=>{
 const rows=defaultStages();rows.push({id:'failed',name:'Fallida',kind:'failed',probability:0});
 assert.deepEqual(distributeStages(rows).map(s=>s.probability),[25,50,75,100,0]);
 assert.equal(validateStages(rows),'');
});
test("manual percentages survive additions and interpolate automatic slots",()=>{
 const rows=defaultStages();rows[1]={...rows[1],manual:true,probability:60};
 rows.splice(1,0,{id:'new',name:'Extra',kind:'open',manual:false,probability:0});
 const next=distributeStages(rows);assert.equal(next[2].probability,60);assert.deepEqual(next.slice(0,4).map(s=>s.probability),[20,40,60,80]);
});
test("dragging moves stage properties but keeps percentage slots",()=>{
 const rows=defaultStages();rows[1].manual=true;
 const next=reorderStages(rows,0,2);
 assert.deepEqual(next.map(s=>s.id),[rows[1].id,rows[2].id,rows[0].id,rows[3].id]);
 assert.deepEqual(next.map(s=>s.probability),[25,50,75,100]);assert.equal(next[1].manual,true);
 assert.deepEqual(reorderStages(rows,0,3),rows);
});
test("names, ordering and at least one normal stage are validated",()=>{
 const rows=defaultStages();rows[1].probability=1;assert.match(validateStages(rows),/porcentajes/);
 assert.match(validateStages(rows.filter(s=>s.kind!=='open')),/normal/);
 rows[1].probability=50;rows[1].name=rows[0].name;assert.match(validateStages(rows),/diferente/);
});
