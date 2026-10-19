import test from 'node:test';
import assert from 'node:assert/strict';
import { finishSheetEdit, executeSheetCommand, applyRemoteSheetCells, applyManagedValidations, applyRemoteSheetLayout } from './sheet_editing.js';

test('leaving a cell confirms its typed draft without changing selection', () => {
  let value = '', editing = true;
  const draft = 'Texto con un clic', eventType = Symbol('PointerDown');
  const book = {isCellEditing: () => editing, getId: () => 'file'};
  const api = {syncExecuteCommand(id, params) {
    assert.equal(id, 'sheet.operation.set-cell-edit-visible');
    assert.deepEqual(params, {visible: false, unitId: 'file', eventType});
    assert.equal('keycode' in params, false);
    value = draft;
    editing = false;
    return true;
  }};
  finishSheetEdit(book, api, eventType);
  assert.equal(value, draft);
  assert.equal(editing, false);
});

test('los tamaños remotos reemplazan registros sin desmontar el editor ni tocar su historial',()=>{
  const before={sheetOrder:['sheet'],sheets:{sheet:{columnData:{1:{w:100,hd:1}},rowData:{2:{h:30}}}}};
  const after={sheetOrder:['sheet'],sheets:{sheet:{columnData:{1:{w:220}},rowData:{2:{h:30,ah:90}}}}};
  const model=structuredClone(before),calls=[];
  const api={syncExecuteCommand(id,params){calls.push(id);const key=id.endsWith('col-data')?'columnData':'rowData';for(const [index,value] of Object.entries(params[key])) if(value===null) delete model.sheets.sheet[key][index];else model.sheets.sheet[key][index]={...model.sheets.sheet[key][index],...value};return true;}};
  applyRemoteSheetLayout(api,'book',before,after);
  assert.deepEqual(calls,['sheet.mutation.set-col-data','sheet.mutation.set-col-data']);
  assert.deepEqual(model.sheets.sheet.columnData,{1:{w:220}});
  assert.deepEqual(model.sheets.sheet.rowData,{2:{h:30}});
  assert.throws(()=>applyRemoteSheetLayout({syncExecuteCommand:()=>false},'book',before,after),/siguen guardados/);
});

test('idle cells do not submit and rejected confirmation remains an error', () => {
  const book = {isCellEditing: () => false, getId: () => 'file'};
  finishSheetEdit(book, {syncExecuteCommand() {assert.fail('Idle cell must not submit');}}, 0);
  book.isCellEditing = () => true;
  assert.throws(() => finishSheetEdit(book, {syncExecuteCommand: () => false}, 0), /No se pudo confirmar/);
});

test('formato desde la barra confirma el texto; un comando fallido conserva ese texto y avisa', async () => {
  let saved = '', editing = true;
  const failures = [], book = {isCellEditing:() => editing, getId:() => 'file'};
  const api = {syncExecuteCommand() {saved = 'Proceso escrito'; editing = false; return true;}};
  const commands = {commit:() => finishSheetEdit(book, api, 0), onError:error => failures.push(error.message),
    execute:async (id, params) => {assert.equal(saved, 'Proceso escrito'); assert.equal(params.value, '#ff0000'); throw Error('Sin permiso para editar el formato');}};
  assert.equal(await executeSheetCommand(commands, 'sheet.command.set-background-color', {value:'#ff0000'}), false);
  assert.equal(saved, 'Proceso escrito');
  assert.deepEqual(failures, ['Sin permiso para editar el formato']);
  let executed = false;
  commands.commit = () => {throw Error('No se pudo confirmar la celda');};
  commands.execute = async () => {executed = true; return true;};
  assert.equal(await executeSheetCommand(commands, 'sheet.command.set-border-position', {value:'all'}), false);
  assert.equal(executed, false);
});

