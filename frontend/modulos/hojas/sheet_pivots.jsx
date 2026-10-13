import {useState} from 'react';
import {SheetDialog} from './sheets_dialogs.jsx';
import {pivotSummary} from './sheet_pivots.js';

const letters=index=>{let value=index+1,result='';while(value>0){result=String.fromCharCode(65+(value-1)%26)+result;value=Math.floor((value-1)/26);}return result;};
export function SheetPivotDialog({api,onClose}) {
  const selection=api.getSelection(), snapshot=api.getContent(), source=selection?.range, sheet=snapshot?.sheets[selection?.sheetId];
  const headers=source && sheet?Array.from({length:source.endColumn-source.startColumn+1},(_,index)=>String(sheet.cellData?.[source.startRow]?.[source.startColumn+index]?.v || '')):[];
  const [group,setGroup]=useState(0),[value,setValue]=useState(Math.min(1,headers.length-1)),[aggregation,setAggregation]=useState('sum');
  const [anchor,setAnchor]=useState(source?letters(Math.min(498,source.endColumn+2))+(source.startRow+1):'D1'),[error,setError]=useState('');
  const insert=()=>{
    try {
      if(api.getDocumentMode()!=='editing') throw Error('Este archivo está en modo lector.');
      if(!source || !sheet || source.endRow<=source.startRow) throw Error('Selecciona encabezados y filas de datos.');
      const current=api.getContent(), rows=pivotSummary(current.sheets[sheet.id],source,group,value,aggregation);
      const cell=anchor.trim().toUpperCase().match(/^([A-Z]+)(\d+)$/);
      if(!cell) throw Error('Escribe una celda de destino, por ejemplo D1.');
      const row=Number(cell[2])-1,column=[...cell[1]].reduce((sum,item)=>sum*26+item.charCodeAt(0)-64,0)-1;
      if(row<0 || row+rows.length>20000 || column<0 || column+2>500) throw Error('La tabla excede los límites de la hoja.');
      for(let index=0;index<rows.length;index++) for(let offset=0;offset<2;offset++) if(current.sheets[sheet.id].cellData?.[row+index]?.[column+offset]?.v!=null) throw Error('El destino contiene datos. Elige un espacio vacío.');
      const workbook=api.univer.getActiveWorkbook(), worksheet=workbook.getSheetBySheetId(sheet.id);
      worksheet.getRange(row,column,rows.length,2).setValues(rows);
      const next=api.getContent(), name='__casual_sheets_pivots__', saved=next.resources?.find(item=>item.name===name);
      const pivots=saved?JSON.parse(saved.data).pivots:[];
      pivots.push({id:crypto.randomUUID(),sourceSheetId:sheet.id,source,targetSheetId:sheet.id,target:{row,column},rows:[{column:group}],cols:[],values:[{column:value,agg:aggregation}],filters:[],lastOutputExtent:{rows:rows.length,cols:2}});
      next.resources=[...(next.resources || []).filter(item=>item.name!==name),{name,data:JSON.stringify({v:1,pivots})}];
      api.setContent(next); onClose();
    } catch(problem) {setError(problem.message);}
  };
  return <SheetDialog title="Insertar tabla dinámica" close={onClose}>
    <p>Selecciona una tabla con encabezados. Se inserta en un espacio vacío de esta hoja; puedes organizar hojas desde las pestañas de BOLD.</p>
    <label>Agrupar por<select value={group} onChange={event=>setGroup(Number(event.target.value))}>{headers.map((label,index)=><option key={index} value={index}>{label || 'Sin encabezado'}</option>)}</select></label>
    <label>Columna que quieres resumir<select value={value} onChange={event=>setValue(Number(event.target.value))}>{headers.map((label,index)=><option key={index} value={index}>{label || 'Sin encabezado'}</option>)}</select></label>
    <label>Qué quieres calcular<select value={aggregation} onChange={event=>setAggregation(event.target.value)}>{Object.entries({sum:'Sumar cantidades',count:'Contar elementos',average:'Calcular promedio',min:'Valor más bajo',max:'Valor más alto'}).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
    <label>Celda de destino<input value={anchor} onChange={event=>setAnchor(event.target.value)} /></label>
    {error && <p role="alert">{error}</p>}
    <footer><button onClick={onClose}>Cancelar</button><button className="sheets_primary" onClick={insert}>Crear resumen</button></footer>
  </SheetDialog>;
}
