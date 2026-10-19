import { useId, useMemo, useState } from 'react';
import { SheetDialog } from './sheets_dialogs.jsx';
import {chartTypes, chartSelection} from './sheet_charts.js';
import {ChartExample} from '../core/sheets_chart_preview.jsx';

const chartOptions = chartTypes.flatMap(group => Object.entries(group.options));
const chartFamilies = {line:'Líneas', area:'Áreas', column:'Columnas', bar:'Barras', pie:'Circular', doughnut:'Anillo', scatter:'Dispersión'};

export function SheetChartDialog({api, onClose}) {
  const [selection] = useState(()=>api.getSelection()), [snapshot] = useState(()=>api.getContent());
  const [title, setTitle] = useState(''), [type, setType] = useState('column'), [error, setError] = useState(''), [tab, setTab] = useState('setup');
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
  return <SheetDialog title="Editor de gráficos" close={onClose}>
    <form className="sheets_chart_form" onSubmit={event=>{event.preventDefault(); if (!data.error) insert();}}>
      <nav className="sheets_chart_tabs" aria-label="Opciones del gráfico">
        <button type="button" aria-pressed={tab==='setup'} aria-controls={`${id}-setup`} onClick={()=>setTab('setup')}>Configuración</button>
        <button type="button" aria-pressed={tab==='customize'} aria-controls={`${id}-customize`} onClick={()=>setTab('customize')}>Personalizar</button>
      </nav>
      <div className="sheets_chart_body">
        <section id={`${id}-setup`} hidden={tab!=='setup'} aria-label="Configuración">
          <label id={`${id}-type`}>Tipo de gráfico</label>
          <details className="sheets_chart_picker">
            <summary aria-labelledby={`${id}-type ${id}-selected`}><ChartExample type={type}/><span id={`${id}-selected`}>{chartOptions.find(([value])=>value===type)?.[1]}</span></summary>
            <div className="sheets_chart_choices" aria-describedby={`${id}-hint`}>
              {Object.entries(chartFamilies).map(([family,label])=><fieldset key={family} className="sheets_chart_group"><legend>{label}</legend><div className="sheets_chart_cards">{chartOptions.filter(([value])=>value.split('-')[0]===family).map(([value,label])=><button key={value} type="button" title={label} aria-label={label} aria-pressed={type===value} onClick={event=>{
                setType(value); setError('');
                const picker=event.currentTarget.closest('details');
                picker.open=false; picker.querySelector('summary').focus();
              }}><ChartExample type={value}/><span>{label}</span></button>)}</div></fieldset>)}
            </div>
          </details>
          <section className="sheets_chart_source" aria-label="Datos del gráfico">
            <h3>Intervalo de datos</h3><div className="sheets_chart_range">{data.rangeLabel || 'Sin intervalo seleccionado'}</div>
            {data.rangeLabel && <><small>{data.rows} filas de datos · {data.columns} columnas</small>
              <h3>{['pie','doughnut','scatter'].includes(type)?'Etiquetas':'Eje X'}</h3><div className="sheets_chart_axis">{data.headers[0]}</div>
              <h3>{type==='scatter'?'Valores X / Y':'Series'}</h3><div className="sheets_chart_series">{data.headers.slice(1,['pie','doughnut'].includes(type)?2:type==='scatter'?3:undefined).map((header,index)=><span key={index}>{header}</span>)}{data.columns>4 && !['pie','doughnut','scatter'].includes(type) && <small>y {data.columns-4} más</small>}</div>
              <p>La primera fila contiene los encabezados. La primera columna contiene las etiquetas.</p>
              <details className="sheets_chart_data"><summary>Vista previa de datos</summary><div className="sheets_chart_preview"><table><caption>Hasta 3 filas y 4 columnas</caption><thead><tr>{data.headers.map((header,index)=><th key={index} scope="col">{header}</th>)}</tr></thead><tbody>{data.preview.map((row,index)=><tr key={index}>{row.map((value,offset)=><td key={offset}>{String(value)}</td>)}</tr>)}</tbody></table></div></details>
            </>}
          </section>
          <p className="sheets_chart_hint" id={`${id}-hint`}>{data.hint || 'Cierra el editor y selecciona una tabla para crear tu gráfico.'}</p>
        </section>
        <section id={`${id}-customize`} hidden={tab!=='customize'} aria-label="Personalizar">
          <label>Nombre del gráfico <small>Opcional</small><input value={title} placeholder="Ej.: Costos por producto" onChange={event => setTitle(event.target.value)} maxLength={255} /></label>
          <section className="sheets_chart_example" aria-label="Ejemplo del tipo seleccionado"><ChartExample type={type}/><strong>{chartOptions.find(([value])=>value===type)?.[1]}</strong><p>Ejemplo ilustrativo. Tu gráfico usará los datos elegidos.</p></section>
        </section>
        {(error || data.error) && <p className="sheets_error" role="alert">{error || data.error}</p>}
      </div>
      <footer><button type="button" onClick={onClose}>Cancelar</button><button type="submit" className="sheets_primary" disabled={!!data.error}>Crear gráfico</button></footer>
    </form>
  </SheetDialog>;
}
