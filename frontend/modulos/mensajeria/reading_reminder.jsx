import {useEffect,useRef,useState} from 'react';
import {Mail,MailCheck} from 'lucide-react';
import {useCore} from '../core/core_provider.jsx';
import {readingItems} from '../core/reading_attention.js';
import {applyReadingResult,readingApi,readingError} from './reading_api.js';
import './reading_reminder.css';

export default function ReadingReminder(props){
    const core=useCore(),identity=`${core.account?.id}:${core.activeAssignment?.id}:${core.authorizationRevision}`;
    if(core.securityUncertain || core.activeAssignment?.chat_enabled!==true)return null;
    return <ReadingControl key={`${identity}:${props.kind}:${props.sourceId}`} {...props} identity={identity}/>;
}
function ReadingControl({kind,sourceId,scopeKey,compact=false,disabled=false,onChange,identity}){
    const core=useCore(),marker=readingItems(core.messaging?.unread).find(row=>row.scope_key===scopeKey),same=marker?.target.message_id===sourceId;
    const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
    const request=useRef(null),active=useRef(true),attempt=useRef(null),live=useRef(null),pending=useRef(false);
    live.current={identity,allowed:!core.securityUncertain,marker,same};
    useEffect(()=>{active.current=true;return()=>{active.current=false;request.current?.abort();};},[]);
    async function toggle(){
        if(pending.current || disabled || !live.current.allowed)return;
        pending.current=true;
        const intended={remove:live.current.same,marker:live.current.marker};
        const controller=new AbortController();request.current=controller;setBusy(true);setError('');setNotice('');
        const valid=()=>active.current && !controller.signal.aborted && live.current.identity===identity && live.current.allowed;
        try{
            if(!attempt.current){
                const state=await readingApi.state(kind,sourceId,{signal:controller.signal});
                if(!valid())return;
                if(intended.marker ? state.version!==intended.marker.version : state.marked){
                    throw Object.assign(Error('Reading conflict'),{status:409});
                }
                attempt.current={version:state.version,client_id:crypto.randomUUID(),remove:intended.remove,id:state.id};
            }
            const value=attempt.current;
            const result=await (value.remove ? readingApi.clear(value.id,value,{signal:controller.signal}):readingApi.mark(kind,sourceId,value,{signal:controller.signal}));
            if(valid()){applyReadingResult(result);attempt.current=null;setNotice(value.remove ? 'Marca de no leído retirada.':'Marcado como no leído para ti.');onChange?.({marked:!value.remove});}
        }catch(err){if(valid()){
            if([401,403,404,409].includes(err.status))attempt.current=null;
            if(err.status===409){try{const result=await readingApi.recover({signal:controller.signal});if(valid())applyReadingResult(result);}catch{/* Preserve the conflict and require a deliberate retry. */}}
            if(valid())setError(readingError(err));
        }}finally{pending.current=false;if(active.current && !controller.signal.aborted)setBusy(false);}
    }
    const label=busy ? 'Confirmando marca de lectura…':attempt.current ? 'Reintentar marca de lectura pendiente':same ? 'Quitar marca de no leído':'Marcar como no leído para mí';
    return <span className={`reading_reminder_control ${compact ? 'is_compact':''}`}>
        <button type="button" disabled={disabled || busy} aria-pressed={!!same} aria-label={label} title={label} onClick={toggle}>
            {same ? <MailCheck size={16} aria-hidden="true"/>:<Mail size={16} aria-hidden="true"/>}{!compact && <span>{label}</span>}
        </button>{error && <span role="alert">{error}</span>}{notice && <span className="reading_reminder_status" role="status">{notice}</span>}
    </span>;
}
export function ReadingReminderBanner({scopeKey,onOpen,disabled=false}){
    const core=useCore(),marker=readingItems(core.messaging?.unread).find(row=>row.scope_key===scopeKey);
    if(!marker || core.securityUncertain)return null;
    return <aside className="reading_reminder_banner" aria-label="Marca personal de no leído"><p>Marcado como no leído para ti. La marca permanece hasta que la quites; no cambia las confirmaciones del remitente.</p>
        <button type="button" disabled={disabled} onClick={()=>onOpen(marker.target)}>Ver mensaje marcado</button>
        <ReadingReminder kind={marker.target.kind} sourceId={marker.target.message_id} scopeKey={scopeKey} disabled={disabled}/>
    </aside>;
}
export function ReadingScopeBadge({scopeKey,channelId}){
    const core=useCore();
    const marked=readingItems(core.messaging?.unread).some(row=>scopeKey ? row.scope_key===scopeKey:row.target.kind==='channel' && row.target.channel_id===channelId);
    return marked && !core.securityUncertain ? <span role="img" className="reading_scope_badge" aria-label="Marcado como no leído para ti" title="Marcado como no leído para ti"><Mail size={14} aria-hidden="true"/></span>:null;
}
