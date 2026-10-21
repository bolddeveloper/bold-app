import {useEffect, useRef, useState} from "react";
import {LockKeyhole, X} from "lucide-react";
import {channelApi, channelError} from "./channel_api.js";
import {useDialog} from "../core/shared/use_dialog.js";
import ChannelAccessFields from "./channel_access_fields.jsx";
import {ChannelPicker} from "./channel_picker.jsx";
import {confirmBold} from "../core/shared/bold_dialog.js";

export {ChannelAccessFields};

export default function ChannelAccessEditor({channel, onClose, onSaved}) {
    const [catalog,setCatalog]=useState([]),[next,setNext]=useState(null),[current,setCurrent]=useState(null);
    const [visibility,setVisibility]=useState("public"),[members,setMembers]=useState([]),[error,setError]=useState("");
    const [inviting,setInviting]=useState(false);
    const [busy,setBusy]=useState(true),[saving,setSaving]=useState(false),active=useRef(true),request=useRef(null),writing=useRef(false);
    useDialog(true,".slack_editor",()=>{if(!writing.current && !inviting)onClose();});
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
    async function choose(row) {if(current && (visibility!==current.visibility || JSON.stringify(members)!==JSON.stringify(current.members)) && !await confirmBold("¿Cambiar de canal y descartar los cambios de acceso sin guardar?"))return;setBusy(true);setError("");request.current?.abort();const controller=new AbortController();request.current=controller;try{await open(row,controller.signal);}catch(err){if(!controller.signal.aborted)setError(channelError(err));}finally{if(!controller.signal.aborted)setBusy(false);}}
    async function more(){setBusy(true);try{const page=await channelApi.managed(next,{signal:request.current.signal});if(active.current){setCatalog(rows=>[...rows,...page.results]);setNext(page.next);}}catch(err){if(active.current)setError(channelError(err));}finally{if(active.current)setBusy(false);}}
    async function save(event){event.preventDefault();if(writing.current || inviting)return;writing.current=true;setSaving(true);setError("");try{const result=await channelApi.setAccess(current.id,{visibility,members:members.map(({employee_id,access})=>({employee_id,access})),version:current.version},{signal:request.current.signal});if(active.current)onSaved(result);}catch(err){if(active.current && err.name!=="AbortError")setError(channelError(err));}finally{writing.current=false;if(active.current)setSaving(false);}}
    return <div className="slack_editor_scrim"><section role="dialog" aria-modal="true" aria-labelledby="slack_access_title" className="slack_editor slack_access_editor">
        <header><h2 id="slack_access_title"><LockKeyhole size={20} aria-hidden="true"/> {current ? `Acceso · #${current.name}` : "Administrar acceso"}</h2><button type="button" disabled={saving || inviting} onClick={onClose} aria-label="Cerrar permisos del canal"><X size={20} aria-hidden="true"/></button></header>
        <p>Administrar invitaciones no concede lectura de mensajes ni archivos. Los permisos de los responsables se configuran en Permisos → Slack.</p>
        {busy && <p role="status">Cargando configuración…</p>}
        {!channel && <ChannelPicker rows={catalog} value={current} onChange={choose} disabled={busy || saving || inviting} next={next} onMore={more} loading={busy}/>}
        {!current && !busy && !catalog.length && <p>No tienes canales cuyo acceso puedas administrar.</p>}
        {current && !busy && <form onSubmit={save} aria-busy={saving}><ChannelAccessFields key={current.id} channelId={current.id} unit={current.department?.id} visibility={visibility} members={members} onVisibility={setVisibility} onMembers={setMembers} onBusyChange={setInviting} disabled={saving}/><div className="slack_access_footer"><button type="submit" className="slack_primary" disabled={saving || inviting}>{saving ? "Guardando…" : "Guardar acceso"}</button>{error && <button type="button" disabled={saving || inviting} onClick={()=>choose(current)}>Recargar configuración</button>}</div></form>}
        {error && <p role="alert" className="slack_error">{error}</p>}
    </section></div>;
}
