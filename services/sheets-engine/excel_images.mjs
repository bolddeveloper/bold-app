import { createHash } from 'node:crypto';

export function importImages(book,document) {
  const drawings = {};
  for (const source of book.worksheets) {
    const sheet = Object.values(document.sheets).find(item=>item.name===source.name);
    if (!sheet) continue;
    const data = {}, order = [];
    for (const image of source.getImages()) {
      const file = book.getImage(image.imageId);
      if (!file || !['png','jpeg','jpg','gif'].includes(file.extension)) continue;
      const base64 = file.base64 || Buffer.from(file.buffer).toString('base64');
      const id = 'image-' + createHash('sha256').update(sheet.id+image.imageId).digest('hex').slice(0,24);
      const at = anchor => ({column:anchor.nativeCol,columnOffset:anchor.nativeColOff/9525,row:anchor.nativeRow,rowOffset:anchor.nativeRowOff/9525});
      const from = at(image.range.tl), to = image.range.br ? at(image.range.br) : {...from,columnOffset:from.columnOffset+(image.range.ext?.width || 300),rowOffset:from.rowOffset+(image.range.ext?.height || 200)};
      const sheetTransform = {from,to};
      data[id] = {drawingId:id,unitId:document.id,subUnitId:sheet.id,drawingType:0,imageSourceType:'BASE64',source:base64.startsWith('data:')?base64:`data:image/${file.extension};base64,${base64}`,sheetTransform,axisAlignSheetTransform:sheetTransform,anchorType:image.range.editAs==='absolute'?'2':image.range.editAs==='twoCell'?'1':'0'};
      order.push(id);
    }
    if (order.length) drawings[sheet.id] = {data,order};
  }
  document.resources = [...(document.resources || []).filter(item=>item.name!=='SHEET_DRAWING_PLUGIN')];
  if (Object.keys(drawings).length) document.resources.push({name:'SHEET_DRAWING_PLUGIN',data:JSON.stringify(drawings)});
}
export function exportImages(book,worksheet,document,sheetId) {
  const resource = document.resources?.find(item=>item.name==='SHEET_DRAWING_PLUGIN');
  if (!resource) return;
  const sheet = JSON.parse(resource.data)[sheetId];
  for (const id of sheet?.order || []) {
    const image = sheet.data[id];
    if (image?.drawingType!==0) continue;
    const match = image.source?.match(/^data:image\/(png|jpeg|jpg|gif);base64,([\da-z+/=\r\n]+)$/i);
    if (!match || match[2].length>10_000_000) throw Error('La imagen necesita una copia local PNG, JPEG o GIF para exportar.');
    const position = image.sheetTransform;
    const anchor = value => {
      if (!value || !Number.isInteger(value.column) || !Number.isInteger(value.row) || value.column<0 || value.column>=500 || value.row<0 || value.row>=20000 || !Number.isFinite(value.columnOffset) || !Number.isFinite(value.rowOffset)) throw Error('Posición de imagen inválida.');
      return {nativeCol:value.column,nativeColOff:Math.round(value.columnOffset*9525),nativeRow:value.row,nativeRowOff:Math.round(value.rowOffset*9525)};
    };
    const imageId = book.addImage({base64:image.source,extension:match[1].toLowerCase()==='jpg'?'jpeg':match[1].toLowerCase()});
    worksheet.addImage(imageId,{tl:anchor(position.from),br:anchor(position.to),editAs:image.anchorType==='2'?'absolute':image.anchorType==='1'?'twoCell':'oneCell'});
  }
}
