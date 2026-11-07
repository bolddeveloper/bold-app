import {useEffect,useRef,useState} from 'react';
import {AtSign,Search,X} from 'lucide-react';
import {useDialog} from '../core/shared/use_dialog.js';
import {channelApi} from './channel_api.js';
import {messagingApi} from './messaging_api.js';
import {pageApi} from './page_api.js';
import './mentions.css';

export default function MentionPicker({channelId,conversationId,pageId,onSelect,onClose,onDenied}){
    const [query,setQuery]=useState(''),[rows,setRows]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[searched,setSearched]=useState(false),[refine,setRefine]=useState(false);
    const active=useRef(false),request=useRef(null),field=useRef(null);
    useDialog(true,'.slack_mention_picker',onClose);
    useEffect(()=>{active.current=true;field.current?.focus();return()=>{active.current=false;request.current?.abort();};},[]);
    async function search(event){
        event.preventDefault();if(query.trim().length<2 || busy)return;
        request.current?.abort();const controller=new AbortController();request.current=controller;
        setBusy(true);setError('');setRows([]);setRefine(false);setSearched(true);
        try{const options={signal:controller.signal},term=query.trim();
            const page=await (conversationId ? messagingApi.mentionPeople(conversationId,term,options) : pageId ? pageApi.mentionPeople(channelId,pageId,term,options):channelApi.mentionPeople(channelId,term,options));
            if(active.current && !controller.signal.aborted){setRows([...page.results,...(page.references || []).map(row=>({...row,referenceOnly:true}))]);setRefine(page.refine);}
        }catch(err){if(active.current && !controller.signal.aborted){if([401,403,404].includes(err.status))onDenied(err);else{const detail=err.fields?.detail;setError(err.status===400 && typeof detail==='string' && detail.length<=500 ? detail:err.status===429 ? 'Espera un momento antes de volver a buscar personas.':'No se pudo buscar personas. Conservamos tu borrador; vuelve a intentarlo.');}}}
        finally{if(active.current && !controller.signal.aborted)setBusy(false);}
    }
    return <div className="slack_editor_scrim slack_mention_scrim"><section role="dialog" aria-modal="true" aria-labelledby="slack_mention_title" className="slack_editor slack_mention_picker">
        <header><h2 id="slack_mention_title">Mencionar</h2><button type="button" aria-label="Cerrar selector de menciones" onClick={onClose}><X size={20} aria-hidden="true"/></button></header>
        <p>{conversationId ? 'Solo los dos participantes de este chat. Se conserva el aviso normal del mensaje, sin duplicarlo.':`Busca en todos los departamentos. Solo las personas con acceso ${pageId ? 'a la página' : 'al canal'} pueden recibir avisos. Las demás quedan como referencias en el texto.`}</p>
        <form className="slack_task_search" onSubmit={search} aria-busy={busy}><label>Buscar persona para mencionar<input ref={field} type="search" required minLength={2} maxLength={80} value={query} onChange={event=>setQuery(event.target.value)} autoComplete="off"/></label><button type="submit" disabled={busy || query.trim().length<2}><Search size={18} aria-hidden="true"/>Buscar personas</button></form>
        {busy && <p role="status">Buscando personas…</p>}{error && <p role="alert" className="slack_error">{error}</p>}
        <ul className="slack_task_results" aria-label="Menciones disponibles">{rows.map(person=><li key={person.employee_id}><button type="button" disabled={busy} onClick={()=>onSelect(person)}><AtSign size={18} aria-hidden="true"/><span><strong>{person.name}</strong><small>{person.is_bot ? 'Asistente IA':person.email}{person.referenceOnly && ' · Solo referencia'}</small></span></button></li>)}</ul>
        {searched && !busy && !error && !rows.length && <p role="status">No se encontraron personas que coincidan.</p>}
        {refine && <p role="status">Hay más coincidencias. Escribe más del nombre o del correo para encontrar a la persona.</p>}
    </section></div>;
}
