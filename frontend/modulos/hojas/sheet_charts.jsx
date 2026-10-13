import { useId, useMemo, useState } from 'react';
import { SheetDialog } from './sheets_dialogs.jsx';
import {chartTypes, chartSelection} from './sheet_charts.js';

export function SheetChartDialog({api, onClose}) {
  const [selection] = useState(()=>api.getSelection()), [snapshot] = useState(()=>api.getContent());
  const [title, setTitle] = useState(''), [type, setType] = useState('column'), [error, setError] = useState('');
  const id=useId(), data=useMemo(()=>chartSelection(snapshot,selection,type),[snapshot,selection,type]);
  const insert = () => {
    try {
      if (api.getDocumentMode() !== 'editing') throw Error('Este archivo está en modo lector.');
      const source = selection?.range;
      const snapshot = api.getContent(), name = '__casual_sheets_charts__';
      const current=chartSelection(snapshot,selection,type);
      if (current.error) throw Error(current.error);
      const resource = snapshot.resources?.find(item => item.name === name);
      const charts = resource?.data ? JSON.parse(resource.data).charts : [];
      const startColumn = Math.min(source.endColumn + 2, 480), startRow = source.startRow;
      charts.push({id:crypto.randomUUID(), sheetId:selection.sheetId, source, type, title:title.trim(),
        pos:{startRow, endRow:Math.min(startRow + 14, 19999), startColumn, endColumn:startColumn + 8}});
      snapshot.resources = [...(snapshot.resources || []).filter(item => item.name !== name), {name, data:JSON.stringify({v:1, charts})}];
      api.setContent(snapshot);
      onClose();
    } catch (problem) {setError(problem.message);}
  };
  return <SheetDialog title="Crear gráfico" close={onClose}>
    <form className="sheets_chart_form" onSubmit={event=>{event.preventDefault(); if (!data.error) insert();}}>
      <p>Selecciona tus datos en la hoja y elige cómo mostrarlos. El gráfico se actualiza al cambiar esos datos.</p>
      {data.rangeLabel && <section className="sheets_chart_source" aria-label="Datos del gráfico"><strong>Datos elegidos</strong><span>{data.rangeLabel}</span><small>{data.rows} fila{data.rows===1?'':'s'} de datos · {data.columns} columnas</small>
        <div className="sheets_chart_preview"><table><caption>Vista previa: hasta 3 filas y 4 columnas</caption><thead><tr>{data.headers.map((header,index)=><th key={index} scope="col">{header}</th>)}</tr></thead><tbody>{data.preview.map((row,index)=><tr key={index}>{row.map((value,offset)=><td key={offset}>{String(value)}</td>)}</tr>)}</tbody></table></div>
      </section>}
      <label>Nombre del gráfico <small>Opcional</small><input value={title} placeholder="Ej.: Costos por producto" onChange={event => setTitle(event.target.value)} maxLength={255} /></label>
      <label>Cómo mostrar los datos<select value={type} aria-describedby={`${id}-hint`} onChange={event => {setType(event.target.value);setError('');}}>
        {chartTypes.map(group=><optgroup key={group.label} label={group.label}>{Object.entries(group.options).map(([value,label])=><option key={value} value={value}>{label}</option>)}</optgroup>)}
      </select></label>
      <p className="sheets_chart_hint" id={`${id}-hint`}>{data.hint || 'Cierra esta ventana, selecciona una tabla y vuelve a pulsar Gráfico.'}</p>
      {(error || data.error) && <p className="sheets_error" role="alert">{error || data.error}</p>}
      <footer><button type="button" onClick={onClose}>Cancelar</button><button type="submit" className="sheets_primary" disabled={!!data.error}>Crear gráfico</button></footer>
    </form>
  </SheetDialog>;
}
