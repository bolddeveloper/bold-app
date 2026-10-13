import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { calculate, exportExcel, importExcel, shiftRows, recreateAgenda, changeSheet } from './codec.mjs';
import JSZip from 'jszip';
import {prepareBlockTables} from './excel_tables.mjs';

test('las listas con nombres internos precedidos de igual recuperan sus opciones', async () => {
  const source = workbook();
  source.sheets.sheet.__bold.blocks = [];
  const options = ['Pendiente', 'En proceso', 'Terminado'];
  source.resources = [{name:'SHEET_DATA_VALIDATION_PLUGIN',data:JSON.stringify({sheet:[{uid:'status',type:'list',formula1:JSON.stringify(options),allowBlank:true,ranges:[{startRow:1,endRow:1,startColumn:1,endColumn:1}]}]})}];
  const {buffer} = await exportExcel(source,{recalculate:false});
  const book = new ExcelJS.Workbook(); await book.xlsx.load(buffer);
  const cell = book.getWorksheet('Costos').getCell('B2');
  cell.dataValidation = {...cell.dataValidation,formulae:['='+cell.dataValidation.formulae[0].replace(/^=/,'')]};
  const imported = await importExcel(Buffer.from(await book.xlsx.writeBuffer()),{document:source});
  const rules = JSON.parse(imported.document.resources.find(resource=>resource.name==='SHEET_DATA_VALIDATION_PLUGIN').data);
  assert.deepEqual(JSON.parse(rules.sheet[0].formula1),options);
});

test('subrayado y tachado usan objetos en Univer y banderas correctas al exportar Excel', async () => {
  const source = workbook();
  source.sheets.sheet.__bold.blocks = [];
  source.sheets.sheet.cellData = {0:{0:{v:'Enlace',s:{cl:{rgb:'#000000'},st:{s:1},ul:{s:1,t:10}}},
    1:{v:'Sin líneas',s:{st:{s:0},ul:{s:0}}}, 2:{v:'Formato antiguo',s:{st:0,ul:1}}}};
  const {buffer} = await exportExcel(source, {recalculate:false});
  const excel = new ExcelJS.Workbook(); await excel.xlsx.load(buffer);
  const sheet = excel.getWorksheet('Costos');
  assert.equal(sheet.getCell('A1').font.strike, true);
  assert.equal(sheet.getCell('A1').font.underline, 'double');
  assert.equal(!!sheet.getCell('B1').font.strike, false);
  assert.equal(!!sheet.getCell('B1').font.underline, false);
  assert.equal(sheet.getCell('C1').font.underline, true);
  const imported = await importExcel(buffer, {document:source});
  assert.deepEqual(imported.document.sheets.sheet.cellData[0][0].s.ul, {s:1,t:10});
  assert.deepEqual(imported.document.sheets.sheet.cellData[0][1].s.st, {s:0});
});

test('los bloques exportan tablas con filtros y franjas, sin duplicarse al ampliar filas',async()=>{
  const source=workbook(),before=structuredClone(source);
  const first=await exportExcel(source,{recalculate:false});
  const book=new ExcelJS.Workbook();await book.xlsx.load(first.buffer);
  const table=book.getWorksheet('Costos').getTable('BOLD_'+blockId.replaceAll('-','_')).table;
  assert.equal(table.ref,'B1');assert.equal(table.style.showRowStripes,true);
  assert.ok(table.columns.every(column=>column.filterButton));
  assert.deepEqual(source,before);
  const block=source.sheets.sheet.__bold.blocks[0];
  block.rowIds.push('33333333-3333-4333-8333-333333333333');
  source.sheets.sheet.cellData[2]={0:{v:block.rowIds[1]},1:{v:'Segundo producto'},2:{v:10},3:{v:2},4:{f:'=C3*D3'}};
  const second=await exportExcel(source,{recalculate:false,source:first.buffer.toString('base64')});
  const zip=await JSZip.loadAsync(second.buffer),tables=zip.file(/^xl\/tables\/.*\.xml$/);
  assert.equal(tables.length,1);
  assert.match(await tables[0].async('string'),/ref="B1:E3"/);
});

