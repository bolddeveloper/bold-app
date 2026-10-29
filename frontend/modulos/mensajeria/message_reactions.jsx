import {useEffect,useRef,useState} from 'react';
import {SmilePlus,X} from 'lucide-react';
import {useCore} from '../core/core_provider.jsx';
import {reactionApi,reactionError} from './reaction_api.js';
import {newestReactions} from './reaction_model.js';
import './message_reactions.css';

export default function MessageReactions(props){
    const core=useCore(),identity=`${core.account?.id}:${core.activeAssignment?.id}:${core.authorizationRevision}`;
    if(core.securityUncertain || core.activeAssignment?.chat_enabled!==true)return null;
    return <Reactions key={`${identity}:${props.kind}:${props.containerId}:${props.message.id}`} {...props} identity={identity}/>;
}
function Reactions({message,kind,containerId,disabled=false,identity}){
    const [snapshot,setSnapshot]=useState(message.reactions),[panel,setPanel]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
    const active=useRef(true),request=useRef(null),pending=useRef(false),attempt=useRef(null),opener=useRef(null),picker=useRef(null),live=useRef(null);
    const core=useCore();live.current={identity,allowed:!core.securityUncertain};
    const value=newestReactions(snapshot,message.reactions),items=value?.items || [];
    const valid=controller=>active.current && !controller.signal.aborted && live.current.identity===identity && live.current.allowed;
    const update=reactions=>setSnapshot(old=>newestReactions(old,reactions));
    function close(){setPanel(null);setError('');opener.current?.focus();}
    useEffect(()=>{active.current=true;return()=>{active.current=false;request.current?.abort();};},[]);
    useEffect(()=>{
        const changed=event=>{
            if(!live.current.allowed)return;
            const local=event.type==='bold:reaction-change',data=local ? event.detail:event.detail?.payload;
            if(local){if(data?.identity===identity && data.kind===kind && data.containerId===containerId && data.id===message.id)update(data.reactions);}
            else if(kind==='chat' && event.detail?.event_type==='messaging.reactions.updated' && data?.conversation_id===containerId){
                const row=data.reactions?.find(row=>row.id===message.id);if(row)update(row.reactions);
            }
        };
        window.addEventListener('bold:reaction-change',changed);window.addEventListener('bold:messaging-event',changed);
        return()=>{window.removeEventListener('bold:reaction-change',changed);window.removeEventListener('bold:messaging-event',changed);};
    },[identity,kind,containerId,message.id]);
    useEffect(()=>{if(panel)picker.current?.querySelector('button:not(:disabled)')?.focus();},[!!panel]);
    function accept(result,show=false){
        update(result.reactions);setPanel(old=>show || old ? result:null);
        window.dispatchEvent(new CustomEvent('bold:reaction-change',{detail:{identity,kind,containerId,id:message.id,reactions:result.reactions}}));
    }
    async function open(){
        if(pending.current || disabled)return;
        if(panel){close();return;}
        const controller=new AbortController();request.current=controller;pending.current=true;setBusy(true);setError('');
        try{const result=await reactionApi.state(kind,containerId,message.id,{signal:controller.signal});if(valid(controller))accept(result,true);}
        catch(err){if(valid(controller))setError(reactionError(err));}
        finally{pending.current=false;if(valid(controller))setBusy(false);}
    }
    async function change(key){
        if(pending.current || disabled || !live.current.allowed)return;
        const controller=new AbortController();request.current=controller;pending.current=true;setBusy(true);setError('');setNotice('');
        try{
            if(!attempt.current){
                // Capture intent before the permission/state read. A second tab
                // cannot turn an intended removal into a fresh addition.
                const current=newestReactions(snapshot,message.reactions),item=current?.items.find(row=>row.key===key),intended=!item?.mine;
                const state=await reactionApi.state(kind,containerId,message.id,{signal:controller.signal});
                if(!valid(controller))return;accept(state);
                if(!state.can_change)throw {status:403};
                if(current && current.own_version!==state.reactions.own_version)throw {status:409};
                attempt.current={key,active:intended,version:state.reactions.own_version,client_id:crypto.randomUUID()};
            }
            const operation=attempt.current;
            const result=await reactionApi.set(kind,containerId,message.id,operation,{signal:controller.signal});
            if(valid(controller)){accept(result);attempt.current=null;setNotice(operation.active ? 'Tu reacción se añadió.':'Tu reacción se retiró.');}
        }catch(err){if(valid(controller)){
            if([400,401,403,404,409].includes(err.status))attempt.current=null;
            if(err.status===409){try{const latest=await reactionApi.state(kind,containerId,message.id,{signal:controller.signal});if(valid(controller))accept(latest);}catch{/* Keep the conflict visible. */}}
            if(valid(controller))setError(reactionError(err));
        }}finally{pending.current=false;if(valid(controller))setBusy(false);}
    }
    return <div className="message_reactions" aria-label="Reacciones del mensaje">
        <div className="message_reaction_chips">{items.map(item=><button type="button" key={item.key} aria-pressed={!!item.mine} disabled={disabled || busy || !!attempt.current} title={`${item.label}: ${item.count}${item.mine ? ' · Tú también':''}`} aria-label={`${item.label}: ${item.count} ${item.count===1 ? 'reacción':'reacciones'}${item.mine ? '. Retirar mi reacción':'. Añadir mi reacción'}`} onClick={()=>change(item.key)}><span aria-hidden="true">{item.emoji}</span><span>{item.count}</span></button>)}
            <button ref={opener} type="button" aria-label={busy ? 'Confirmando reacciones…':'Elegir reacción'} aria-expanded={!!panel} disabled={disabled || busy} onClick={open}><SmilePlus size={16} aria-hidden="true"/></button>
        </div>
        {panel && <div ref={picker} className="message_reaction_picker" role="group" aria-label="Elegir mi reacción" onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();event.preventDefault();close();}}}>
            <div><span>Reacciones · hasta {panel.max_own} tuyas</span><button type="button" aria-label="Cerrar reacciones" onClick={close}><X size={16} aria-hidden="true"/></button></div>
            {!panel.can_change && <p>Solo lectura con tus permisos actuales, o canal archivado.</p>}
            <div className="message_reaction_choices">{panel.choices.map(choice=>{const mine=items.some(item=>item.key===choice.key && item.mine);return <button type="button" key={choice.key} aria-label={choice.label} aria-pressed={mine} disabled={disabled || busy || !panel.can_change || !!attempt.current} onClick={()=>change(choice.key)}><span aria-hidden="true">{choice.emoji}</span></button>;})}</div>
        </div>}
        {attempt.current && !busy && <button type="button" disabled={disabled} onClick={()=>change(attempt.current.key)}>Reintentar reacción pendiente</button>}
        {error && <p className="message_reaction_error" role="alert">{error}</p>}<span className="message_reaction_status" role="status" aria-atomic="true">{notice}</span>
    </div>;
}
