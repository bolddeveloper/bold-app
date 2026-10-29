import {uploadStageLabel} from './staged_media.js';

export function UploadDiscard({filename,disabled,onDiscard}){
    return <section className="messaging_upload_status" aria-label="Preparación sin confirmar">
        <p>{filename} · Descarta la preparación para editar o retirar el adjunto. Un mensaje publicado nunca se elimina.</p>
        <button type="button" disabled={disabled} onClick={onDiscard}>Descartar preparación</button>
    </section>;
}

export default function UploadStatus({value,onPause}){
    if(!value)return null;
    return <section className="messaging_upload_status" aria-label="Estado del adjunto">
        <p role="status" aria-live="polite" aria-atomic="true">{value.filename || 'Archivo'} · {uploadStageLabel(value)}</p>
        {value.state!=='publishing' && <button type="button" onClick={onPause}>Detener espera</button>}
    </section>;
}