test('las tablas de bloques respetan tablas importadas y conservan tamaños manuales',async()=>{
  const source=workbook();
  const imported={id:'imported',name:'TablaOriginal',range:{startRow:0,endRow:1,startColumn:1,endColumn:4},options:{tableStyleId:'table-default-2'},columns:source.sheets.sheet.__bold.blocks[0].columns.map(column=>({id:column.id,displayName:column.name})),meta:{excelStyleName:'TableStyleMedium4'}};
  source.resources=[{name:'SHEET_TABLE_PLUGIN',data:JSON.stringify({sheet:{tables:[imported],tableFilteredOutRows:[]}})}];
  prepareBlockTables(source);
  assert.deepEqual(JSON.parse(source.resources[0].data).sheet.tables,[imported]);
  source.sheets.sheet.cellData[1][1]={v:'Producto con descripción larga que ocupa varias líneas',s:{tb:3}};
  source.sheets.sheet.columnData[1]={w:70};
  source.sheets.sheet.rowData={1:{ia:1},2:{h:80,ia:0}};
  const {buffer}=await exportExcel(source,{recalculate:false});
  const book=new ExcelJS.Workbook();await book.xlsx.load(buffer);
  assert.ok(book.getWorksheet('Costos').getRow(2).height>21);
  assert.equal(book.getWorksheet('Costos').getRow(3).height,60);
  assert.equal(book.getWorksheet('Costos').getTable('TablaOriginal').table.ref,'B1');
});

test('añadir un bloque al Excel existente permite volver a leer sus tablas y recalcular sin duplicarlas',async()=>{
  const source=workbook(),empty=structuredClone(source);
  empty.sheets.sheet.__bold.blocks=[];
  const original=await exportExcel(empty,{recalculate:false});
  const added=await exportExcel(source,{recalculate:false,source:original.buffer.toString('base64')});
  const book=new ExcelJS.Workbook();await book.xlsx.load(added.buffer);
  assert.equal(book.getWorksheet('Costos').getTable('BOLD_'+blockId.replaceAll('-','_')).table.ref,'B1');
  const imported=await importExcel(added.buffer,{document:source,advanced:true});
  assert.equal(imported.issues.length,0);
  const calculated=await calculate(imported.document);
  assert.equal(calculated.sheets.sheet.cellData[1][4].v,91);
  const repeated=await exportExcel(source,{recalculate:false,source:added.buffer.toString('base64')});
  const zip=await JSZip.loadAsync(repeated.buffer);
  assert.equal(zip.file(/^xl\/tables\/.*\.xml$/).length,1);
});

test('añadir una hoja a un Excel existente conserva su lectura y las hojas anteriores',async()=>{
  const source=workbook(),original=await exportExcel(source,{recalculate:false});
  const added=changeSheet(source,{action:'add',name:'Resumen'});
  const id=added.sheetOrder.at(-1);
  added.sheets[id].cellData={0:{0:{v:'Nuevo resumen'}}};
  const updated=await exportExcel(added,{recalculate:false,source:original.buffer.toString('base64')});
  const book=new ExcelJS.Workbook();await book.xlsx.load(updated.buffer);
  assert.equal(book.getWorksheet('Resumen').getCell('A1').value,'Nuevo resumen');
  assert.equal(book.getWorksheet('Costos').getCell('B2').value,'Envato');
  const imported=await importExcel(updated.buffer,{document:added,advanced:true});
  assert.deepEqual(imported.document.sheetOrder,added.sheetOrder);
  assert.equal(imported.document.sheets[id].cellData[0][0].v,'Nuevo resumen');
});

