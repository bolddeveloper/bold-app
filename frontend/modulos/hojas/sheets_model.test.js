import test from 'node:test';
import assert from 'node:assert/strict';
import { costTotal, gridChanges, optimistic, samePerson, groupedRows, displayGrid, normalizeSnapshot, advancePending, newerFile, gridRowChanges, requiredBlockColumn } from './sheets_model.js';
const document = () => ({
  id: 'book',
  sheetOrder: ['sheet'],
  styles: {},
  sheets: {
    sheet: {
      id: 'sheet',
      name: 'Hoja',
      cellData: {
        0: {
          0: {
            v: 'block:block'
          }
        },
        1: {
          0: {
            v: 'row'
          },
          1: {
            v: 'Producto'
          },
          2: {
            v: 22.75
          },
          3: {
            v: 4
          },
          4: {
            f: '=C2*D2',
            v: 91
          }
        }
      },
      __bold: {
        blocks: [{
          id: 'block',
          type: 'costs',
          title: 'Costos',
          startRow: 0,
          rowIds: ['row'],
          columns: [{
            id: 'product',
            type: 'text'
          }, {
            id: 'price',
            type: 'currency'
          }, {
            id: 'quantity',
            type: 'number'
          }, {
            id: 'total',
            type: 'formula'
          }],
          currency: 'USD',
          tax: 0,
          discount: 0,
          task: {
            enabled: false
          }
        }]
      }
    }
  }
});
test('cost totals include every row and explicit conversion', () => {
  const data = document(),
    sheet = data.sheets.sheet,
    block = sheet.__bold.blocks[0];
  assert.equal(costTotal(sheet, block), 91);
  block.conversion = {
    currency: 'HNL',
    rate: 24
  };
  assert.equal(costTotal(sheet, block), 2184);
  block.discount = 10;
  assert.ok(Math.abs(costTotal(sheet, block) - 1965.6) < 1e-9);
});
test('small cell edits retain permanent row identity and before value', () => {
  const before = document(),
    after = structuredClone(before);
  after.sheets.sheet.cellData[1][2].v = 30;
  const changes = gridChanges(before, after);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].row, 'row');
  assert.equal(changes[0].before.v, 22.75);
  assert.deepEqual(optimistic(before, changes), after);
});
test('calculated values do not generate another edit cycle', () => {
  const before = document(),
    after = structuredClone(before);
  after.sheets.sheet.cellData[1][4].v = 123;
  assert.deepEqual(gridChanges(before, after), []);
});
test('a moved row is a structural operation rather than reassigned cells', () => {
  const before = document(),
    after = structuredClone(before);
  after.sheets.sheet.cellData[2] = after.sheets.sheet.cellData[1];
  delete after.sheets.sheet.cellData[1];
  assert.equal(gridChanges(before, after)[0].kind, 'grid');
});
test('directory shows one profile per person in selected department', () => {
  const people = [{
    id: 'a',
    employee: 'one',
    unit: 'IT',
    name: 'Luis'
  }, {
    id: 'b',
    employee: 'one',
    unit: 'Marketing',
    name: 'Luis'
  }];
  assert.equal(samePerson(people).length, 1);
  assert.equal(samePerson(people, 'Marketing')[0].id, 'b');
});
test('filters operate on canonical grid cells without deleting them', () => {
  const data = document(),
    sheet = data.sheets.sheet,
    block = sheet.__bold.blocks[0];
  assert.equal(groupedRows(sheet, block, {
    search: 'Producto'
  }).length, 1);
  assert.equal(groupedRows(sheet, block, {
    search: 'Nada'
  }).length, 0);
  assert.equal(block.rowIds.length, 1);
});
test('a structural draft keeps its base when another editor advanced the file', () => {
  const pending = [{
    revision: 3,
    changes: [{
      kind: 'grid',
      document: {}
    }]
  }, {
    revision: 3,
    changes: [{
      kind: 'cell'
    }]
  }];
  advancePending(pending, {
    revision: 3
  }, {
    revision: 5
  }, {
    revision: 5
  });
  assert.equal(pending[0].revision, 3);
  assert.equal(pending[1].revision, 5);
});
test('consecutive own operations advance structural drafts and old acknowledgements never roll back cache', () => {
  const pending = [{
    revision: 3,
    changes: [{
      kind: 'sheet.add'
    }]
  }];
  advancePending(pending, {
    revision: 3
  }, {
    revision: 4
  }, {
    revision: 3
  });
  assert.equal(pending[0].revision, 4);
  assert.equal(newerFile({
    revision: 3
  }, {
    revision: 4
  }), false);
  assert.equal(newerFile({
    revision: 4,
    calculated_revision: 3
  }, {
    revision: 4,
    calculated_revision: 4
  }), false);
});
test('normalization follows permanent column IDs after moving columns', () => {
  const data = document(),
    sheet = data.sheets.sheet,
    block = sheet.__bold.blocks[0];
  for (let index = 0; index < block.columns.length; index++) {
    block.columns[index].name = block.columns[index].id;
    sheet.cellData[0][index + 1] = {
      v: block.columns[index].id,
      custom: {
        boldColumn: block.columns[index].id
      }
    };
  }
  const moved = structuredClone(data);
  for (const cells of Object.values(moved.sheets.sheet.cellData)) [cells[1], cells[2]] = [cells[2], cells[1]];
  const normalized = normalizeSnapshot(moved, data);
  assert.equal(normalized.sheets.sheet.__bold.blocks[0].columns[0].id, 'price');
  assert.equal(normalized.sheets.sheet.cellData[1][1].v, 22.75);
});
test('a primary person name containing a comma remains one selection', () => {
  const data = document(),
    block = data.sheets.sheet.__bold.blocks[0];
  block.columns[0] = {
    id: 'responsible',
    type: 'responsible'
  };
  const people = [{
    id: 'assignment',
    employee: 'person',
    name: 'Apellido, Nombre',
    email: 'person@bold.gt'
  }];
  data.sheets.sheet.cellData[1][1].v = 'assignment';
  assert.equal(normalizeSnapshot(displayGrid(data, people), data, people).sheets.sheet.cellData[1][1].v, 'assignment');
});

