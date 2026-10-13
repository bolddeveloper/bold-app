import test from 'node:test';
import assert from 'node:assert/strict';
import {chartSelection, chartTypes} from './sheet_charts.js';

const selection={sheetId:'costs',range:{startRow:1,endRow:4,startColumn:1,endColumn:3}};
const document=()=>({sheets:{costs:{name:'Costos',cellData:{
  1:{1:{v:'Producto'},2:{v:'Precio'},3:{v:'Cantidad'}},
  2:{1:{v:'Licencias'},2:{v:0},3:{v:4}},
  3:{1:{v:'Diseño'},2:{v:49},3:{v:3}},
  4:{1:{v:'Texto'},2:{v:'   '},3:{v:false}}
}}}});

test('la vista previa conserva ceros y muestra el rango sin modificar datos',()=>{
  const snapshot=document(),before=structuredClone(snapshot),data=chartSelection(snapshot,selection);
  assert.equal(data.error,'');
  assert.equal(data.rangeLabel,'Costos · B2:D5');
  assert.deepEqual(data.headers,['Producto','Precio','Cantidad']);
  assert.deepEqual(data.preview[0],['Licencias',0,4]);
  assert.equal(data.rows,3);
  assert.deepEqual(snapshot,before);
});

test('un gráfico exige encabezados, nombres y cantidades; texto y casillas no cuentan como números',()=>{
  assert.ok(chartSelection(document(),null).error);
  assert.ok(chartSelection(document(),{...selection,range:{...selection.range,endRow:1}}).error);
  const snapshot=document();
  snapshot.sheets.costs.cellData={1:{1:{v:'Nombre'},2:{v:'Valor'}},2:{1:{v:'Algo'},2:{v:false}},3:{2:{v:'   '}},4:{2:{v:'texto'}}};
  assert.ok(chartSelection(snapshot,selection).error);
});

test('circular usa solo la segunda columna; dispersión necesita dos cantidades en la misma fila',()=>{
  const snapshot=document();
  snapshot.sheets.costs.cellData={1:{1:{v:'Nombre'},2:{v:'X'},3:{v:'Y'}},2:{1:{v:'A'},3:{v:10}},3:{1:{v:'B'},2:{v:20}}};
  assert.equal(chartSelection(snapshot,selection,'column').error,'');
  assert.equal(chartSelection(snapshot,selection,'pie').error,'');
  assert.ok(chartSelection(snapshot,selection,'scatter').error);
  delete snapshot.sheets.costs.cellData[3][2];
  assert.ok(chartSelection(snapshot,selection,'doughnut').error);
  snapshot.sheets.costs.cellData[2][2]={v:0};
  assert.equal(chartSelection(snapshot,selection,'scatter').error,'');
  assert.ok(chartSelection(snapshot,{...selection,range:{...selection.range,endColumn:2}},'scatter').error);
});

test('los rangos amplios muestran solo una vista previa corta y conservan los 13 tipos existentes',()=>{
  const data=chartSelection(document(),{...selection,range:{startRow:1,endRow:19999,startColumn:1,endColumn:499}});
  assert.equal(data.error,'');
  assert.equal(data.headers.length,4);
  assert.equal(data.preview.length,3);
  assert.ok(chartSelection(document(),{...selection,range:{...selection.range,endColumn:500}}).error);
  assert.deepEqual(chartTypes.flatMap(group=>Object.keys(group.options)).sort(),['area','area-stacked','bar','bar-stacked','bar-stacked-100','column','column-stacked','column-stacked-100','doughnut','line','line-stacked','pie','scatter'].sort());
});