test('cambiar una hoja de un archivo antiguo no envía decoraciones numéricas al motor', async () => {
  const source = workbook(); source.sheets.sheet.__bold.blocks = [];
  source.sheets.sheet.cellData = {0:{0:{v:'Proceso',s:{cl:{rgb:'#000000'},st:1,ul:1}}}};
  const changed = changeSheet(source, {sheet:'sheet',action:'rename',name:'Procesos'});
  assert.equal(changed.sheets.sheet.name, 'Procesos');
  const style = changed.sheets.sheet.cellData[0][0].s;
  const resolved = typeof style === 'string' ? changed.styles[style] : style;
  assert.equal(resolved.ul.s, 1);
  assert.equal(source.sheets.sheet.cellData[0][0].s.ul, 1);
});

test('recursos de formato vacíos no bloquean cálculos ni exportación después de redimensionar', async () => {
  const source = workbook();
  source.resources = [{name:'SHEET_CONDITIONAL_FORMATTING_PLUGIN',data:''},{name:'SHEET_RANGE_THEME_MODEL_PLUGIN',data:''}];
  source.sheets.sheet.columnData = {2:{w:180}};
  const calculated = await calculate(source);
  assert.equal(calculated.sheets.sheet.cellData[1][4].v, 91);
  const {buffer} = await exportExcel(source);
  const excel = new ExcelJS.Workbook(); await excel.xlsx.load(buffer);
  assert.equal(excel.getWorksheet('Costos').getCell('E2').result, 91);
  assert.equal(source.resources[0].data, '');
});
const row = '11111111-1111-4111-8111-111111111111',
  blockId = '22222222-2222-4222-8222-222222222222';
function workbook() {
  return {
    id: 'native-book',
    name: 'Costos',
    locale: 'enUS',
    appVersion: '1.0.3',
    styles: {},
    sheetOrder: ['sheet'],
    sheets: {
      sheet: {
        id: 'sheet',
        name: 'Costos',
        rowCount: 100,
        columnCount: 10,
        cellData: {
          0: {
            0: {
              v: 'block:' + blockId
            },
            1: {
              v: 'Producto'
            },
            2: {
              v: 'Precio'
            },
            3: {
              v: 'Cantidad'
            },
            4: {
              v: 'Total'
            }
          },
          1: {
            0: {
              v: row
            },
            1: {
              v: 'Envato'
            },
            2: {
              v: 22.75
            },
            3: {
              v: 4
            },
            4: {
              f: '=C2*D2'
            }
          },
          2: {
            0: {
              v: 'subtotal:' + blockId
            },
            4: {
              f: '=SUM(E2:E2)'
            }
          }
        },
        columnData: {
          0: {
            hd: 1
          }
        },
        __bold: {
          blocks: [{
            id: blockId,
            type: 'costs',
            title: 'Licencias',
            currency: 'USD',
            startRow: 0,
            rowIds: [row],
            columns: [{
              id: 'product',
              name: 'Producto',
              type: 'text'
            }, {
              id: 'price',
              name: 'Precio',
              type: 'currency'
            }, {
              id: 'quantity',
              name: 'Cantidad',
              type: 'number'
            }, {
              id: 'total',
              name: 'Total',
              type: 'formula'
            }],
            task: {
              enabled: false
            }
          }]
        }
      }
    }
  };
}
test('the headless engine calculates costs and Excel retains formulas and hidden IDs', async () => {
  const source = workbook(),
    calculated = await calculate(source);
  assert.equal(calculated.sheets.sheet.cellData[1][4].v, 91);
  const {
    buffer
  } = await exportExcel(source, {
    links: [{
      row,
      task: 'fixed-task'
    }]
  });
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(buffer);
  assert.equal(book.getWorksheet('Costos').getCell('E2').value.formula, 'C2*D2');
  assert.equal(book.getWorksheet('__BOLD').state, 'veryHidden');
  assert.equal(book.getWorksheet('Costos').getColumn(1).hidden, true);
});
test('external edit preserves technical row ID and imports a diff', async () => {
  const source = workbook(),
    {
      buffer
    } = await exportExcel(source);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(buffer);
  book.getWorksheet('Costos').getCell('C2').value = 24;
  const imported = await importExcel(Buffer.from(await book.xlsx.writeBuffer()), {
    document: source
  });
  assert.equal(imported.document.sheets.sheet.__bold.blocks[0].rowIds[0], row);
  assert.equal(imported.document.sheets.sheet.cellData[1][2].v, 24);
  assert.equal(imported.issues.length, 0);
  assert.ok(imported.changes.some(change => change.after === 24));
});
test('a missing technical sheet is not silently imported', async () => {
  const source = workbook(),
    {
      buffer
    } = await exportExcel(source);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(buffer);
  book.removeWorksheet('__BOLD');
  await assert.rejects(importExcel(Buffer.from(await book.xlsx.writeBuffer()), {
    document: source
  }), /identificadores/);
});
test('row insertion updates formula references with the same engine', async () => {
  const source = workbook(),
    shifted = await shiftRows(source, {
      sheet: 'sheet',
      row: 1,
      count: 1
    });
  assert.equal(shifted.sheets.sheet.cellData[2][0].v, row);
  assert.match(shifted.sheets.sheet.cellData[2][4].f, /C3\*D3/);
});

