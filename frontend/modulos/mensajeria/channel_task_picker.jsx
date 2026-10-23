import {useEffect, useRef, useState} from "react";
import {CheckCheck, Search, X} from "lucide-react";
import {useDialog} from "../core/shared/use_dialog.js";
import {channelApi, channelError} from "./channel_api.js";

export default function ChannelTaskPicker({channelId,onSelect,onClose,purpose}) {
    const [query,setQuery]=useState(""),[searched,setSearched]=useState(""),[rows,setRows]=useState([]),[next,setNext]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState("");
    const active=useRef(false),request=useRef(null),field=useRef(null);
    useDialog(true,".slack_task_picker",onClose);
    useEffect(()=>{active.current=true;field.current?.focus();return()=>{active.current=false;request.current?.abort();};},[]);
    async function search(event,page=null) {
        event?.preventDefault();
        const term=page ? searched : query.trim();
        if (term.length<2 || term.length>120) return;
        request.current?.abort(); const controller=new AbortController();request.current=controller;
        setLoading(true);setError(""); if (!page) {setRows([]);setNext(null);setSearched(term);}
        try {
            const result=await channelApi.tasks(channelId,term,page,{signal:controller.signal},purpose);
            if (!active.current || controller.signal.aborted) return;
            setRows(current=>page ? [...new Map([...current,...result.results].map(row=>[row.id,row])).values()] : result.results);
            setNext(result.next);
        } catch(err) {if (active.current && !controller.signal.aborted) setError(channelError(err));}
        finally {if (active.current && !controller.signal.aborted) setLoading(false);}
    }
    return <div className="slack_editor_scrim"><section className="slack_editor slack_task_picker" role="dialog" aria-modal="true" aria-labelledby="slack_task_picker_title">
        <header><h2 id="slack_task_picker_title">{purpose==="page" ? "Añadir referencia a tarea":"Compartir una tarea"}</h2><button type="button" onClick={onClose} aria-label="Cerrar selector de tareas"><X size={20} aria-hidden="true"/></button></header>
        <p>Selecciona una tarea a la que tengas acceso. Compartirla aquí no concede permisos a los demás.</p>
        <form onSubmit={search} className="slack_task_search"><label>Buscar por título<input ref={field} type="search" maxLength={120} minLength={2} required value={query} onChange={event=>setQuery(event.target.value)} autoComplete="off"/></label><button type="submit" disabled={query.trim().length<2}><Search size={18} aria-hidden="true"/>Buscar</button></form>
        {loading && <p role="status">Buscando tareas autorizadas…</p>}
        {error && <p className="slack_error" role="alert">{error}</p>}
        <ul className="slack_task_results" aria-label="Tareas disponibles">{rows.map(task=><li key={task.id}><button type="button" disabled={loading} onClick={()=>onSelect(task)}><CheckCheck size={20} aria-hidden="true"/><span><strong>{task.title}</strong><small>{task.status}{task.completed ? " · Finalizada" : ""}</small></span></button></li>)}</ul>
        {searched && !loading && !error && !rows.length && <p role="status">No se encontraron tareas accesibles con ese título.</p>}
        {next && <button type="button" disabled={loading} onClick={()=>search(null,next)}>Más resultados</button>}
    </section></div>;
}
