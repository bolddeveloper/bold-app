import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareBlockTables} from '../../../services/sheets-engine/block_tables.mjs';
import {displayGrid,normalizeSnapshot,gridChanges} from './sheets_model.js';

const fixture=()=>({id:'book',styles:{},sheetOrder:['sheet'],sheets:{sheet:{id:'sheet',name:'Equipo',rowCount:100,columnCount:10,columnData:{1:{w:320}},rowData:{1:{h:60}},cellData:{
  0:{0:{v:'block:tasks'},1:{v:'Tarea',custom:{boldColumn:'title'},s:{bg:{rgb:'#ef3340'},cl:{rgb:'#ffffff'},tb:3}}},
  1:{0:{v:'row1'},1:{v:'Preparar propuesta',s:{bg:{rgb:'#ffffff'},tb:3}}},
  2:{0:{v:'row2'},1:{v:'Revisar resultados',s:{bg:{rgb:'#f5f7fa'},tb:3}}}
},__bold:{blocks:[{id:'tasks',type:'tasks',title:'Tareas del equipo',startRow:0,rowIds:['row1','row2'],columns:[{id:'title',name:'Tarea',type:'text'}],task:{enabled:false}}]}}}});
const tables=document=>JSON.parse(document.resources.find(item=>item.name==='SHEET_TABLE_PLUGIN').data).sheet.tables;

test('eliminar un gráfico importado registra su parte de Excel para que no reaparezca',()=>{
  const original=fixture(),name='__casual_sheets_charts__';
  original.resources=[{name,data:JSON.stringify({v:1,charts:[{id:'chart',excelPart:'xl/charts/chart1.xml'}]})}];
  const visible=displayGrid(original,[]);
  visible.resources=visible.resources.filter(item=>item.name!==name);
  const deleted=normalizeSnapshot(visible,original);
  const charts=JSON.parse(deleted.resources.find(item=>item.name===name).data);
  assert.deepEqual(charts,{v:1,charts:[],deletedParts:['xl/charts/chart1.xml']});
  assert.deepEqual(gridChanges(deleted,normalizeSnapshot(displayGrid(deleted,[]),deleted)),[]);
});

test('los bloques existentes y nuevos se muestran como tablas sin cambiar sus datos ni tamaños',()=>{
  const data=fixture(),original=structuredClone(data),visible=displayGrid(data,[]);
  const [table]=tables(visible);
  assert.equal(table.options.tableStyleId,'table-bold-tasks');
  assert.deepEqual(table.range,{startRow:0,endRow:2,startColumn:1,endColumn:1});
  assert.equal(visible.sheets.sheet.cellData[0][1].s.bg.rgb,'#535fc1');
  assert.equal(visible.sheets.sheet.cellData[2][1].s.bg.rgb,'#f6f8f9');
  assert.deepEqual(visible.sheets.sheet.columnData,data.sheets.sheet.columnData);
  assert.deepEqual(visible.sheets.sheet.rowData,data.sheets.sheet.rowData);
  assert.deepEqual(data,original);
  const saved=normalizeSnapshot(visible,data);
  assert.deepEqual(saved.sheets.sheet.cellData,data.sheets.sheet.cellData);
  assert.deepEqual(gridChanges(data,saved),[]);
  visible.sheets.sheet.cellData[1][1].v='Propuesta actualizada';
  const changes=gridChanges(data,normalizeSnapshot(visible,data));
  assert.equal(changes.length,1);assert.equal(changes[0].kind,'cell');
  assert.equal(changes[0].row,'row1');
  assert.deepEqual(changes[0].before,data.sheets.sheet.cellData[1][1]);
});
test('filas y columnas actualizan la misma tabla sin duplicarla',()=>{
  const data=fixture();prepareBlockTables(data);
  const id=tables(data)[0].id,block=data.sheets.sheet.__bold.blocks[0];
  block.rowIds.push('row3');block.columns.push({id:'note',name:'Notas',type:'text'});
  prepareBlockTables(data);prepareBlockTables(data);
  assert.equal(tables(data).length,1);assert.equal(tables(data)[0].id,id);
  assert.equal(tables(data)[0].range.endRow,3);assert.equal(tables(data)[0].range.endColumn,2);
  block.rowIds=[];prepareBlockTables(data);assert.equal(tables(data).length,0);
});
test('las tablas importadas y diseños personalizados conservan su definición',()=>{
  const data=fixture(),imported={id:'original',name:'Tabla_2',range:{startRow:0,endRow:2,startColumn:1,endColumn:1},columns:[],options:{tableStyleId:'custom-purple'},filters:{},meta:{excelStyleName:'Procesos-style'}};
  data.resources=[{name:'SHEET_TABLE_PLUGIN',data:JSON.stringify({sheet:{tables:[imported],tableFilteredOutRows:[]}})}];
  const visible=displayGrid(data,[]);
  assert.deepEqual(tables(visible),[imported]);
  assert.deepEqual(visible.sheets.sheet.cellData,data.sheets.sheet.cellData);
});
test('activar tareas en un bloque de texto también lo agrupa como tabla',()=>{
  const data=fixture(),block=data.sheets.sheet.__bold.blocks[0];
  block.type='text';prepareBlockTables(data);assert.equal(data.resources,undefined);
  block.task.enabled=true;prepareBlockTables(data);
  assert.equal(tables(data)[0].options.tableStyleId,'table-bold-tasks');
});


