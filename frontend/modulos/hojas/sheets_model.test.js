import test from 'node:test';
import assert from 'node:assert/strict';
import { costTotal, gridChanges, optimistic, samePerson, groupedRows, displayGrid, normalizeSnapshot, advancePending, newerFile, gridRowChanges, requiredBlockColumn, repairRejectedDraft } from './sheets_model.js';
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
test('native table row commands preserve technical identities and delete complete blocks',()=>{
  const data=document(),block=data.sheets.sheet.__bold.blocks[0];
  const insert=gridRowChanges(data,'sheet','sheet.command.insert-row',{startRow:1,endRow:4});
  assert.equal(insert[0].kind,'row.add');assert.equal(insert[0].count,4);
  const remove=gridRowChanges(data,'sheet','sheet.command.remove-row-by-range',{startRow:1,endRow:1});
  assert.equal(remove[0].row,block.rowIds[0]);
  assert.throws(()=>gridRowChanges(data,'sheet','sheet.command.remove-row-by-range',{startRow:0,endRow:0}),/bloque completo/);
  assert.deepEqual(gridRowChanges(data,'sheet','sheet.command.remove-row-by-range',{startRow:0,endRow:1}),[{kind:'block.remove',sheet:'sheet',block:block.id}]);
  assert.deepEqual(gridRowChanges(data,'sheet','sheet.command.remove-row-by-range',{startRow:0,endRow:2}),[{kind:'block.remove',sheet:'sheet',block:block.id}]);
  data.sheets.sheet.__bold.blocks.push({...block,id:'second',startRow:5});
  assert.deepEqual(gridRowChanges(data,'sheet','sheet.command.remove-row-by-range',{startRow:0,endRow:7}).map(change=>change.block),['second',block.id]);
});

test('cambios de orden interno y avisos de Drive no son una edición de cuadrícula',()=>{
  const before=document(),after=structuredClone(before);
  before.sheets.sheet.columnData={1:{w:200,hd:0}};
  after.sheets.sheet.columnData={1:{hd:0,w:200}};
  after.name='Archivo renombrado';
  after.synced_revision=20;
  assert.deepEqual(gridChanges(before,after),[]);
});

test('ignorar tamaños permite cambios de celdas; encabezados y columnas conservan la actualización estructural',()=>{
  const before=document(),after=structuredClone(before);
  after.sheets.sheet.rowData={1:{h:80}};
  after.sheets.sheet.columnData={2:{w:250}};
  after.sheets.sheet.cellData[1][1]={v:'Producto actualizado'};
  assert.equal(gridChanges(before,after)[0].kind,'grid');
  const incremental=gridChanges(before,after,{layout:false});
  assert.equal(incremental.length,1);
  assert.equal(incremental[0].kind,'cell');
  assert.equal(incremental[0].after.v,'Producto actualizado');
  const renamed=structuredClone(after);
  renamed.sheets.sheet.cellData[0][1]={v:'Encabezado actualizado'};
  assert.equal(gridChanges(before,renamed,{layout:false})[0].kind,'grid');
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
  assert.equal(rules[1].renderMode,2);
  assert.equal(rules[1].formula1,'["Samuel"]');
  assert.deepEqual(rules,JSON.parse(displayGrid(data,people).resources[0].data).sheet);
  const saved=normalizeSnapshot(visible,data,people);
  assert.deepEqual(JSON.parse(saved.resources[0].data).sheet,[native]);
  assert.equal(saved.sheets.sheet.cellData[1][1].v,'first');
  assert.deepEqual(gridChanges(data,saved),[]);
  visible.sheets.sheet.cellData[1][2].v=25;
  assert.equal(gridChanges(data,normalizeSnapshot(visible,data,people))[0].kind,'cell');
});