// Preparadas; no ejecutar mientras siga vigente la indicación de no probar.
test('conditional rules and global named ranges survive Excel export and review',async()=>{
  const source=workbook();
  source.resources=[
    {name:'SHEET_CONDITIONAL_FORMATTING_PLUGIN',data:JSON.stringify({sheet:[{cfId:'rule',stopIfTrue:false,ranges:[{startRow:1,endRow:1,startColumn:2,endColumn:2}],rule:{type:'highlightCell',subType:'number',operator:'greaterThan',value:20,style:{bg:{rgb:'#ef3340'}}}}]})},
    {name:'SHEET_DEFINED_NAME_PLUGIN',data:JSON.stringify({price:{id:'price',name:'Price',formulaOrRefString:"='Costos'!$C$2"}})}
  ];
  const {buffer}=await exportExcel(source);
  const imported=await importExcel(buffer,{document:source});
  const rule=JSON.parse(imported.document.resources.find(item=>item.name==='SHEET_CONDITIONAL_FORMATTING_PLUGIN').data).sheet[0];
  assert.equal(rule.rule.value,20);assert.equal(rule.rule.style.bg.rgb.toLowerCase(),'#ef3340');
  assert.ok(imported.document.resources.some(item=>item.name==='SHEET_DEFINED_NAME_PLUGIN'));
});

test('el nombre interno de filtros no bloquea archivos antiguos ni se importa como una fórmula',async()=>{
  const source=workbook();
  source.resources=[{name:'SHEET_DEFINED_NAME_PLUGIN',data:JSON.stringify({filter:{id:'filter',name:'_xlnm._FilterDatabase',formulaOrRefString:'#REF!'},price:{id:'price',name:'Price',formulaOrRefString:"='Costos'!$C$2"}})}];
  const {buffer}=await exportExcel(source,{recalculate:false});
  const book=new ExcelJS.Workbook();await book.xlsx.load(buffer);
  assert.equal(book.getWorksheet('Costos').getCell('C2').value,22.75);
  book.definedNames.add("'Costos'!$B$1:$E$2",'_xlnm._FilterDatabase');
  const imported=await importExcel(Buffer.from(await book.xlsx.writeBuffer()),{document:source});
  const names=JSON.parse(imported.document.resources.find(item=>item.name==='SHEET_DEFINED_NAME_PLUGIN').data);
  assert.ok(Object.values(names).some(item=>item.name==='Price'));
  assert.ok(Object.values(names).every(item=>!item.name.includes('FilterDatabase')));
  assert.equal(source.resources[0].data.includes('#REF!'),true);
});