test('actualizar desde servidor reemplaza toda la celda sin registrar un comando de deshacer', () => {
  const model = {0:{0:{v:'Anterior',f:'=1',s:{bg:{rgb:'#ff0000'}}},1:{v:'Borrar'}}};
  const api = {syncExecuteCommand(id, params) {
    assert.equal(id, 'sheet.mutation.set-range-values');
    assert.equal(params.unitId, 'book'); assert.equal(params.subUnitId, 'sheet');
    for (const [row, cells] of Object.entries(params.cellValue)) for (const [col, value] of Object.entries(cells)) {
      if (value === null) delete model[row][col]; else model[row][col] = {...model[row][col], ...value};
    }
    return true;
  }};
  applyRemoteSheetCells(api, 'book', 'sheet', {0:{0:{v:'Cambio remoto'},1:null}});
  assert.deepEqual(model, {0:{0:{v:'Cambio remoto'}}});
  assert.throws(() => applyRemoteSheetCells({syncExecuteCommand:() => false}, 'book', 'sheet', {0:{0:{v:'Conservado'}}}), /siguen guardados/);
});

test('actualizar personas y opciones conserva el editor y su historial', () => {
  const managed={uid:'bold-validation-block-responsible',type:'list',formula1:'["Samuel"]',ranges:[{startRow:1,endRow:3,startColumn:1,endColumn:1}]};
  const native={uid:'native',type:'list',formula1:'["A"]',ranges:[{startRow:5,endRow:6,startColumn:1,endColumn:1}]};
  const resource = rules => [{name:'SHEET_DATA_VALIDATION_PLUGIN',data:JSON.stringify({sheet:rules})}];
  const calls=[], api={syncExecuteCommand(id,params) {calls.push({id,params}); return true;}};
  applyManagedValidations(api,'book',resource([native,managed]),resource([native,managed]));
  assert.equal(calls.length,0);
  const next={...managed,formula1:'["Samuel","Ana"]'};
  applyManagedValidations(api,'book',resource([native,managed]),resource([native,next]));
  assert.deepEqual(calls.map(call=>call.id),['data-validation.mutation.removeRule','data-validation.mutation.addRule']);
  assert.equal(calls[0].params.ruleId,managed.uid);
  assert.deepEqual(calls[1].params.rule,next);
  assert.ok(calls.every(call=>call.params.source==='patched'));
  assert.throws(()=>applyManagedValidations({syncExecuteCommand:()=>false},'book',resource([managed]),resource([next])),/siguen guardados/);
});

test('el historial real de Univer deshace texto y tamaño, conservando las celdas remotas', async () => {
  // Use Univer's Node entry point; its browser ESM build expects bundled opentype.js.
  const {createRequire} = await import('node:module');
  const require = createRequire(new URL('../core/package.json',import.meta.url));
  const {Univer, UniverInstanceType, LocaleType} = require('@univerjs/core');
  const {FUniver} = require('@univerjs/core/facade');
  const {UniverSheetsPlugin} = require('@univerjs/sheets');
  require('@univerjs/sheets/facade');
  const univer = new Univer({locale:LocaleType.EN_US,locales:{[LocaleType.EN_US]:require('@univerjs/sheets/locale/en-US')}});
  try {
    univer.registerPlugin(UniverSheetsPlugin);
    univer.createUnit(UniverInstanceType.UNIVER_SHEET, {id:'undo-file',sheetOrder:['sheet'],styles:{},
      sheets:{sheet:{id:'sheet',name:'Procesos',rowCount:20,columnCount:10,
        cellData:{0:{0:{v:'Original'}}},columnData:{0:{w:100}}}}});
    const api = FUniver.newAPI(univer), book = api.getActiveWorkbook(), sheet = book.getActiveSheet();
    sheet.getRange(0,0).setValue('Editado');
    sheet.setColumnWidth(0,200);
    applyRemoteSheetCells(api, book.getId(), 'sheet', {0:{1:{v:'Remoto'}}});
    book.undo(); assert.equal(book.save().sheets.sheet.columnData[0].w, 100);
    book.undo(); assert.equal(book.save().sheets.sheet.cellData[0][0].v, 'Original');
    assert.equal(book.save().sheets.sheet.cellData[0][1].v, 'Remoto');
    book.redo(); book.redo();
    assert.equal(book.save().sheets.sheet.cellData[0][0].v, 'Editado');
    assert.equal(book.save().sheets.sheet.columnData[0].w, 200);
  } finally {univer.dispose();}
});
