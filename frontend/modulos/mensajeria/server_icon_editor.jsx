import {useEffect,useRef,useState} from 'react';
import {ImagePlus,X} from 'lucide-react';
import {useDialog} from '../core/shared/use_dialog.js';
import {AvatarImage} from '../core/shared/avatar_image.jsx';
import AvatarEditor from '../core/shared/avatar_editor.jsx';
import {initials} from './messaging_models.js';
import {channelApi,channelError} from './channel_api.js';

export default function ServerIconEditor({server,onClose,onSaved}){
    const kind=server.private ? 'private':'department',id=server.serverId || server.id;
    const [image,setImage]=useState(server.avatar_url || null),[version,setVersion]=useState(server.icon_version || 0),[photo,setPhoto]=useState(null);
    const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[changed,setChanged]=useState(false),[error,setError]=useState(''),[allowed,setAllowed]=useState(false);
    const file=useRef(null),request=useRef(null),writing=useRef(false),active=useRef(true);
    useDialog(!photo,'.slack_icon_editor',()=>{if(!writing.current)onClose();});
    useEffect(()=>{
        active.current=true;const controller=new AbortController();request.current=controller;
        channelApi.serverIcon(kind,id,{signal:controller.signal}).then(value=>{if(!controller.signal.aborted){setImage(value.avatar_url);setVersion(value.icon_version);setAllowed(value.can_edit_icon);}}).catch(err=>{if(!controller.signal.aborted)setError(channelError(err));}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
        return()=>{active.current=false;controller.abort();};
    },[kind,id]);
    async function save(event){
        event.preventDefault();if(writing.current || !allowed || !changed)return;
        writing.current=true;setBusy(true);setError('');
        try{const value=await channelApi.updateServerIcon(kind,id,{image,version},{signal:request.current.signal});if(active.current)onSaved(value);}
        catch(err){if(active.current && err.name!=='AbortError')setError(channelError(err));}
        finally{writing.current=false;if(active.current)setBusy(false);}
    }
    return <><div className="slack_editor_scrim"><section role="dialog" aria-modal="true" aria-labelledby="slack_icon_title" className="slack_editor slack_icon_editor" inert={photo ? true:undefined}>
        <header><h2 id="slack_icon_title">Imagen de {server.name}</h2><button type="button" aria-label="Cerrar imagen del servidor" disabled={busy} onClick={onClose}><X size={19}/></button></header>
        <p>El nombre del servidor se conserva. La imagen se recorta en círculo.</p>
        <form onSubmit={save}><div className="slack_icon_preview"><span><AvatarImage url={image} initials={initials(server.name)}/></span><div><button type="button" disabled={loading || busy || !allowed} onClick={()=>file.current?.click()}><ImagePlus size={17}/>Elegir imagen</button><small>PNG, JPG o WebP · hasta 10 MB antes del recorte.</small></div></div>
            <input ref={file} type="file" hidden accept="image/png,image/jpeg,image/webp" aria-label="Seleccionar imagen del servidor" onChange={event=>{const selected=event.target.files?.[0];event.target.value='';if(selected)setPhoto(selected);}}/>
            {image && <button type="button" disabled={loading || busy || !allowed} onClick={()=>{setImage(null);setChanged(true);}}>Quitar imagen</button>}
            {loading && <p role="status">Comprobando permisos…</p>}{error && <p role="alert" className="slack_error">{error}</p>}
            <footer><button type="button" disabled={busy} onClick={onClose}>Cancelar</button><button type="submit" className="slack_primary" disabled={loading || busy || !changed || !allowed}>{busy ? 'Guardando…':'Guardar imagen'}</button></footer>
        </form>
    </section></div>{photo && <AvatarEditor file={photo} onClose={()=>setPhoto(null)} onApply={url=>{setImage(url);setChanged(true);setPhoto(null);}}/>}</>;
}
