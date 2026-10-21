import {useEffect, useRef, useState} from "react";
import {LockKeyhole, X} from "lucide-react";
import {channelApi, channelError} from "./channel_api.js";
import {useDialog} from "../core/shared/use_dialog.js";

export function ChannelAccessFields({unit, channelId, visibility, members, onVisibility, onMembers, disabled=false}) {
    const [query,setQuery]=useState(""),[people,setPeople]=useState([]),[error,setError]=useState(""),[loading,setLoading]=useState(false);
    useEffect(()=>{
        const controller=new AbortController();setPeople([]);setError("");setLoading(true);
        const timer=setTimeout(()=>channelApi.people(channelId ? {channel:channelId,q:query} : {unit:unit || "",q:query},{signal:controller.signal})
            .then(page=>{if(!controller.signal.aborted)setPeople(page.results);})
            .catch(err=>{if(!controller.signal.aborted)setError(channelError(err));})
            .finally(()=>{if(!controller.signal.aborted)setLoading(false);}),250);
        return()=>{clearTimeout(timer);controller.abort();};
    },[channelId,unit,query]);
    return <fieldset className="slack_access_fields" disabled={disabled}>
        <legend>Privacidad y participación</legend>
        <label>Quién puede entrar<select value={visibility} onChange={event=>onVisibility(event.target.value)}>
            <option value="public">Todos los empleados</option>
            {unit && <option value="department">Departamento e invitados</option>}
            <option value="private">Solo personas invitadas</option>
        </select></label>
        <p className="slack_access_hint">{visibility==="private" ? "Ni el propietario ni los administradores pueden leer sin una invitación. Al crear, se incluye al creador como invitado." : visibility==="department" ? "Entra el departamento de la asignación activa y las personas añadidas. Las excepciones individuales prevalecen." : "Puede entrar cualquier empleado, salvo las restricciones individuales y del módulo Permisos."} El piloto sigue limitado a IT.</p>
        <label>Buscar persona<input type="search" autoComplete="off" value={query} onChange={event=>setQuery(event.target.value)} maxLength={80} placeholder="Nombre del empleado"/></label>
        <div className="slack_access_candidates" aria-label="Personas disponibles" aria-busy={loading}>
            {loading && <small role="status">Buscando personas…</small>}
            {!loading && people.filter(person=>!members.some(row=>row.employee_id===person.employee_id)).map(person=><button key={person.employee_id} type="button" disabled={members.length>=200} onClick={()=>{onMembers([...members,{...person,access:"write"}]);setQuery("");}}>Añadir a {person.name}</button>)}
            {!loading && !people.length && <small>No se encontraron personas activas.</small>}
        </div>
        {error && <p className="slack_error" role="alert">{error}</p>}
        <ul className="slack_access_members" aria-label="Excepciones e invitaciones">
            {members.map(person=><li key={person.employee_id}><span>{person.name || "Empleado"}</span><label><span className="slack_sr_only">Acceso de {person.name || "empleado"}</span><select value={person.access} onChange={event=>onMembers(members.map(row=>row.employee_id===person.employee_id ? {...row,access:event.target.value} : row))}><option value="write">Leer y participar</option><option value="read">Solo lectura</option><option value="blocked">Sin acceso</option></select></label><button type="button" aria-label={`Quitar excepción de ${person.name || "empleado"}`} onClick={()=>onMembers(members.filter(row=>row.employee_id!==person.employee_id))}><X size={18} aria-hidden="true"/></button></li>)}
        </ul>
        <small>Quitar una excepción restaura la regla general del canal; en un canal privado retira la invitación. «Sin acceso» siempre bloquea la lectura.</small>
    </fieldset>;
}

export default function ChannelAccessEditor({channel, onClose, onSaved}) {
    const [catalog,setCatalog]=useState([]),[next,setNext]=useState(null),[current,setCurrent]=useState(null);
    const [visibility,setVisibility]=useState("public"),[members,setMembers]=useState([]),[error,setError]=useState("");
    const [busy,setBusy]=useState(true),[saving,setSaving]=useState(false),active=useRef(true),request=useRef(null),writing=useRef(false);
    useDialog(true,".slack_editor",()=>{if(!writing.current)onClose();});
    async function open(row,signal) {
        const value=await channelApi.access(row.id,{signal});
        if(!signal.aborted && active.current){setCurrent(value);setVisibility(value.visibility);setMembers(value.members);}
    }
    useEffect(()=>{
        active.current=true;const controller=new AbortController();request.current=controller;
        (channel ? open(channel,controller.signal) : channelApi.managed(null,{signal:controller.signal}).then(page=>{if(!controller.signal.aborted){setCatalog(page.results);setNext(page.next);}}))
            .catch(err=>{if(!controller.signal.aborted)setError(channelError(err));}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});
        return()=>{active.current=false;controller.abort();request.current?.abort();};
    },[channel?.id]);
    async function choose(row) {setBusy(true);setError("");request.current?.abort();const controller=new AbortController();request.current=controller;try{await open(row,controller.signal);}catch(err){if(!controller.signal.aborted)setError(channelError(err));}finally{if(!controller.signal.aborted)setBusy(false);}}
    async function more(){setBusy(true);try{const page=await channelApi.managed(next,{signal:request.current.signal});if(active.current){setCatalog(rows=>[...rows,...page.results]);setNext(page.next);}}catch(err){if(active.current)setError(channelError(err));}finally{if(active.current)setBusy(false);}}
    async function save(event){event.preventDefault();if(writing.current)return;writing.current=true;setSaving(true);setError("");try{const result=await channelApi.setAccess(current.id,{visibility,members:members.map(({employee_id,access})=>({employee_id,access})),version:current.version},{signal:request.current.signal});if(active.current)onSaved(result);}catch(err){if(active.current && err.name!=="AbortError")setError(channelError(err));}finally{writing.current=false;if(active.current)setSaving(false);}}
    return <div className="slack_editor_scrim"><section role="dialog" aria-modal="true" aria-labelledby="slack_access_title" className="slack_editor slack_access_editor">
        <header><h2 id="slack_access_title"><LockKeyhole size={20} aria-hidden="true"/> {current ? `Acceso · #${current.name}` : "Administrar acceso"}</h2><button type="button" disabled={saving} onClick={onClose} aria-label="Cerrar permisos del canal"><X size={20} aria-hidden="true"/></button></header>
        <p>Administrar invitaciones no concede lectura de mensajes ni archivos. Los permisos de los responsables se configuran en Permisos → Slack.</p>
        {busy && <p role="status">Cargando configuración…</p>}
        {!current && <div className="slack_access_catalog">{catalog.map(row=><button type="button" disabled={busy} key={row.id} onClick={()=>choose(row)}># {row.name}<small>{row.department?.name || "Sin departamento"} · {row.visibility==="private" ? "Privado" : row.visibility==="department" ? "Departamental" : "Público"}</small></button>)}{!busy && !catalog.length && <p>No tienes canales cuyo acceso puedas administrar.</p>}{next && <button type="button" disabled={busy} onClick={more}>Cargar más canales</button>}</div>}
        {current && !busy && <form onSubmit={save} aria-busy={saving}><ChannelAccessFields channelId={current.id} unit={current.department?.id} visibility={visibility} members={members} onVisibility={setVisibility} onMembers={setMembers} disabled={saving}/><button type="submit" className="slack_primary" disabled={saving}>{saving ? "Guardando…" : "Guardar acceso"}</button>{error && <button type="button" disabled={saving} onClick={()=>choose(current)}>Recargar configuración</button>}</form>}
        {error && <p role="alert" className="slack_error">{error}</p>}
    </section></div>;
}
