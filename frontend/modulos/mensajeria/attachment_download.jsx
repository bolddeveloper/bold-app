import {useEffect,useRef,useState} from 'react';
import {Download,LoaderCircle} from 'lucide-react';
import {mediaDownloadName} from './resource_api.js';

export default function AttachmentDownload({media,fetchBlob,label='Descargar archivo'}){
    const [busy,setBusy]=useState(false),[error,setError]=useState('');
    const controller=useRef(null),objectUrl=useRef(null);
    useEffect(()=>()=>{controller.current?.abort();if(objectUrl.current)URL.revokeObjectURL(objectUrl.current);},[]);
    async function download(){
        if(controller.current)return;
        const abort=new AbortController();controller.current=abort;setBusy(true);setError('');
        try{
            const filename=mediaDownloadName(media);
            // Reauthorize every click, even when this control downloaded before.
            const blob=await fetchBlob({signal:abort.signal});
            if(abort.signal.aborted)return;
            if(objectUrl.current)URL.revokeObjectURL(objectUrl.current);
            objectUrl.current=URL.createObjectURL(blob);
            const link=document.createElement('a');link.href=objectUrl.current;link.download=filename;
            document.body.appendChild(link);link.click();link.remove();
        }catch(err){if(!abort.signal.aborted)setError([401,403,404].includes(err.status) ? 'Ya no tienes acceso al archivo. Cierra la vista y vuelve a abrirla.':'No se pudo descargar. Comprueba tu conexión y vuelve a intentarlo.');}
        finally{if(!abort.signal.aborted){controller.current=null;setBusy(false);}}
    }
    return <div className="attachment_download"><button type="button" disabled={busy} onClick={download}>{busy ? <LoaderCircle size={17} aria-hidden="true"/>:<Download size={17} aria-hidden="true"/>}{busy ? 'Descargando…':label}</button>{error && <p role="alert">{error}</p>}</div>;
}