test('responsables y colaboradores exportan nombres aunque exista texto enriquecido con correo',async()=>{
  const source=workbook(),block=source.sheets.sheet.__bold.blocks[0];
  block.columns[0]={id:'responsible',name:'Responsable',type:'responsible'};
  block.columns[1]={id:'collaborators',name:'Colaboradores',type:'collaborators'};
  source.sheets.sheet.cellData[0][1].v='Responsable';source.sheets.sheet.cellData[0][2].v='Colaboradores';
  source.sheets.sheet.cellData[1][1]={v:'first',p:{body:{dataStream:'Samuel <samuel@bold.gt>\r\n'}}};
  source.sheets.sheet.cellData[1][2]={v:'first,second',p:{body:{dataStream:'Correos antiguos\r\n'}}};
  const directory=[{id:'first',name:'Samuel',employee:'one'},{id:'second',name:'Luis',employee:'two'}];
  const {buffer}=await exportExcel(source,{directory,recalculate:false});
  const book=new ExcelJS.Workbook();await book.xlsx.load(buffer);
  assert.equal(book.getWorksheet('Costos').getCell('B2').value,'Samuel');
  assert.equal(book.getWorksheet('Costos').getCell('C2').value,'Samuel, Luis');
  assert.equal(source.sheets.sheet.cellData[1][1].v,'first');
});