test('correcting a rejected assignee replaces the invalid draft and preserves other edits and conflict bases',()=>{
  const edit=(column,before,after)=>({kind:'cell',sheet:'sheet',block:'block',row:'row',column,before:{v:before},after:{v:after}});
  const original=edit('responsible','original','invalid');
  const note=edit('note','before','keep');
  const pending=[{id:'failed',revision:4,rejected:true,changes:[original,note]},{id:'later',revision:4,changes:[edit('responsible','invalid','also-invalid')]}];
  const repaired=repairRejectedDraft(pending,[edit('responsible','also-invalid','valid')]);
  assert.equal(repaired.revision,4);
  assert.deepEqual(repaired.changes,[{...original,after:{v:'valid'}},note]);
  assert.equal(pending[0].changes[0].after.v,'invalid');
  assert.equal(repairRejectedDraft([{...pending[0],rejected:false}],[]),null,'uncertain network outcomes must retain their original request identity');
  assert.equal(repairRejectedDraft(pending,[{kind:'block.remove'}]),null);
});

test('correcting a rejected grid retains its original base and all later cell edits',()=>{
  const base=document(),snapshot=structuredClone(base);
  snapshot.sheets.sheet.cellData[1][1].v='invalid';
  snapshot.sheets.sheet.cellData[1][2].v=47;
  const pending=[{revision:3,rejected:true,changes:[{kind:'grid',baseDocument:base,document:snapshot}]}];
  const correction={kind:'cell',sheet:'sheet',block:'block',row:'row',column:'product',before:{v:'invalid'},after:{v:'valid'}};
  const repaired=repairRejectedDraft(pending,[correction]);
  assert.deepEqual(repaired.changes[0].baseDocument,base);
  assert.equal(repaired.changes[0].document.sheets.sheet.cellData[1][1].v,'valid');
  assert.equal(repaired.changes[0].document.sheets.sheet.cellData[1][2].v,47);
});

