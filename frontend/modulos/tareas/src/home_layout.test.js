import test from "node:test";
import assert from "node:assert/strict";
import {normalizeHomeLayout,migrateHomeLayout,defaultHomeLayout,placeHomeWidgets,reorderHomeWidgets,HOME_WIDGET_HEIGHT} from "./home_layout.js";
test("upgrade merges repeated widgets without losing notes, names or shortcuts",()=>{
 const old=[{id:"n",type:"notes",title:"Mis ideas",size:"large"},{id:"m",type:"metrics",metrics:["assigned"]},{id:"s",type:"status"},{id:"t",type:"tasks"},{id:"d",type:"deadlines"},{id:"x",type:"shortcuts",shortcuts:["create_task"]},{id:"y",type:"shortcuts",shortcuts:["module:calendar","create_task"]},{id:"team",type:"presence"}];
 const result=migrateHomeLayout(old);
 assert.deepEqual(result.map(row=>row.type),["notes","status","tasks","shortcuts","agenda","weekly"]);
 assert.equal(result[0].title,"Mis ideas");assert.equal(result[0].size,undefined);
 assert.deepEqual(result[3].shortcuts,["create_task","module:calendar"]);
 assert.equal(old[0].size,"large");
});
test("removed widgets stay removed and invalid legacy sizes never affect layout",()=>{
 assert.deepEqual(migrateHomeLayout([]),[]);assert.deepEqual(normalizeHomeLayout([]),[]);
 const saved=normalizeHomeLayout([{id:"a",type:"notes",size:"large",width:9,height:999,lockedWidth:true}]);
 assert.deepEqual(saved,[{id:"a",type:"notes"}]);assert.equal(normalizeHomeLayout(saved).length,1);
 assert.equal(normalizeHomeLayout(null).length,6);
});
test("automatic cards have no overlaps in every responsive mode and order",()=>{
 for(const columns of [1,6,12,16]) for(const rows of [defaultHomeLayout(),defaultHomeLayout().reverse()]) {
  const {positions,height}=placeHomeWidgets(rows,{},columns), count=columns===1?1:columns===6?2:columns===16?4:3;
  rows.forEach((row,index)=>{const at=positions[row.id];assert.equal(at.top,Math.floor(index/count)*(HOME_WIDGET_HEIGHT+14));assert.equal(at.height,HOME_WIDGET_HEIGHT);assert.equal(at.column,index%count*columns/count);});
  assert.equal(height,Math.ceil(rows.length/count)*(HOME_WIDGET_HEIGHT+14)-14);
 }
});
test("reordering preserves widget content and supports cancel snapshots",()=>{
 const rows=defaultHomeLayout(), snapshot=[...rows], moved=reorderHomeWidgets(rows,rows[0].id,rows[2].id,true);
 assert.equal(moved[2],rows[0]);assert.deepEqual(rows,snapshot);
 assert.equal(reorderHomeWidgets(rows,"missing",rows[0].id),rows);
 assert.equal(reorderHomeWidgets(rows,rows[0].id,rows[1].id),rows);
});
