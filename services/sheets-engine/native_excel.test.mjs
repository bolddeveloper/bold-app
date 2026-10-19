import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { addNativeObjects, clearNativeObjects } from './native_excel.mjs';
import { nativeChart, nativePivot } from './native_models.mjs';
import { importNativeCharts, importNativePivots } from './import_charts.mjs';

function document() {
  return {sheets:{sheet:{name:"Costos d'IT",cellData:{0:{0:{v:'Producto'},1:{v:'Total'}},1:{0:{v:'Licencias'},1:{v:20}},2:{0:{v:'Equipo'},1:{v:30}}}}},
    resources:[{name:'__casual_sheets_charts__',data:JSON.stringify({v:1,charts:[{id:'chart-one',sheetId:'sheet',type:'column',title:'Costos',source:{startRow:0,endRow:2,startColumn:0,endColumn:1},pos:{startRow:0,endRow:12,startColumn:3,endColumn:10}}]})},
      {name:'__casual_sheets_pivots__',data:JSON.stringify({v:1,pivots:[{id:'pivot-one',sourceSheetId:'sheet',source:{startRow:0,endRow:2,startColumn:0,endColumn:1},targetSheetId:'sheet',target:{row:15,column:0},rows:[{column:0}],cols:[],values:[{column:1,agg:'sum'}],lastOutputExtent:{rows:4,cols:2}}]})}]};
}
async function file() {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet("Costos d'IT");
  sheet.addRows([['Producto','Total'],['Licencias',20],['Equipo',30]]);
  return book.xlsx.writeBuffer();
}

test('eliminar un gráfico importado retira el objeto original y no reaparece al importar',async()=>{
  const value=document();value.resources=value.resources.filter(item=>item.name==='__casual_sheets_charts__');
  const zip=await JSZip.loadAsync(await addNativeObjects(await file(),value));
  zip.remove('bold/native-objects.json');
  const part=Object.keys(zip.files).find(name=>/^xl\/charts\/chart\d+\.xml$/.test(name));
  value.resources=[{name:'__casual_sheets_charts__',data:JSON.stringify({v:1,charts:[],deletedParts:[part]})}];
  const buffer=await addNativeObjects(await zip.generateAsync({type:'nodebuffer'}),value);
  const removed=await JSZip.loadAsync(buffer);
  assert.equal(removed.file(/^xl\/charts\/chart\d+\.xml$/).length,0);
  await importNativeCharts(buffer,value);
  assert.deepEqual(JSON.parse(value.resources.find(item=>item.name==='__casual_sheets_charts__').data).charts,[]);
});

test('el tamaño explícito de un gráfico no depende de las celdas que cruza al moverlo',()=>{
  const value=document(),model=JSON.parse(value.resources[0].data).charts[0];
  model.pos={...model.pos,width:625,height:375,offsetX:25,offsetY:7};
  const before=nativeChart(value,model,{Col:22}).charts[0];
  model.pos.endColumn++;
  const after=nativeChart(value,model,{Col:22}).charts[0];
  assert.deepEqual(after.Dimension,before.Dimension);
  assert.deepEqual(after.Dimension,{Width:625,Height:375});
  assert.equal(after.Format.OffsetX,25);assert.equal(after.Format.OffsetY,7);
  assert.equal(after.Legend.Position,'right');
  assert.deepEqual(after.Series[0].Fill.Color,['4285F4']);
  assert.throws(()=>nativeChart(value,{...model,pos:{...model.pos,width:-1}},{Col:22}),/Tamaño/);
});

