import {useEffect,useRef,useState} from 'react';
import {LockKeyhole,Trash2,X} from 'lucide-react';
import {confirmBold} from '../core/shared/bold_dialog.js';
import {useDialog} from '../core/shared/use_dialog.js';
import {channelApi,channelError} from './channel_api.js';
import ChannelColorField from './channel_color_field.jsx';
import ChannelAccessFields from './channel_access_fields.jsx';

export default function ServerEditor({server,onClose,onSaved,onDeleted}){
    const [name,setName]=useState(server?.name || ''),[color,setColor]=useState(server?.color || '#ed3033');
    const [members,setMembers]=useState([]),[version,setVersion]=useState(server?.version),[loading,setLoading]=useState(!!server);
    const [busy,setBusy]=useState(false),[inviting,setInviting]=useState(false),[error,setError]=useState('');
    const request=useRef(null),writing=useRef(false),active=useRef(true);
    useDialog(true,'.slack_editor',()=>{if(!writing.current && !inviting)onClose();});
    useEffect(()=>{
        active.current=true;const controller=new AbortController();request.current=controller;
        if(server)channelApi.server(server.id,{signal:controller.signal}).then(value=>{
            if(!controller.signal.aborted){setName(value.name);setColor(value.color);setMembers(value.members);setVersion(value.version);}
        }).catch(err=>{if(!controller.signal.aborted)setError(channelError(err));}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
        return()=>{active.current=false;controller.abort();};
    },[server?.id]);
    async function save(event){
        event.preventDefault();if(writing.current || loading || inviting)return;
        writing.current=true;setBusy(true);setError('');
        const values={name,color,members:members.map(({employee_id,access})=>({employee_id,access})),...(server ? {version}:{})};
        try{const options={signal:request.current.signal},value=server ? await channelApi.updateServer(server.id,values,options):await channelApi.createServer(values,options);if(active.current)onSaved(value);}
        catch(err){if(active.current && err.name!=='AbortError')setError(channelError(err));}
        finally{writing.current=false;if(active.current)setBusy(false);}
    }
    async function remove(){
        if(writing.current || loading || inviting || !server?.private || !server.can_manage || !version)return;
        const signal=request.current.signal;
        writing.current=true;setBusy(true);setError('');
        try{
            if(!await confirmBold(`¿Eliminar «${server.name}»? El servidor y todos sus canales dejarán de estar disponibles para sus miembros. El historial y los archivos se conservan.`,{title:'Eliminar servidor privado'}) || signal.aborted)return;
            await channelApi.deleteServer(server.id,version,{signal});
            if(!signal.aborted)onDeleted(server.id);
        }catch(err){if(!signal.aborted)setError(channelError(err));}
        finally{writing.current=false;if(!signal.aborted)setBusy(false);}
    }
    return <div className="slack_editor_scrim"><section role="dialog" aria-modal="true" aria-labelledby="slack_server_title" className="slack_editor slack_server_editor">
        <header><h2 id="slack_server_title"><LockKeyhole size={19} aria-hidden="true"/>{server ? 'Configurar servidor':'Crear servidor privado'}</h2><button type="button" aria-label="Cerrar servidor" disabled={busy || inviting} onClick={onClose}><X size={19}/></button></header>
        <p>Solo las personas invitadas ven este servidor. Todos sus canales comparten los mismos accesos.</p>
        {loading && <p role="status">Cargando invitaciones…</p>}
        <form onSubmit={save} aria-busy={busy || loading}><fieldset disabled={busy || loading || inviting}>
            <label>Nombre del servidor<input value={name} onChange={event=>setName(event.target.value)} maxLength={80} required autoComplete="off"/></label>
            <ChannelColorField server value={color} onChange={value=>setColor(value || '#ed3033')}/>
            <ChannelAccessFields privateServer visibility="private" members={members} onMembers={setMembers} onBusyChange={setInviting} disabled={busy || loading}/>
        </fieldset>{error && <p role="alert" className="slack_error">{error}</p>}
        <footer>{server?.private && server.can_manage && <button type="button" className="slack_delete_server" disabled={busy || inviting || loading || !version} onClick={remove}><Trash2 size={15} aria-hidden="true"/>Eliminar servidor</button>}<button type="button" disabled={busy || inviting} onClick={onClose}>Cancelar</button><button type="submit" className="slack_primary" disabled={busy || inviting || loading || !name.trim()}>{busy ? 'Procesando…':server ? 'Guardar servidor':'Crear servidor'}</button></footer></form>
    </section></div>;
}
