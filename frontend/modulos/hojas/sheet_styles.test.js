import test from 'node:test';
import assert from 'node:assert/strict';
import {textStyle, sameTextStyle, prepareTextStyles} from './sheet_styles.js';
import {displayGrid, normalizeSnapshot, gridChanges} from './sheets_model.js';

function workbook() {
  return {id:'book', styles:{}, sheetOrder:['procesos'], sheets:{procesos:{id:'procesos', name:'Procesos', __bold:{blocks:[],technicalColumn:false}, cellData:{0:{0:{v:'Tarea',s:{cl:{rgb:'#000000'},ul:1,st:0}}}}}}};
}

test('formatos antiguos se convierten sin modificar el archivo guardado ni posiciones de texto', () => {
  const saved = workbook();
  saved.sheets.procesos.cellData[0][0].p = {body:{textRuns:[{st:1,ed:5,ts:{ul:1}}]}};
  const visible = displayGrid(saved, []), cell = visible.sheets.procesos.cellData[0][0];
  assert.deepEqual(cell.s.ul, {s:1});
  assert.deepEqual(cell.s.st, {s:0});
  assert.equal(saved.sheets.procesos.cellData[0][0].s.ul, 1);
  assert.equal(cell.p.body.textRuns[0].st, 1);
  assert.deepEqual(cell.p.body.textRuns[0].ts.ul, {s:1});
  assert.deepEqual(textStyle({ul:{s:1,c:0,cl:{rgb:'#ff0000'}}}).ul, {s:1,c:0,cl:{rgb:'#ff0000'}});
});

test('editar un archivo antiguo conserva la base real y registra cambios de formato', () => {
  const saved = workbook(), visible = displayGrid(saved, []);
  visible.sheets.procesos.cellData[0][0].s.ul.cl = {rgb:'#000000'};
  assert.deepEqual(gridChanges(saved, normalizeSnapshot(visible, saved)), []);
  visible.sheets.procesos.cellData[0][0].v = 'Nueva tarea';
  let changes = gridChanges(saved, normalizeSnapshot(visible, saved));
  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0].before, saved.sheets.procesos.cellData[0][0]);
  visible.sheets.procesos.cellData[0][0].s.cl.rgb = '#ff0000';
  changes = gridChanges(saved, normalizeSnapshot(visible, saved));
  assert.equal(changes[0].after.s.cl.rgb, '#ff0000');
  assert.equal(sameTextStyle({ul:1}, {ul:{s:0}}), false);
});

test('también se normalizan estilos compartidos, tablas y reglas condicionales', () => {
  const doc = workbook(); doc.styles.link = {ul:1};
  doc.resources = [
    {name:'SHEET_RANGE_THEME_MODEL_PLUGIN', data:JSON.stringify({rangeThemeStyleMapJson:{table:{name:'table',headerRowStyle:{st:1}}}})},
    {name:'SHEET_CONDITIONAL_FORMATTING_PLUGIN', data:JSON.stringify({procesos:[{rule:{style:{ul:0}}}]})}
  ];
  prepareTextStyles(doc);
  assert.deepEqual(doc.styles.link.ul, {s:1});
  assert.deepEqual(JSON.parse(doc.resources[0].data).rangeThemeStyleMapJson.table.headerRowStyle.st, {s:1});
  assert.deepEqual(JSON.parse(doc.resources[1].data).procesos[0].rule.style.ul, {s:0});
});

test('las referencias guardadas mantienen su base y los estilos nuevos siguen disponibles', () => {
  const saved = workbook();
  saved.styles.link = saved.sheets.procesos.cellData[0][0].s;
  saved.sheets.procesos.cellData[0][0].s = 'link';
  const visible = displayGrid(saved, []);
  visible.styles.column = {bg:{rgb:'#ff0000'}};
  const idle = normalizeSnapshot(visible, saved);
  assert.equal(idle.sheets.procesos.cellData[0][0].s, 'link');
  assert.deepEqual(gridChanges(saved, idle), []);
  visible.sheets.procesos.cellData[0][0].v = 'Proceso editado';
  visible.sheets.procesos.columnData = {0:{s:'column'}};
  const edited = normalizeSnapshot(visible, saved);
  assert.equal(edited.sheets.procesos.cellData[0][0].s, 'link');
  assert.deepEqual(edited.styles.link, saved.styles.link);
  assert.deepEqual(edited.styles.column, {bg:{rgb:'#ff0000'}});
});

test('recursos vacíos de complementos permiten renderizar, redimensionar y guardar sin perder celdas', () => {
  const saved = workbook();
  saved.resources = [
    {name:'SHEET_CONDITIONAL_FORMATTING_PLUGIN',data:''},
    {name:'SHEET_RANGE_THEME_MODEL_PLUGIN',data:''},
    {name:'SHEET_DATA_VALIDATION_PLUGIN',data:''}
  ];
  const visible = displayGrid(saved, []);
  visible.sheets.procesos.columnData = {0:{w:200}};
  const resized = normalizeSnapshot(visible, saved);
  assert.equal(resized.sheets.procesos.cellData[0][0].v, 'Tarea');
  assert.equal(gridChanges(saved, resized)[0].kind, 'grid');
  assert.deepEqual(gridChanges(resized, structuredClone(resized)), []);
  assert.equal(saved.resources[0].data, '');
  assert.throws(() => prepareTextStyles({...saved,resources:[{name:'SHEET_CONDITIONAL_FORMATTING_PLUGIN',data:'{"broken":'}]}), SyntaxError);
});
