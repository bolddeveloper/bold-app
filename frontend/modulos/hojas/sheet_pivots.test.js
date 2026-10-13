import test from 'node:test';
import assert from 'node:assert/strict';
import {pivotSummary} from './sheet_pivots.js';
const source={startRow:0,endRow:3,startColumn:0,endColumn:1};
const sheet={cellData:{0:{0:{v:'Producto'},1:{v:'Total'}},1:{0:{v:'A'},1:{v:10}},2:{0:{v:'A'},1:{v:20}},3:{0:{v:'B'}}}};
test('tabla dinámica agrupa valores y conteo ignora celdas vacías',()=>{
  assert.deepEqual(pivotSummary(sheet,source,0,1,'sum'),[['Producto','Suma de Total'],['A',30],['B',0]]);
  assert.equal(pivotSummary(sheet,source,0,1,'count')[2][1],0);
  assert.equal(pivotSummary(sheet,source,0,1,'average')[1][1],15);
});
test('no acepta encabezados ambiguos ni campos inexistentes',()=>{
  assert.throws(()=>pivotSummary({cellData:{0:{0:{v:'A'},1:{v:'A'}}}},source,0,1,'sum'),/encabezados/);
  assert.throws(()=>pivotSummary(sheet,source,0,2,'sum'),/campos/);
});
