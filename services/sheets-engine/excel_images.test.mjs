import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { importImages,exportImages } from './excel_images.mjs';
import { patchExcelPackage } from './excel_package.mjs';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6qoAAAAASUVORK5CYII=';
test('imágenes importadas conservan anclas y siguen siendo dibujos de Excel',async () => {
  const original = new ExcelJS.Workbook(), sheet = original.addWorksheet('Hoja');
  sheet.getCell('A1').value='Original';
  sheet.addImage(original.addImage({base64:png,extension:'png'}),{tl:{col:1,row:2},br:{col:4,row:8}});
  const source = await original.xlsx.writeBuffer();
  const document = {id:'book',sheets:{sheet:{id:'sheet',name:'Hoja',cellData:{0:{0:{v:'Editado'}}},__bold:{blocks:[],technicalColumn:false}}}};
  importImages(original,document);
  const image = Object.values(JSON.parse(document.resources[0].data).sheet.data)[0];
  assert.equal(image.sheetTransform.from.column,1);
  const fresh = new ExcelJS.Workbook(), output = fresh.addWorksheet('Hoja');
  output.getCell('A1').value='Editado';
  exportImages(fresh,output,document,'sheet');
  const clean = new ExcelJS.Workbook();clean.addWorksheet('Hoja');
  const generated = await fresh.xlsx.writeBuffer();
  for (let input of [source,await clean.xlsx.writeBuffer()]) for (let pass=0;pass<2;pass++) {
    input = await patchExcelPackage(input,generated,document);
    const loaded = new ExcelJS.Workbook(); await loaded.xlsx.load(input);
    assert.equal(loaded.getWorksheet('Hoja').getImages().length,1);
    assert.equal(loaded.getWorksheet('Hoja').getCell('A1').value,'Editado');
    const zip = await JSZip.loadAsync(input);
    assert.equal(zip.file(/^xl\/media\/bold[\da-f]+\.png$/).length,1);
    assert.equal(zip.file(/^xl\/drawings\/drawing\d+\.xml$/).length,1);
  }
});
test('posición o fuente externa inválida no se exporta ni descarga desde el servidor',()=>{
  const original=new ExcelJS.Workbook(), output=original.addWorksheet('Hoja');
  const document={resources:[{name:'SHEET_DRAWING_PLUGIN',data:JSON.stringify({sheet:{order:['image'],data:{image:{drawingType:0,source:'http://localhost/private.png'}}}})}]};
  assert.throws(()=>exportImages(original,output,document,'sheet'),/copia local/);
});
test('duplicar una hoja importada conserva ambas hojas aunque comparten sourceName',async()=>{
  const original=new ExcelJS.Workbook(); original.addWorksheet('Hoja').getCell('A1').value='Original';
  const fresh=new ExcelJS.Workbook(); fresh.addWorksheet('Hoja').getCell('A1').value='Original'; fresh.addWorksheet('Hoja 2').getCell('A1').value='Copia';
  const document={sheets:{first:{name:'Hoja',__bold:{sourceName:'Hoja'},cellData:{}},second:{name:'Hoja 2',__bold:{sourceName:'Hoja'},cellData:{}}}};
  const output=await patchExcelPackage(await original.xlsx.writeBuffer(),await fresh.xlsx.writeBuffer(),document);
  const restored=new ExcelJS.Workbook(); await restored.xlsx.load(output);
  assert.equal(restored.worksheets.length,2);
  assert.equal(restored.getWorksheet('Hoja').getCell('A1').value,'Original');
  assert.equal(restored.getWorksheet('Hoja 2').getCell('A1').value,'Copia');
});
