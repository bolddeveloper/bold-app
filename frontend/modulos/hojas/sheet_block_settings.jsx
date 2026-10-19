import {useState} from 'react';
import {ChevronDown, Plus, Trash2, X} from 'lucide-react';
import {SheetDialog} from './sheets_dialogs.jsx';
import {clone, columnTypes, requiredBlockColumn, taskColumns} from './sheets_model.js';

const hints={text:'Nombres, detalles o notas.',number:'Cantidades que puedes sumar.',currency:'Importes con moneda.',date:'Una fecha del calendario.',responsible:'Una persona del equipo. Recibe la tarea de esta fila.',collaborators:'Varias personas que comparten la misma tarea.',dropdown:'Opciones con nombre y color.',checkbox:'Marcar o desmarcar.',file:'Enlaces, archivos y descripción.',formula:'Un cálculo. Empieza con =.'};
const money=['USD','HNL','GTQ','MXN','EUR'];

export function BlockConfiguration({sheet,block,directory,close,save,canAssign}) {
  const [draft,setDraft]=useState(()=>clone(block)),[error,setError]=useState('');
  const costs=['costs','comparison'].includes(draft.type),tasks=draft.task.enabled || draft.type==='tasks';
  const statuses=directory.statuses.filter(status=>draft.type==='tasks' || !status.unit || status.unit===draft.task.unit);
  const change=(key,value)=>setDraft(old=>({...old,[key]:value}));
  const columnChange=(id,data)=>setDraft(old=>({...old,columns:old.columns.map(column=>column.id===id?{...column,...data}:column)}));
  function submit(event) {
    event.preventDefault();
    if (!draft.title.trim() || draft.columns.some(column=>!column.name.trim())) return setError('Pon un nombre al bloque y a cada columna.');
    if (new Set(draft.columns.map(column=>column.name.trim().toLocaleLowerCase())).size!==draft.columns.length) return setError('Cada columna necesita un nombre diferente.');
    if (draft.columns.some(column=>column.type==='dropdown' && (!column.options?.length || column.options.some(option=>!option.label.trim())))) return setError('Añade al menos una opción con nombre a cada lista.');
    if (draft.type!=='tasks' && draft.task.enabled && (!draft.task.unit || draft.columns.find(column=>column.id==='status')?.options?.some(option=>!draft.task.status_map[option.value]))) return setError('En «Crear tareas», elige departamento y relaciona cada estado.');
    const configuration=Object.fromEntries(['title','columns','currency','tax','discount','task','conversion'].map(key=>[key,draft[key] ?? (key==='conversion'?{}:draft[key])]));
    save({kind:'block.configure',sheet:sheet.id,block:block.id,configuration});
    close();
  }
  return <SheetDialog title="Ajustes del bloque" close={close} wide><form className="sheets_block_settings" onSubmit={submit}>
    <label>Nombre del bloque<input value={draft.title} maxLength={160} onChange={event=>change('title',event.target.value)} /></label>
    {costs && <section className="sheets_settings_section"><h3>Precios y totales</h3><label>Moneda<select value={draft.currency} onChange={event=>change('currency',event.target.value)}>{money.map(currency=><option key={currency}>{currency}</option>)}</select></label>
      <details className="sheets_settings_advanced"><summary>Descuento, impuesto y conversión<ChevronDown size={16}/></summary><div className="sheets_fields">
        <label>Descuento (%)<input type="number" min={0} max={100} step="any" value={draft.discount} onChange={event=>change('discount',Number(event.target.value))}/></label>
        <label>Impuesto (%)<input type="number" min={0} max={100} step="any" value={draft.tax} onChange={event=>change('tax',Number(event.target.value))}/></label>
      </div><p>Se aplican al subtotal. Las cantidades de cada producto siguen iguales.</p><div className="sheets_fields">
        <label>Convertir el total a<select value={draft.conversion?.currency || ''} onChange={event=>change('conversion',event.target.value?{currency:event.target.value,rate:draft.conversion?.rate || 1}:{})}><option value="">Mantener moneda</option>{money.map(currency=><option key={currency}>{currency}</option>)}</select></label>
        {draft.conversion?.currency && <label>1 {draft.currency} equivale a<input type="number" min="0.000001" step="any" value={draft.conversion.rate} onChange={event=>change('conversion',{...draft.conversion,rate:Number(event.target.value)})}/><small>{draft.conversion.currency}</small></label>}
      </div></details></section>}
    <section className="sheets_settings_section"><header><div><h3>Columnas de tu tabla</h3><p>Abre una columna para cambiar su nombre, contenido u opciones.</p></div><span>{draft.columns.length} columnas</span></header>
      <div className="sheets_settings_columns">{draft.columns.map((column,index)=>{
        const required=requiredBlockColumn(draft,column);
        return <details key={column.id} className="sheets_settings_column"><summary><span className="sheets_settings_number">{index+1}</span><strong>{column.name || 'Sin nombre'}</strong><span className="sheets_settings_type">{column.type==='dropdown'?'Lista de opciones':columnTypes[column.type]}</span>{required && <small>Necesaria</small>}<ChevronDown size={16}/></summary>
          <div className="sheets_settings_column_body"><div className="sheets_fields"><label>Nombre de columna<input value={column.name} maxLength={160} onChange={event=>columnChange(column.id,{name:event.target.value})}/></label>
            <label>Qué contiene<select value={column.type} disabled={required} onChange={event=>columnChange(column.id,{type:event.target.value,...(event.target.value==='dropdown' && !column.options?.length?{options:[{value:crypto.randomUUID(),label:'Opción 1',color:'#8a96a8'}]}:{})})}>{Object.entries(columnTypes).map(([id,label])=><option key={id} value={id}>{id==='dropdown'?'Lista de opciones':label}</option>)}</select></label></div>
            <p>{hints[column.type]}{required && ' Este campo mantiene los cálculos o la conexión con tareas.'}</p>
            {column.type==='dropdown' && <div className="sheets_settings_options"><h4>Opciones de la lista</h4>{(column.options || []).map(option=><div key={option.value}>
              <input aria-label="Nombre de opción" placeholder="Nombre de opción" maxLength={160} value={option.label} onChange={event=>columnChange(column.id,{options:column.options.map(item=>item.value===option.value?{...item,label:event.target.value}:item)})}/>
              <label className="sheets_option_color"><span>Color</span><input type="color" aria-label={`Color de ${option.label || 'opción'}`} value={option.color || '#8a96a8'} onChange={event=>columnChange(column.id,{options:column.options.map(item=>item.value===option.value?{...item,color:event.target.value}:item)})}/></label>
              <button type="button" aria-label={`Quitar opción ${option.label}`} onClick={()=>columnChange(column.id,{options:column.options.filter(item=>item.value!==option.value)})}><X size={16}/></button>
            </div>)}<button type="button" disabled={column.options?.length>=100} onClick={()=>columnChange(column.id,{options:[...(column.options || []),{value:crypto.randomUUID(),label:'Nueva opción',color:'#8a96a8'}]})}><Plus size={16}/>Añadir opción</button></div>}
            {!required && <button type="button" className="sheets_remove_column" disabled={draft.columns.length===1} onClick={()=>change('columns',draft.columns.filter(item=>item.id!==column.id))}><Trash2 size={16}/>Quitar columna</button>}
          </div></details>;
      })}</div><button type="button" disabled={draft.columns.length>=100} onClick={()=>change('columns',[...draft.columns,{id:crypto.randomUUID(),name:'Nueva columna',type:'text'}])}><Plus size={16}/>Añadir columna</button>
    </section>
    <fieldset className="sheets_settings_tasks" disabled={!canAssign}><legend>Crear tareas</legend>
      {draft.type==='tasks'?<p>Una fila con nombre de tarea y una persona asignada crea una tarea compartida. Responsable y colaboradores la ven en Mis tareas.</p>:<label className="sheets_check"><input type="checkbox" checked={!!draft.task.enabled} onChange={event=>{
        const enabled=event.target.checked;
        setDraft(old=>({...old,task:{...old.task,enabled},columns:enabled?[...old.columns,...clone(taskColumns.filter(column=>!old.columns.some(existing=>existing.id===column.id)))]:old.columns}));
      }}/>Crear tareas al asignar personas</label>}
      {tasks && draft.type==='tasks' && <p>Cada fila usa el departamento de su responsable. Sin responsable, usa el del primer colaborador.</p>}
      {tasks && <>{draft.type!=='tasks' && <label>Departamento<select value={draft.task.unit || ''} onChange={event=>change('task',{...draft.task,unit:event.target.value,status_map:{}})}><option value="">Elige departamento</option>{directory.units.map(unit=><option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>}
        {draft.type!=='tasks' && !draft.task.unit && !draft.task.enabled && <p>El departamento y los estados se eligen al asignar la primera persona.</p>}
        {(draft.type==='tasks' || draft.task.enabled || draft.task.unit) && <details className="sheets_settings_advanced" open={draft.task.enabled || undefined}><summary>Relacionar estados<ChevronDown size={16}/></summary><p>Elige qué estado tendrá la tarea al cambiar esta lista. En bloques Tareas se usa su equivalente por categoría en el departamento de cada fila.</p>{draft.columns.find(column=>column.id==='status')?.options?.map(option=><label key={option.value} className="sheets_status_mapping"><span><i style={{background:option.color}}/>{option.label}</span><select value={draft.task.status_map[option.value] || ''} onChange={event=>change('task',{...draft.task,status_map:{...draft.task.status_map,[option.value]:event.target.value}})}><option value="">{draft.type==='tasks' || !draft.task.enabled?'Automático':'Elige estado'}</option>{statuses.map(status=><option key={status.id} value={status.id}>{status.name}</option>)}</select></label>)}</details>}
      </>}
    </fieldset>
    {!canAssign && <p>Necesitas permiso para cambiar la conexión con tareas.</p>}
    <small>Quitar una fila envía su tarea a la papelera.</small>{error && <p className="sheets_error" role="alert">{error}</p>}
    <footer><button type="button" onClick={close}>Cancelar</button><button type="submit" className="sheets_primary">Guardar ajustes</button></footer>
  </form></SheetDialog>;
}