// Preparadas; no ejecutar mientras siga vigente la indicación de no probar.
test('rich descriptions keep original images and markup after editing a different grid cell',()=>{
  const data=document(),block=data.sheets.sheet.__bold.blocks[0];
  block.columns[0]={id:'description',type:'file'};
  const html='<!--bold-rich-text--><p>Archivo <img src="https://example.com/image.png"></p>';
  data.sheets.sheet.cellData[1][1].v=html;
  const visible=displayGrid(data,[]);
  assert.equal(visible.sheets.sheet.cellData[1][1].v,'Archivo  [1 imagen]');
  visible.sheets.sheet.cellData[1][2].v=30;
  assert.equal(normalizeSnapshot(visible,data).sheets.sheet.cellData[1][1].v,html);
});
test('duplicate positions keep the current valid assignment when the displayed person did not change',()=>{
  const data=document(),block=data.sheets.sheet.__bold.blocks[0];block.columns[0]={id:'responsible',type:'responsible'};
  const people=[{id:'first',employee:'person',unit:'unit',name:'Nombre',email:'name@bold.gt'},{id:'second',employee:'person',unit:'unit',name:'Nombre',email:'name@bold.gt'}];
  data.sheets.sheet.cellData[1][1].v='first';
  assert.equal(samePerson(people).length,1);
  assert.equal(normalizeSnapshot(displayGrid(data,people),data,people).sheets.sheet.cellData[1][1].v,'first');
});
test('native table row commands preserve technical identities and reject header deletion',()=>{
  const data=document(),block=data.sheets.sheet.__bold.blocks[0];
  const insert=gridRowChanges(data,'sheet','sheet.command.insert-row',{startRow:1,endRow:4});
  assert.equal(insert[0].kind,'row.add');assert.equal(insert[0].count,4);
  const remove=gridRowChanges(data,'sheet','sheet.command.remove-row-by-range',{startRow:1,endRow:1});
  assert.equal(remove[0].row,block.rowIds[0]);
  assert.throws(()=>gridRowChanges(data,'sheet','sheet.command.remove-row-by-range',{startRow:0,endRow:1}),/encabezados/);
});

