// No network, Drive credentials or real workbooks. Runs during image build.
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {calculate, exportExcel, importExcel} from './codec.mjs';

const document = {id:'runtime-check',name:'Runtime check',appVersion:'1.0.3',locale:'esES',styles:{},sheetOrder:['sheet'],sheets:{sheet:{id:'sheet',name:'Check',rowCount:30,columnCount:10,defaultColumnWidth:100,defaultRowHeight:24,__bold:{blocks:[]},cellData:{0:{0:{v:'Item'},1:{v:'Total'}},1:{0:{v:'First'},1:{v:20}},2:{0:{v:'Second'},1:{v:30}},3:{1:{f:'=SUM(B2:B3)'}}}}},resources:[{name:'__casual_sheets_charts__',data:JSON.stringify({v:1,charts:[{id:'check-chart',sheetId:'sheet',type:'column',source:{startRow:0,endRow:2,startColumn:0,endColumn:1},pos:{startRow:0,endRow:12,startColumn:3,endColumn:8}}]})}]};
const calculated = await calculate(document);
assert.equal(calculated.sheets.sheet.cellData[3][1].v,50);
const {buffer} = await exportExcel(calculated,{recalculate:false});
const book = new ExcelJS.Workbook();await book.xlsx.load(buffer);
assert.equal(book.getWorksheet('Check').getCell('B4').value.result,50);
const zip = await JSZip.loadAsync(buffer);
assert.equal(zip.file(/^xl\/charts\/chart\d+\.xml$/).length,1);
const imported = await importExcel(buffer,{document:calculated,advanced:true});
assert.equal(imported.document.sheets.sheet.cellData[1][1].v,20);
console.log('Sheets runtime: formulas, XLSX round-trip and native chart OK.');
