import {columnLetter, richSummary} from './sheets_model.js';

export const chartTypes = [
  {label:'Comparar cantidades', options:{column:'Columnas verticales', bar:'Barras horizontales'}},
  {label:'Ver cambios', options:{line:'Líneas', area:'Área'}},
  {label:'Partes de un total', options:{pie:'Circular', doughnut:'Anillo'}},
  {label:'Relacionar dos cantidades', options:{scatter:'Puntos (dispersión)'}},
  {label:'Opciones avanzadas', options:{'column-stacked':'Columnas apiladas', 'column-stacked-100':'Columnas al 100 %', 'bar-stacked':'Barras apiladas', 'bar-stacked-100':'Barras al 100 %', 'line-stacked':'Líneas apiladas', 'area-stacked':'Área apilada'}}
];

export function chartSelection(snapshot, selection, type='column') {
  const source=selection?.range, sheet=snapshot.sheets?.[selection?.sheetId];
  if (!sheet || !source || !['startRow','endRow','startColumn','endColumn'].every(key=>Number.isInteger(source[key])) || source.startRow<0 || source.startColumn<0 || source.endRow>=20000 || source.endColumn>=500 || source.endRow<=source.startRow || source.endColumn<=source.startColumn) return {error:'Selecciona los títulos de las columnas y al menos una fila de datos. Incluye una columna de nombres y otra de números.',headers:[],preview:[]};
  const headers=Array.from({length:Math.min(4,source.endColumn-source.startColumn+1)}, (_,index)=>{
    const value=richSummary(sheet.cellData?.[source.startRow]?.[source.startColumn+index]?.v);
    return value==null || value===''?'Columna '+columnLetter(source.startColumn+index+1):String(value);
  });
  const preview=Array.from({length:Math.min(3,source.endRow-source.startRow)}, (_,index)=>headers.map((_,offset)=>richSummary(sheet.cellData?.[source.startRow+index+1]?.[source.startColumn+offset]?.v) ?? ''));
  const numeric=value=>value!==null && value!==undefined && typeof value!=='boolean' && !(typeof value==='string' && !value.trim()) && Number.isFinite(Number(value));
  const partOfTotal=['pie','doughnut'].includes(type), scatter=type==='scatter';
  let numbers=false;
  for (const [row,cells] of Object.entries(sheet.cellData || {})) {
    if (+row<=source.startRow || +row>source.endRow) continue;
    if (scatter) numbers ||= numeric(cells[source.startColumn+1]?.v) && numeric(cells[source.startColumn+2]?.v);
    else numbers ||= Object.entries(cells).some(([col,item])=>+col>source.startColumn && +col<=source.endColumn && (!partOfTotal || +col===source.startColumn+1) && numeric(item?.v));
    if (numbers) break;
  }
  return {
    headers, preview, rows:source.endRow-source.startRow, columns:source.endColumn-source.startColumn+1,
    rangeLabel:`${sheet.name} · ${columnLetter(source.startColumn+1)}${source.startRow+1}:${columnLetter(source.endColumn+1)}${source.endRow+1}`,
    hint:scatter?'Primera columna: nombres. Segunda: números del eje horizontal. Tercera: números del eje vertical.':partOfTotal?'Usa los nombres de la primera columna y los números de la segunda. Las demás columnas no se incluyen.':'Primera columna: nombres. Las siguientes: cantidades que quieres comparar. La primera fila contiene los títulos.',
    error:scatter && source.endColumn-source.startColumn<2?'Para comparar dos cantidades, elige tres columnas: nombre, cantidad X y cantidad Y.':!numbers?'No hay números para este gráfico. Elige una columna con cantidades.':''
  };
}