test('all block selectors use the same chip appearance without changing their selection type', () => {
  for (const [type,validation] of [['responsible','list'],['collaborators','listMultiple'],['dropdown','list'],['checkbox','checkbox']]) {
    const data=document(),block=data.sheets.sheet.__bold.blocks[0];
    block.columns[0]={id:'selector',type,options:[{value:'low',label:'Baja'}]};
    const visible=displayGrid(data,[{id:'person',employee:'employee',name:'Samuel'}]);
    const rule=JSON.parse(visible.resources.find(item=>item.name==='SHEET_DATA_VALIDATION_PLUGIN').data).sheet.find(item=>item.uid==='bold-validation-block-selector');
    assert.equal(rule.type,validation);
    assert.equal(rule.renderMode,type==='checkbox'?undefined:2);
    if(type!=='checkbox') assert.equal(rule.showDropDown,true);
  }
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


test('las fechas de Excel usan validación nativa y conservan la regla original al guardar', () => {
  const data=document();
  data.sheets.sheet.__bold.blocks=[];
  const rule={uid:'excel-date',type:'custom',allowBlank:true,formula1:'OR(NOT(ISERROR(DATEVALUE(B2))), AND(ISNUMBER(B2), LEFT(CELL("format", B2))="D"))',ranges:[{startRow:1,endRow:3,startColumn:1,endColumn:1}]};
  data.resources=[{name:'SHEET_DATA_VALIDATION_PLUGIN',data:JSON.stringify({sheet:[rule]})}];
  const visible=displayGrid(data,[]), resource=visible.resources.find(item=>item.name==='SHEET_DATA_VALIDATION_PLUGIN');
  const shown=JSON.parse(resource.data).sheet[0];
  assert.equal(shown.type,'date');
  assert.equal(shown.formula1,undefined);
  assert.deepEqual(shown.ranges,rule.ranges);
  assert.deepEqual(visible.sheets.sheet.cellData,data.sheets.sheet.cellData);
  const saved=normalizeSnapshot(visible,data);
  assert.deepEqual(JSON.parse(saved.resources.find(item=>item.name===resource.name).data).sheet,[rule]);
  assert.deepEqual(gridChanges(data,saved),[]);
  shown.ranges[0].endRow=4;
  resource.data=JSON.stringify({sheet:[shown]});
  assert.equal(JSON.parse(normalizeSnapshot(visible,data).resources.find(item=>item.name===resource.name).data).sheet[0].ranges[0].endRow,4);
});

test('otras fórmulas personalizadas se ejecutan con igual sin convertirlas en reglas de fecha', () => {
  const data=document(); data.sheets.sheet.__bold.blocks=[];
  const rules=['B2>0','=B2<100','OR(NOT(ISERROR(DATEVALUE(B2))), AND(ISNUMBER(C2), LEFT(CELL("format", B2))="D"))'].map((formula1,index)=>({uid:String(index),type:'custom',formula1,ranges:[{startRow:1,endRow:2,startColumn:1,endColumn:1}]}));
  data.resources=[{name:'SHEET_DATA_VALIDATION_PLUGIN',data:JSON.stringify({sheet:rules})}];
  const visible=displayGrid(data,[]), displayed=JSON.parse(visible.resources.find(item=>item.name==='SHEET_DATA_VALIDATION_PLUGIN').data).sheet;
  assert.deepEqual(displayed.map(rule=>rule.type),['custom','custom','custom']);
  assert.deepEqual(displayed.map(rule=>rule.formula1),rules.map(rule=>'='+rule.formula1.replace(/^=/,'')));
  assert.deepEqual(JSON.parse(normalizeSnapshot(visible,data).resources.find(item=>item.name==='SHEET_DATA_VALIDATION_PLUGIN').data).sheet,rules);
});


test('task rows keep valid responsible profiles from different departments after connection',()=>{
  const data=document(),block=data.sheets.sheet.__bold.blocks[0];
  block.type='tasks';block.columns[0]={id:'responsible',type:'responsible'};
  block.task={enabled:true,unit:'marketing',status_map:{}};
  const people=[{id:'samuel',employee:'one',unit:'marketing',name:'Samuel'},{id:'david',employee:'two',unit:'operations',name:'David Urbina'}];
  data.sheets.sheet.cellData[1][1].v='david';
  const visible=displayGrid(data,people);
  assert.equal(visible.sheets.sheet.cellData[1][1].v,'David Urbina');
  const rules=JSON.parse(visible.resources.find(resource=>resource.name==='SHEET_DATA_VALIDATION_PLUGIN').data).sheet;
  assert.ok(rules.some(rule=>rule.formula1?.includes('David Urbina')));
  const saved=normalizeSnapshot(visible,data,people);
  assert.equal(saved.sheets.sheet.cellData[1][1].v,'david');
  visible.sheets.sheet.cellData[1][1].v='Samuel';
  assert.equal(normalizeSnapshot(visible,data,people).sheets.sheet.cellData[1][1].v,'samuel');
});


test('managed delivery dates have native calendars without persisting generated rules',()=>{
  const data=document(),block=data.sheets.sheet.__bold.blocks[0];
  block.columns[0]={id:'due_date',name:'Entrega',type:'date'};
  data.sheets.sheet.cellData[1][1]={v:'2026-10-20',t:2};
  const visible=displayGrid(data,[]);
  const rule=JSON.parse(visible.resources.find(item=>item.name==='SHEET_DATA_VALIDATION_PLUGIN').data).sheet.find(rule=>rule.uid==='bold-validation-block-due_date');
  assert.equal(rule.type,'date');assert.equal(rule.showDropDown,true);
  assert.equal(rule.formula1,undefined);
  assert.equal(visible.sheets.sheet.cellData[1][1].v,(Date.UTC(2026,9,20)-Date.UTC(1899,11,30))/86400000);
  assert.equal(visible.sheets.sheet.cellData[1][1].t,2);
  assert.equal(visible.sheets.sheet.cellData[1][1].s.n.pattern,'yyyy-mm-dd');
  visible.sheets.sheet.cellData[1][1].v=46315;
  const saved=normalizeSnapshot(visible,data,[]);
  assert.match(saved.sheets.sheet.cellData[1][1].v,/^2026-\d{2}-\d{2}$/);
  assert.equal(saved.sheets.sheet.cellData[1][1].t,1);
  assert.deepEqual(gridChanges(saved,normalizeSnapshot(displayGrid(saved,[]),saved,[])),[]);
  visible.sheets.sheet.cellData[1][1].v=NaN;
  assert.throws(()=>normalizeSnapshot(visible,data,[]),/fecha válida/);
  assert.deepEqual(JSON.parse(saved.resources.find(item=>item.name==='SHEET_DATA_VALIDATION_PLUGIN').data).sheet,[]);
});