test('cambios de orden interno y avisos de Drive no son una edición de cuadrícula',()=>{
  const before=document(),after=structuredClone(before);
  before.sheets.sheet.columnData={1:{w:200,hd:0}};
  after.sheets.sheet.columnData={1:{hd:0,w:200}};
  after.name='Archivo renombrado';
  after.synced_revision=20;
  assert.deepEqual(gridChanges(before,after),[]);
});

test('tamaños y nombres se aplican sin sustituir la estructura; añadir columnas sigue requiriendo una actualización estructural',()=>{
  const before=document(),after=structuredClone(before);
  after.sheets.sheet.rowData={1:{h:80}};
  after.sheets.sheet.columnData={2:{w:250}};
  after.sheets.sheet.cellData[0][1]={v:'Producto actualizado'};
  assert.equal(gridChanges(before,after)[0].kind,'grid');
  const incremental=gridChanges(before,after,{layout:false});
  assert.equal(incremental.length,1);
  assert.equal(incremental[0].kind,'cell');
  assert.equal(incremental[0].after.v,'Producto actualizado');
  after.sheets.sheet.columnCount=20;
  assert.equal(gridChanges(before,after,{layout:false})[0].kind,'grid');
});

test('los ajustes conservan columnas necesarias para cálculos y tareas',()=>{
  const block=document().sheets.sheet.__bold.blocks[0];
  assert.equal(requiredBlockColumn(block,{id:'price'}),true);
  assert.equal(requiredBlockColumn(block,{id:'extra'}),false);
  assert.equal(requiredBlockColumn({...block,type:'tasks'},{id:'responsible'}),true);
  assert.equal(requiredBlockColumn({...block,type:'text',task:{enabled:true}},{id:'status'}),true);
});

test('idle plugin resources do not save, remount or hide real cell edits', () => {
  const before = document(), after = structuredClone(before);
  after.resources = [{name: 'SHEET_UNIVER_THREAD_COMMENT_PLUGIN', data: '{}'}, {name: 'SHEET_NOTE_PLUGIN', data: ''}];
  assert.deepEqual(gridChanges(before, after), []);
  after.sheets.sheet.cellData[1][2].v = 30;
  const changes = gridChanges(before, after);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].kind, 'cell');
  assert.equal(changes[0].after.v, 30);
});

test('resource order is irrelevant but adding and removing actual comments persists', () => {
  const before = document(), after = structuredClone(before);
  before.resources = [{name: 'NOTES', data: '{"sheet":{"A1":"nota"}}'}, {name: 'CHARTS', data: '[{"id":"chart"}]'}];
  after.resources = [...before.resources].reverse();
  assert.deepEqual(gridChanges(before, after), []);
  after.resources = after.resources.map(item => item.name === 'NOTES' ? {...item, data: '{}'} : item);
  assert.equal(gridChanges(before, after)[0].kind, 'grid');
  assert.equal(gridChanges(after, before)[0].kind, 'grid');
});

