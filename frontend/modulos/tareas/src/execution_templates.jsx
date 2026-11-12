import {useState,useRef,useEffect} from 'react';
import {BoldSelect} from '../../core/shared/bold_select.jsx';
import {confirmBold} from '../../core/shared/bold_dialog.js';
import {executionApi} from './execution_api.js';
import {checkPhaseGraph} from './execution_data.js';

export default function ExecutionTemplates({items,people,definition,onUse,onReload,onError}){
    const [chosen,setChosen]=useState(''),[name,setName]=useState(''),[shared,setShared]=useState([]),[busy,setBusy]=useState(false),[query,setQuery]=useState('');
    const alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
    const selected=items.find(item=>item.id===chosen),canEdit=!selected||selected.can_manage;
    function select(id){const row=items.find(item=>item.id===id);setChosen(id);setName(row?.name||'');setShared(row?.shared_with||[]);}
    async function save(archive=false){if(busy)return;if(archive&&!await confirmBold(`¿Archivar la plantilla «${name}»? Los procesos que ya la utilizaron conservarán sus etapas.`))return;setBusy(true);try{await executionApi.saveTemplate({...(selected?{id:selected.id,version:selected.version}:{}),name,definition,shared_with:shared,...(archive?{archive:true}:{})});if(!alive.current)return;await onReload();if(alive.current)select('');}catch(error){if(alive.current)onError(error.status===409?'La plantilla cambió en otro dispositivo. Vuelve a seleccionarla antes de sustituirla.':error.message);}finally{if(alive.current)setBusy(false);}}
    return <details className="execution_templates"><summary>Plantillas de proceso</summary><label>Plantilla guardada<BoldSelect label="Plantilla de etapas" value={chosen} options={[{value:'',label:'Crear plantilla nueva'},...items.map(item=>({value:item.id,label:`${item.name}${item.can_manage?'':' · Compartida'}`}))]} onValueChange={select}/></label>
        {selected&&<button type="button" disabled={busy} onClick={()=>onUse(selected.definition)}>Usar esta plantilla en la preparación</button>}
        {canEdit?<><label>Nombre de la plantilla<input maxLength={120} value={name} onChange={event=>setName(event.target.value)}/></label><details><summary>Compartir con {shared.length} personas</summary><label>Buscar persona<input type="search" value={query} onChange={event=>setQuery(event.target.value)}/></label><div className="execution_checklist">{people.filter(person=>person.name.toLocaleLowerCase('es').includes(query.toLocaleLowerCase('es'))).slice(0,100).map(person=><label key={person.id}><input type="checkbox" checked={shared.includes(person.id)} onChange={event=>setShared(old=>event.target.checked?[...old,person.id]:old.filter(id=>id!==person.id))}/><span>{person.name}<small>{person.unit_name}</small></span></label>)}</div></details><p>Se guarda la preparación actual, sin estados, historial ni acceso a la tarea original.</p><div className="execution_edit_actions"><button type="button" disabled={busy||!name.trim()||!!checkPhaseGraph(definition)} onClick={()=>save()}>{selected?'Actualizar plantilla con estas etapas':'Guardar plantilla'}</button>{selected&&<button type="button" disabled={busy} onClick={()=>save(true)}>Archivar plantilla</button>}</div></>:<p>Esta plantilla es compartida. Puedes utilizarla sin modificar la original.</p>}
    </details>;
}