test('personas vacías sin valor original no generan cambios undefined al importar',async()=>{
  const source=workbook(),block=source.sheets.sheet.__bold.blocks[0];
  block.columns[0]={id:'responsible',name:'Responsable',type:'responsible'};
  block.columns[1]={id:'collaborators',name:'Colaboradores',type:'collaborators'};
  source.sheets.sheet.cellData[0][1].v='Responsable';source.sheets.sheet.cellData[0][2].v='Colaboradores';
  source.sheets.sheet.cellData[1][1]={s:{bl:0}};
  source.sheets.sheet.cellData[1][2]={};
  const before=structuredClone(source),{buffer}=await exportExcel(source,{recalculate:false});
  const imported=await importExcel(buffer,{document:source});
  assert.equal(imported.document.sheets.sheet.cellData[1][1].v,'');
  assert.equal(imported.document.sheets.sheet.cellData[1][2].v,'');
  assert.ok(imported.changes.every(change=>!['Responsable','Colaboradores'].includes(change.column)));
  assert.deepEqual(imported.issues,[]);
  assert.deepEqual(source,before);
});
test('renaming a sheet adjusts references from another tab',()=>{
  const source=workbook();source.sheetOrder.push('other');source.sheets.other={id:'other',name:'Resumen',rowCount:100,columnCount:10,cellData:{0:{1:{f:"='Costos'!E2"}}},__bold:{blocks:[]}};
  const renamed=changeSheet(source,{sheet:'sheet',action:'rename',name:'Licencias'});
  assert.match(renamed.sheets.other.cellData[0][1].f,/Licencias/);
});
test('recreation reads six layouts and clears responsible people without touching the original buffer',async()=>{
  const book=new ExcelJS.Workbook();
  for(const name of ['Liderazgo','Procesos','IT','Herramientas','Copia de Procesos','BoldLab'])book.addWorksheet(name);
  book.getWorksheet('IT').getCell('C3').value='Revisar permisos';book.getWorksheet('IT').getCell('F3').value='Histórico';
  const tools=book.getWorksheet('Herramientas');tools.getCell('B23').value='Licencia';tools.getCell('C23').value=5;tools.getCell('D23').value=4;tools.getCell('E23').value={formula:'C23*D23',result:20};
  const buffer=Buffer.from(await book.xlsx.writeBuffer()),before=Buffer.from(buffer);
  const content=await recreateAgenda(buffer);
  assert.deepEqual(buffer,before);assert.equal(content.tables.IT[0].title.v,'Revisar permisos');assert.equal(content.tables.IT[0].responsible.v,'');assert.equal(content.costs[0].quantity.v,4);
});
test('removing a sheet clears only its scoped resources and updates formula references',()=>{
  const source=workbook();
  source.sheetOrder.push('other');source.sheets.other={id:'other',name:'Resumen',rowCount:100,columnCount:10,cellData:{0:{1:{f:"='Costos'!E2"}}},__bold:{blocks:[]}};
  const range={startRow:1,endRow:1,startColumn:2,endColumn:2};
  const rule={cfId:'rule',ranges:[range],stopIfTrue:false,rule:{type:'highlightCell',subType:'number',operator:'greaterThan',value:20,style:{bg:{rgb:'#ef3340'}}}};
  source.resources=[
    {name:'SHEET_CONDITIONAL_FORMATTING_PLUGIN',data:JSON.stringify({sheet:[rule],other:[{...rule,cfId:'keep'}]})},
    {name:'SHEET_DATA_VALIDATION_PLUGIN',data:JSON.stringify({sheet:[{uid:'drop',type:'whole',operator:'greaterThan',formula1:'0',ranges:[range]}],other:[{uid:'keep',type:'whole',operator:'greaterThan',formula1:'0',ranges:[range]}]})},
    {name:'SHEET_FILTER_PLUGIN',data:JSON.stringify({sheet:{ref:range},other:{ref:range}})}
  ];
  const original=structuredClone(source),removed=changeSheet(source,{sheet:'sheet',action:'remove'});
  assert.deepEqual(source,original);assert.deepEqual(removed.sheetOrder,['other']);assert.equal(removed.sheets.sheet,undefined);
  for(const name of source.resources.map(resource=>resource.name)){
    const data=JSON.parse(removed.resources.find(resource=>resource.name===name).data);
    assert.equal(data.sheet,undefined);assert.ok(data.other);
  }
  assert.match(removed.sheets.other.cellData[0][1].f,/#REF!/);
});
test('data bars keep gradients, negative colors and hidden values on Excel export and import',async()=>{
  const source=workbook();
  source.resources=[{name:'SHEET_CONDITIONAL_FORMATTING_PLUGIN',data:JSON.stringify({sheet:[{cfId:'bar',stopIfTrue:false,ranges:[{startRow:1,endRow:1,startColumn:2,endColumn:2}],rule:{type:'dataBar',isShowValue:false,config:{min:{type:'min'},max:{type:'max'},isGradient:true,positiveColor:'#16b889',nativeColor:'#ef3340'}}}]})}];
  const {buffer}=await exportExcel(source,{recalculate:false});
  const imported=await importExcel(buffer,{document:source});
  const rule=JSON.parse(imported.document.resources.find(item=>item.name==='SHEET_CONDITIONAL_FORMATTING_PLUGIN').data).sheet[0].rule;
  assert.equal(rule.config.isGradient,true);assert.equal(rule.isShowValue,false);
  assert.equal(rule.config.nativeColor.toLowerCase(),'#ef3340');
});
test('date validations export actual Excel dates and return ISO bounds',async()=>{
  const source=workbook();
  source.resources=[{name:'SHEET_DATA_VALIDATION_PLUGIN',data:JSON.stringify({sheet:[{uid:'date',type:'date',operator:'between',formula1:'2026-01-01',formula2:'2026-12-31',ranges:[{startRow:5,endRow:5,startColumn:1,endColumn:1}]}]})}];
  const {buffer}=await exportExcel(source,{recalculate:false});
  const imported=await importExcel(buffer,{document:source});
  const rule=JSON.parse(imported.document.resources.find(item=>item.name==='SHEET_DATA_VALIDATION_PLUGIN').data).sheet.find(rule=>rule.type==='date');
  assert.equal(rule.formula1,'2026-01-01');assert.equal(rule.formula2,'2026-12-31');
});
test('unfrozen panes stay unfrozen after reviewing Drive',async()=>{
  const source=workbook();source.sheets.sheet.freeze={xSplit:0,ySplit:0,startRow:-1,startColumn:-1};
  const {buffer}=await exportExcel(source,{recalculate:false});
  const imported=await importExcel(buffer,{document:source});
  assert.equal(imported.document.sheets.sheet.freeze.xSplit,0);
  assert.equal(imported.document.sheets.sheet.freeze.ySplit,0);
});
test('a responsible person with a comma in the name imports as one person',async()=>{
  const source=workbook(),block=source.sheets.sheet.__bold.blocks[0];
  block.columns[0]={id:'responsible',name:'Responsable',type:'responsible'};
  source.sheets.sheet.cellData[0][1].v='Responsable';source.sheets.sheet.cellData[1][1].v='';
  const directory=[{id:'assignment',employee:'employee',name:'Apellido, Nombre',email:'person@bold.gt',unit:'department'}];
  const {buffer}=await exportExcel(source,{directory,recalculate:false});
  const book=new ExcelJS.Workbook();await book.xlsx.load(buffer);book.getWorksheet('Costos').getCell('B2').value='Apellido, Nombre';
  const imported=await importExcel(Buffer.from(await book.xlsx.writeBuffer()),{document:source,directory});
  assert.equal(imported.document.sheets.sheet.cellData[1][1].v,'assignment');assert.equal(imported.issues.length,0);
});
test('filter ranges and BOLD criteria survive export and import',async()=>{
  const source=workbook(),ref={startRow:0,endRow:1,startColumn:1,endColumn:4},filterColumns=[{colId:2,filters:{filters:['22.75']}}];
  source.resources=[{name:'SHEET_FILTER_PLUGIN',data:JSON.stringify({sheet:{ref,filterColumns}})}];
  const {buffer}=await exportExcel(source,{recalculate:false});
  const imported=await importExcel(buffer,{document:source});
  const saved=JSON.parse(imported.document.resources.find(item=>item.name==='SHEET_FILTER_PLUGIN').data).sheet;
  assert.deepEqual(saved.ref,ref);assert.deepEqual(saved.filterColumns,filterColumns);
});
test('Excel cell notes do not make a BOLD export incompatible with import',async()=>{
  const source=workbook(),block=source.sheets.sheet.__bold.blocks[0];
  block.columns[0]={id:'note',name:'Última nota',type:'text'};
  source.sheets.sheet.cellData[0][1].v='Última nota';source.sheets.sheet.cellData[1][1].v='Conservar esta nota';
  const {buffer}=await exportExcel(source,{recalculate:false});
  const imported=await importExcel(buffer,{document:source});
  assert.equal(imported.document.sheets.sheet.cellData[1][1].v,'Conservar esta nota');
});
test('editing only the Excel cell note produces a new BOLD note value',async()=>{
  const source=workbook(),block=source.sheets.sheet.__bold.blocks[0];
  block.columns[0]={id:'note',name:'Última nota',type:'text'};
  source.sheets.sheet.cellData[0][1].v='Última nota';source.sheets.sheet.cellData[1][1].v='Nota original';
  const {buffer}=await exportExcel(source,{recalculate:false});
  const book=new ExcelJS.Workbook();await book.xlsx.load(buffer);book.getWorksheet('Costos').getCell('B2').note='Nota cambiada en Excel';
  const imported=await importExcel(Buffer.from(await book.xlsx.writeBuffer()),{document:source});
  assert.equal(imported.document.sheets.sheet.cellData[1][1].v,'Nota cambiada en Excel');
});
test('rich file links export and import target changes without discarding images',async()=>{
  const source=workbook(),block=source.sheets.sheet.__bold.blocks[0];
  block.columns[0]={id:'description',name:'Archivo',type:'file'};
  source.sheets.sheet.cellData[0][1].v='Archivo';
  source.sheets.sheet.cellData[1][1].v='<!--bold-rich-text--><p><a href="https://example.com/old">Archivo</a><img src="https://example.com/image.png"></p>';
  const {buffer}=await exportExcel(source,{recalculate:false});
  const book=new ExcelJS.Workbook();await book.xlsx.load(buffer);
  const item=book.getWorksheet('Costos').getCell('B2');assert.equal(item.hyperlink,'https://example.com/old');
  item.value={text:item.text,hyperlink:'https://example.com/new?a=1&b=2'};
  const imported=await importExcel(Buffer.from(await book.xlsx.writeBuffer()),{document:source});
  const value=imported.document.sheets.sheet.cellData[1][1].v;
  assert.match(value,/href="https:\/\/example.com\/new\?a=1&amp;b=2"/);assert.match(value,/<img src=/);
});