test('restoring native table theme rules does not create another grid save', () => {
  const before = document(), after = structuredClone(before);
  const theme = {rangeThemeStyleMapJson:{'table-excel-1':{name:'table-excel-1',headerRowStyle:{bg:{rgb:'#535fc1'}}}},rangeThemeStyleRuleMap:{}};
  before.resources = [{name:'SHEET_RANGE_THEME_MODEL_PLUGIN',data:JSON.stringify(theme)}];
  theme.rangeThemeStyleRuleMap.runtime = {themeName:'table-excel-1',rangeInfo:{subUnitId:'sheet',range:{startRow:0,endRow:3,startColumn:1,endColumn:4}}};
  after.resources = [{name:'SHEET_RANGE_THEME_MODEL_PLUGIN',data:JSON.stringify(theme,null,2)}];
  assert.deepEqual(gridChanges(before,after), []);
  theme.rangeThemeStyleMapJson['table-excel-1'].headerRowStyle.bg.rgb = '#ef3340';
  after.resources[0].data = JSON.stringify(theme);
  assert.equal(gridChanges(before,after)[0].kind, 'grid');
});
test('native file links preserve rich content and update the same link',()=>{
  const data=document(),block=data.sheets.sheet.__bold.blocks[0];
  block.columns[0]={id:'description',type:'file'};
  const html='<!--bold-rich-text--><p><a href="https://example.com/old">Archivo</a><img src="https://example.com/image.png"></p>';
  data.sheets.sheet.cellData[1][1].v=html;
  const visible=displayGrid(data,[]);
  visible.sheets.sheet.cellData[1][1].p={body:{customRanges:[{rangeType:0,properties:{url:'https://example.com/new?a=1&b=2'}}]}};
  const value=normalizeSnapshot(visible,data).sheets.sheet.cellData[1][1].v;
  assert.match(value,/href="https:\/\/example.com\/new\?a=1&amp;b=2"/);assert.match(value,/<img src=/);
});
test('date validations use ISO dates instead of interpreting another browser locale',()=>{
  const data=document();
  const date=new Date(2026,9,9);
  data.resources=[{name:'SHEET_DATA_VALIDATION_PLUGIN',data:JSON.stringify({sheet:[{uid:'date',type:'date',formula1:date.toLocaleDateString(),ranges:[{startRow:3,endRow:3,startColumn:1,endColumn:1}]}]})}];
  const snapshot=normalizeSnapshot(data,data);
  const rule=JSON.parse(snapshot.resources[0].data).sheet[0];
  assert.equal(rule.formula1,'2026-10-09');
});

test('managed selectors show names and stay outside the save history after reopening', () => {
  const data=document(), block=data.sheets.sheet.__bold.blocks[0];
  block.columns[0]={id:'responsible',type:'responsible'};
  const people=[{id:'first',employee:'person',name:'Samuel',email:'samuel@bold.gt'}];
  data.sheets.sheet.cellData[1][1].v='first';
  data.sheets.sheet.cellData[1][1].p={body:{dataStream:'Samuel <samuel@bold.gt>\r\n'}};
  data.sheets.sheet.cellData[1][1].si='shared-person';
  const native={uid:'native',type:'list',formula1:'["A","B"]',ranges:[{startRow:4,endRow:5,startColumn:7,endColumn:7}]};
  const old={uid:'old-random-id',type:'list',formula1:'["Samuel <samuel@bold.gt>"]',ranges:[{startRow:1,endRow:1,startColumn:1,endColumn:1}]};
  data.resources=[{name:'SHEET_DATA_VALIDATION_PLUGIN',data:JSON.stringify({sheet:[native,old]})}];
  const visible=displayGrid(data,people), rules=JSON.parse(visible.resources[0].data).sheet;
  assert.equal(visible.sheets.sheet.cellData[1][1].v,'Samuel');
  assert.equal(visible.sheets.sheet.cellData[1][1].p,undefined);
  assert.equal(visible.sheets.sheet.cellData[1][1].si,undefined);
  assert.equal(rules[1].renderMode,1);
  assert.equal(rules[1].formula1,'["Samuel"]');
  assert.deepEqual(rules,JSON.parse(displayGrid(data,people).resources[0].data).sheet);
  const saved=normalizeSnapshot(visible,data,people);
  assert.deepEqual(JSON.parse(saved.resources[0].data).sheet,[native]);
  assert.equal(saved.sheets.sheet.cellData[1][1].v,'first');
  assert.deepEqual(gridChanges(data,saved),[]);
  visible.sheets.sheet.cellData[1][2].v=25;
  assert.equal(gridChanges(data,normalizeSnapshot(visible,data,people))[0].kind,'cell');
});

test('new name selections preserve IDs, comma names and existing valid positions', () => {
  const data=document(), block=data.sheets.sheet.__bold.blocks[0];
  block.columns[0]={id:'collaborators',type:'collaborators'};
  const people=[{id:'first',employee:'one',name:'Apellido, Nombre'},{id:'second',employee:'one',name:'Apellido, Nombre'},{id:'other',employee:'two',name:'Samuel'}];
  data.sheets.sheet.cellData[1][1].v='first';
  const visible=displayGrid(data,people);
  visible.sheets.sheet.cellData[1][1].v='Apellido, Nombre, Samuel';
  assert.equal(normalizeSnapshot(visible,data,people).sheets.sheet.cellData[1][1].v,'first,other');
  block.columns[0].type='responsible';
  visible.sheets.sheet.cellData[1][1].v='Samuel';
  assert.equal(normalizeSnapshot(visible,data,people).sheets.sheet.cellData[1][1].v,'other');
  people.push({id:'ambiguous',employee:'three',name:'Samuel'});
  assert.throws(()=>normalizeSnapshot(visible,data,people),/mismo nombre/);
});