test('las tablas automáticas antiguas adoptan el diseño sin reemplazar estilos elegidos',()=>{
  const data=fixture();prepareBlockTables(data);
  const resource=data.resources.find(item=>item.name==='SHEET_TABLE_PLUGIN'),saved=JSON.parse(resource.data);
  saved.sheet.tables[0].options.tableStyleId='table-default-0';delete saved.sheet.tables[0].meta.boldTaskDesign;resource.data=JSON.stringify(saved);
  prepareBlockTables(data);assert.equal(tables(data)[0].options.tableStyleId,'table-bold-tasks');
  saved.sheet.tables[0].options.tableStyleId='custom-design';resource.data=JSON.stringify(saved);
  prepareBlockTables(data);assert.equal(tables(data)[0].options.tableStyleId,'custom-design');
});

test('quitar una tabla automática conserva las celdas y no la recrea al guardar o exportar',()=>{
  const original=fixture(),visible=displayGrid(original,[]);
  visible.resources.find(item=>item.name==='SHEET_TABLE_PLUGIN').data='{}';
  const removed=normalizeSnapshot(visible,original);
  for (const [row,cells] of Object.entries(original.sheets.sheet.cellData)) for (const [col,cell] of Object.entries(cells)) assert.equal(removed.sheets.sheet.cellData[row][col].v,cell.v);
  const [change]=gridChanges(normalizeSnapshot(displayGrid(original,[]),original),removed);
  assert.equal(change.kind,'grid');
  assert.deepEqual(tables(displayGrid(removed,[])),[]);
  prepareBlockTables(removed);assert.deepEqual(tables(removed),[]);
  const savedAgain=normalizeSnapshot(displayGrid(removed,[]),removed);
  assert.deepEqual(gridChanges(removed,savedAgain),[]);
});

test('editar el diseño usa la tabla guardada como base y respeta un estilo elegido',()=>{
  const original=fixture();prepareBlockTables(original);
  const resource=original.resources.find(item=>item.name==='SHEET_TABLE_PLUGIN'),data=JSON.parse(resource.data);
  data.sheet.tables[0].options.tableStyleId='table-default-0';delete data.sheet.tables[0].meta.boldTaskDesign;
  resource.data=JSON.stringify(data);
  const base=normalizeSnapshot(displayGrid(original,[]),original);
  assert.deepEqual(tables(base),tables(original));
  const visible=displayGrid(original,[]),changed=JSON.parse(visible.resources.find(item=>item.name==='SHEET_TABLE_PLUGIN').data);
  changed.sheet.tables[0].options.tableStyleId='table-default-0';
  visible.resources.find(item=>item.name==='SHEET_TABLE_PLUGIN').data=JSON.stringify(changed);
  const saved=normalizeSnapshot(visible,original),[change]=gridChanges(base,saved);
  assert.equal(change.kind,'grid');
  assert.equal(tables(change.baseDocument)[0].options.tableStyleId,'table-default-0');
  assert.equal(tables(displayGrid(saved,[]))[0].options.tableStyleId,'table-default-0');
});

test('quitar una tabla importada sobre un bloque tampoco crea una tabla automática',()=>{
  const original=fixture();prepareBlockTables(original);
  const resource=original.resources.find(item=>item.name==='SHEET_TABLE_PLUGIN'),data=JSON.parse(resource.data);
  data.sheet.tables[0].id='imported';data.sheet.tables[0].name='TablaImportada';data.sheet.tables[0].meta={};
  resource.data=JSON.stringify(data);
  const visible=displayGrid(original,[]);
  visible.resources.find(item=>item.name==='SHEET_TABLE_PLUGIN').data='{}';
  assert.deepEqual(tables(displayGrid(normalizeSnapshot(visible,original),[])),[]);
});