test('guardar y releer un gráfico propio conserva dimensiones exactas y diseño sin crecer',async()=>{
  const value=document();value.resources=value.resources.filter(item=>item.name==='__casual_sheets_charts__');
  const data=JSON.parse(value.resources[0].data),model=data.charts[0];
  model.type='area-stacked';model.pos={...model.pos,width:625,height:375,offsetX:25,offsetY:7};
  model.format={legend:'right',palette:'pastel',showTitle:true};
  value.resources[0].data=JSON.stringify(data);
  let buffer=await file();
  for (let saved=0;saved<3;saved++) {
    buffer=await addNativeObjects(buffer,value);
    await importNativeCharts(buffer,value);
    const imported=JSON.parse(value.resources[0].data).charts[0];
    assert.deepEqual(imported.pos,model.pos);
    assert.deepEqual(imported.format,model.format);
    assert.equal(imported.type,model.type);
  }
});
test('gráficos referencian celdas y tablas dinámicas conservan agregación nativa', () => {
  const value = document(), chart = JSON.parse(value.resources[0].data).charts[0], pivot = JSON.parse(value.resources[1].data).pivots[0];
  const output = nativeChart(value,chart,{Col:22});
  assert.equal(output.charts[0].Series[0].Values,"'Costos d''IT'!$B$2:$B$3");
  assert.equal(nativePivot(value,pivot,{}).Data[0].Subtotal,'Sum');
  assert.throws(()=>nativePivot(value,{...pivot,values:[{column:1,agg:'distinctCount'}]},{}),/equivalente/);
});
test('exportación produce objetos nativos y sucesivos guardados no duplican gráficos ni tablas', async () => {
  const value = document(), first = await addNativeObjects(await file(),value), second = await addNativeObjects(first,value);
  for (const buffer of [first,second]) {
    const zip = await JSZip.loadAsync(buffer);
    assert.equal(Object.keys(zip.files).filter(name=>/^xl\/charts\/chart\d+\.xml$/.test(name)).length,1);
    assert.equal(Object.keys(zip.files).filter(name=>/^xl\/pivotTables\/pivotTable\d+\.xml$/.test(name)).length,1);
    const chart = Object.keys(zip.files).find(name=>/^xl\/charts\/chart\d+\.xml$/.test(name));
    assert.match(await zip.file(chart).async('string'),/barChart/);
    assert.match(await zip.file(chart).async('string'),/\$B\$2:\$B\$3/);
  }
});
test('quitar objetos generados conserva gráficos ajenos y valores editados', async () => {
  const rendered = await addNativeObjects(await file(),document()), zip = await JSZip.loadAsync(rendered);
  zip.file('xl/charts/chart999.xml','<foreign>Conservar</foreign>');
  const cleaned = await JSZip.loadAsync(await clearNativeObjects(await zip.generateAsync({type:'nodebuffer'})));
  assert.ok(cleaned.file('xl/charts/chart999.xml'));
  assert.equal(cleaned.file('xl/charts/chart1.xml'),null);
  assert.equal(cleaned.file('bold/native-objects.json'),null);
});

test('la limpieza de objetos admite tipos de contenido sin PartName',async()=>{
  const zip=new JSZip();
  zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/charts/chart1.xml" ContentType="application/chart"/></Types>');
  zip.file('bold/native-objects.json',JSON.stringify({parts:['xl/charts/chart1.xml']}));
  zip.file('xl/charts/chart1.xml','<chart/>');zip.file('xl/charts/chart999.xml','<foreign/>');
  const cleaned=await JSZip.loadAsync(await clearNativeObjects(await zip.generateAsync({type:'nodebuffer'})));
  assert.match(await cleaned.file('[Content_Types].xml').async('string'),/Default Extension="xml"/);
  assert.equal(cleaned.file('xl/charts/chart1.xml'),null);
  assert.ok(cleaned.file('xl/charts/chart999.xml'));
});
test('importar un gráfico externo conserva identidad y referencias de celdas', async () => {
  const value = document(), rendered = await addNativeObjects(await file(),value);
  await importNativeCharts(rendered,value);
  const chart = JSON.parse(value.resources.find(item=>item.name==='__casual_sheets_charts__').data).charts[0];
  assert.equal(chart.id,'chart-one');
  assert.equal(chart.source.endRow,2);
  assert.equal(chart.source.endColumn,1);
  assert.match(chart.excelPart,/xl\/charts\/chart\d+\.xml/);
});
test('importar una tabla dinámica conserva su identidad y configuración de suma', async () => {
  const value=document(), rendered=await addNativeObjects(await file(),value);
  await importNativePivots(rendered,value);
  const pivot=JSON.parse(value.resources.find(item=>item.name==='__casual_sheets_pivots__').data).pivots[0];
  assert.equal(pivot.id,'pivot-one');
  assert.equal(pivot.values[0].agg,'sum');
  assert.equal(pivot.target.row,15);
});