test('JSON multi selections save person IDs without losing commas or valid positions', () => {
  const data=document(),block=data.sheets.sheet.__bold.blocks[0];
  block.columns[0]={id:'collaborators',type:'collaborators'};
  const people=[{id:'first',employee:'one',name:'Apellido, Nombre'},{id:'second',employee:'one',name:'Apellido, Nombre'},{id:'other',employee:'two',name:'Samuel'}];
  data.sheets.sheet.cellData[1][1].v='second';
  const before=structuredClone(data),visible=displayGrid(data,people);
  visible.sheets.sheet.cellData[1][1].v='["Apellido, Nombre","Samuel"]';
  const saved=normalizeSnapshot(visible,data,people);
  assert.equal(saved.sheets.sheet.cellData[1][1].v,'second,other');
  assert.equal(gridChanges(data,saved)[0].kind,'cell');
  assert.deepEqual(saved.sheets.sheet.cellData[1][2],data.sheets.sheet.cellData[1][2]);
  assert.deepEqual(data,before);
  visible.sheets.sheet.cellData[1][1].v='[]';
  assert.equal(normalizeSnapshot(visible,data,people).sheets.sheet.cellData[1][1].v,'');
  visible.sheets.sheet.cellData[1][1].v='["Desconocido"]';
  assert.throws(()=>normalizeSnapshot(visible,data,people),/directorio/);
  people.push({id:'ambiguous',employee:'three',name:'Samuel'});
  visible.sheets.sheet.cellData[1][1].v='["Samuel"]';
  assert.throws(()=>normalizeSnapshot(visible,data,people),/mismo nombre/);
});

test('calculated row heights do not save or reload but manual sizes do', () => {
  const data=document(), snapshot=structuredClone(data);
  data.sheets.sheet.rowData={1:{h:28,ia:1,ah:45}};
  snapshot.sheets.sheet.rowData={1:{h:28,ia:1,ah:60},2:{ah:28}};
  assert.deepEqual(gridChanges(data,snapshot),[]);
  const saved=normalizeSnapshot(snapshot,data);
  assert.deepEqual(saved.sheets.sheet.rowData,{1:{h:28,ia:1}});
  saved.sheets.sheet.cellData[1][2].v=25;
  assert.equal(gridChanges(data,saved)[0].kind,'cell');
  saved.sheets.sheet.rowData[1].h=50;
  assert.equal(gridChanges(data,saved)[0].kind,'grid');
});

test('native style IDs and reordered style fields do not resave cell or layout formats',()=>{
  const data=document(),snapshot=structuredClone(data);
  data.styles={original:{bg:{rgb:'#ef3340'},ul:{s:1,t:10}}};
  data.sheets.sheet.columnData={1:{w:180,s:'original'}};
  data.sheets.sheet.rowData={1:{h:28,s:'original'}};
  data.sheets.sheet.cellData[1][1].s='original';
  snapshot.styles={native:{ul:{t:10,s:1},bg:{rgb:'#ef3340'}}};
  snapshot.sheets.sheet.columnData={1:{w:180,s:'native'}};
  snapshot.sheets.sheet.rowData={1:{h:28,s:'native'}};
  snapshot.sheets.sheet.cellData[1][1].s='native';
  const saved=normalizeSnapshot(snapshot,data);
  assert.deepEqual(saved.sheets.sheet.columnData,data.sheets.sheet.columnData);
  assert.deepEqual(saved.sheets.sheet.rowData,data.sheets.sheet.rowData);
  assert.deepEqual(gridChanges(data,saved),[]);
  snapshot.styles.native.bg.rgb='#ffffff';
  assert.equal(gridChanges(data,normalizeSnapshot(snapshot,data))[0].kind,'grid');
});
