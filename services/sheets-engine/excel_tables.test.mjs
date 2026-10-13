import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { importExcel, exportExcel } from './codec.mjs';

async function fixture() {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Procesos');
  sheet.addTable({name:'Tabla',ref:'B2',headerRow:true,columns:[{name:'Área'},{name:'Tarea'},{name:'Responsable'}],rows:[['Diseño','Revisar campaña','Ana'],['IT','Revisar permisos','Luis']],style:{theme:'TableStyleMedium2',showRowStripes:true}});
  sheet.getColumn('C').width = 53.63;
  sheet.getColumn('B').width = 4.38;
  sheet.getRow(3).height = 36;
  sheet.getRow(4).outlineLevel = 1;
  sheet.getCell('C3').alignment = {wrapText:true};
  const zip = await JSZip.loadAsync(await book.xlsx.writeBuffer());
  const styles = await zip.file('xl/styles.xml').async('string');
  zip.file('xl/styles.xml', styles
    .replace(/<dxfs\b[^>]*\/>|<dxfs\b[^>]*>[\s\S]*?<\/dxfs>/, '<dxfs count="3"><dxf><fill><patternFill patternType="solid"><fgColor rgb="FF535FC1"/></patternFill></fill></dxf><dxf><fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/></patternFill></fill></dxf><dxf><fill><patternFill patternType="solid"><fgColor rgb="FFF6F8F9"/></patternFill></fill></dxf></dxfs>')
    .replace(/<tableStyles\b[^>]*\/>|<tableStyles\b[^>]*>[\s\S]*?<\/tableStyles>/, '<tableStyles count="1"><tableStyle name="Procesos-style" count="3"><tableStyleElement type="headerRow" dxfId="0"/><tableStyleElement type="firstRowStripe" dxfId="1"/><tableStyleElement type="secondRowStripe" dxfId="2"/></tableStyle></tableStyles>'));
  zip.file('xl/tables/table1.xml', (await zip.file('xl/tables/table1.xml').async('string')).replace('name="TableStyleMedium2"','name="Procesos-style"'));
  return zip.generateAsync({type:'nodebuffer'});
}
const empty = () => ({id:'book',name:'Agenda',appVersion:'1.0.3',locale:'enUS',styles:{},sheetOrder:[],sheets:{}});

test('native tables retain custom colors, banding, range, widths and row heights', async () => {
  const buffer = await fixture(), original = Buffer.from(buffer);
  const {document} = await importExcel(buffer,{document:empty(),newFile:true,advanced:true});
  const sheet = document.sheets[document.sheetOrder[0]];
  const tables = JSON.parse(document.resources.find(item => item.name === 'SHEET_TABLE_PLUGIN').data);
  const table = tables[sheet.id].tables[0];
  assert.deepEqual(table.range,{startRow:1,endRow:3,startColumn:1,endColumn:3});
  assert.equal(table.name,'Tabla');
  assert.equal(sheet.cellData[1][2].v,'Tarea');
  assert.equal(sheet.cellData[1][2].s.bg.rgb,'#535fc1');
  assert.equal(sheet.cellData[2][2].s.bg.rgb,'#ffffff');
  assert.equal(sheet.cellData[3][2].s.bg.rgb,'#f6f8f9');
  assert.equal(sheet.cellData[2][2].s.tb,3);
  assert.equal(sheet.columnData[2].w,53.63 * 7);
  assert.equal(sheet.rowData[2].h,48);
  const second = await importExcel(buffer,{document,advanced:true});
  assert.equal(JSON.parse(second.document.resources.find(item => item.name === 'SHEET_TABLE_PLUGIN').data)[sheet.id].tables[0].id,table.id);
  assert.deepEqual(buffer,original);
});

test('export retains narrow columns, outline levels and the source table definition', async () => {
  const buffer = await fixture();
  const {document} = await importExcel(buffer,{document:empty(),newFile:true,advanced:true});
  const exported = await exportExcel(document,{recalculate:false,source:buffer.toString('base64')});
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(exported.buffer);
  assert.equal(book.getWorksheet('Procesos').getColumn('B').width,4.38);
  assert.equal(book.getWorksheet('Procesos').getRow(4).outlineLevel,1);
  assert.equal(book.getWorksheet('Procesos').getTable('Tabla').table.style.theme,'Procesos-style');
});

test('table edits and repeated exports update the original definition without duplicates', async () => {
  const source = await fixture();
  const {document} = await importExcel(source,{document:empty(),newFile:true,advanced:true});
  const sheet = document.sheets[document.sheetOrder[0]];
  const resource = document.resources.find(item => item.name === 'SHEET_TABLE_PLUGIN'), data = JSON.parse(resource.data);
  const table = data[sheet.id].tables[0];
  table.range.endRow = 4;
  sheet.cellData[4] = {1:{v:'CM'},2:{v:'Nueva campaña'},3:{v:'Ana'}};
  resource.data = JSON.stringify(data);
  const first = await exportExcel(document,{recalculate:false,source:source.toString('base64')});
  const second = await exportExcel(document,{recalculate:false,source:first.buffer.toString('base64')});
  const zip = await JSZip.loadAsync(second.buffer);
  assert.equal(zip.file(/^xl\/tables\/.*\.xml$/).length,1);
  assert.match(await zip.file('xl/tables/table1.xml').async('string'),/ref="B2:D5"/);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(second.buffer);
  assert.equal(book.getWorksheet('Procesos').getCell('C5').value,'Nueva campaña');
});
