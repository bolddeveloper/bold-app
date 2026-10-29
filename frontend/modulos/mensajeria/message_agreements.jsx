import {lazy,Suspense,useEffect,useRef,useState} from 'react';
import {createPortal,flushSync} from 'react-dom';
import {ArrowDown,ArrowUp,FileText,X} from 'lucide-react';
import {useCore} from '../core/core_provider.jsx';
import {useDialog} from '../core/shared/use_dialog.js';
import {confirmBold} from '../core/shared/bold_dialog.js';
import {agreementApi,agreementError,agreementId} from './agreement_api.js';
import {agreementAttempt,agreementDraft,initialAgreement,restoreAgreement,toggleAgreement} from './agreement_model.js';
import {useComposerDrafts} from './use_composer_drafts.js';
import './message_agreements.css';
const HistorySearch=lazy(()=>import('./history_search.jsx'));

export default function MessageAgreements(props){
    const core=useCore(),[open,setOpen]=useState(false),identity=`${core.account?.id}:${core.activeAssignment?.id}:${core.authorizationRevision}`;
    if(core.securityUncertain || core.activeAssignment?.chat_enabled!==true || !agreementId(props.containerId))return null;
    return <><button type="button" aria-label="Preparar página de acuerdos" title="Seleccionar mensajes para una página de acuerdos" disabled={props.disabled} onClick={()=>setOpen(true)}><FileText size={19} aria-hidden="true"/></button>
        {open && <AgreementReview key={`${identity}:${props.kind}:${props.containerId}`} {...props} identity={identity} onClose={()=>setOpen(false)}/>}</>;
}

function AgreementReview({kind,containerId,messages=[],more,loadingMessages,onMore,onOpenPage,identity,onClose}){
    const [form,setForm]=useState(initialAgreement),[attempt,setAttempt]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[result,setResult]=useState(null);
    const [destinations,setDestinations]=useState([]),[next,setNext]=useState(null),[query,setQuery]=useState(''),[usedQuery,setUsedQuery]=useState(''),[chosen,setChosen]=useState(null);
    const active=useRef(true),current=useRef(null),requests=useRef(new Set()),writing=useRef(false),review=useRef(null),catalogRequest=useRef(null);
    current.current=identity;review.current={form,attempt};
    const controller=()=>{const value=new AbortController();requests.current.add(value);return value;};
    const valid=c=>active.current && current.current===identity && !c.signal.aborted;
    const draft=useComposerDrafts({context:identity,resource:{kind:'message-agreement',resource_id:containerId,source_kind:kind},volatile:busy,
        read:()=>agreementDraft(review.current.form,review.current.attempt),restore:(_,payload,files)=>{const value=restoreAgreement(payload,files);setForm(value.form);setAttempt(value.attempt);setResult(null);setNotice('Revisión recuperada. No se ha creado ni compartido ninguna página automáticamente.');return true;},onDenied:onClose});
    useEffect(()=>{active.current=true;return()=>{active.current=false;for(const c of requests.current)c.abort();};},[]);
    async function close(){if(!form.touched && !attempt || draft.recovery || await draft.flush() || await confirmBold('No se pudo proteger esta revisión. ¿Cerrar sin conservar los últimos cambios?'))onClose();}
    useDialog(true,'.agreement_dialog',close);
    function change(key,value){setForm(old=>({...old,[key]:value,touched:true,...(key==='confirmed' ? {}:{confirmed:false})}));setError('');}
    async function findDestinations(cursor=null){
        catalogRequest.current?.abort();const c=controller(),term=cursor ? usedQuery:query;catalogRequest.current=c;
        try{const value=await agreementApi.destinations(term,cursor,{signal:c.signal});if(valid(c)){setDestinations(old=>[...new Map([...(cursor ? old:[]),...value.results].map(row=>[row.id,row])).values()]);setNext(value.next);setUsedQuery(term);}}
        catch(err){if(valid(c))setError(agreementError(err));}finally{requests.current.delete(c);}
    }
    useEffect(()=>{if(form.stage==='review')findDestinations();},[form.stage]);
    useEffect(()=>{setChosen(null);if(!form.destination)return;const c=controller();agreementApi.destination(form.destination,{signal:c.signal}).then(value=>{if(valid(c))setChosen(value);}).catch(err=>{if(valid(c))setError(agreementError(err));}).finally(()=>requests.current.delete(c));return()=>c.abort();},[form.destination]);
    async function prepare(renew=false){
        if(writing.current || attempt && !renew)return;const c=controller();writing.current=true;setBusy(true);setError('');
        const snapshot=review.current.form;
        try{const value=await agreementApi.review(kind,containerId,snapshot.selected,{signal:c.signal});if(valid(c)){
            const previous=new Map(snapshot.entries.map(row=>[row.message_id,row]));
            setForm(old=>({...old,stage:'review',confirmed:false,touched:true,entries:value.results.map(row=>({...row,source_text:row.text,text:previous.get(row.message_id)?.text ?? row.text})).map(({message_id,source_version,text,source_text})=>({message_id,source_version,text,source_text}))}));
            setNotice('Fuentes verificadas. Revisa cada texto y el canal antes de compartir.');
        }}catch(err){if(valid(c))setError(agreementError(err));}finally{writing.current=false;requests.current.delete(c);if(valid(c))setBusy(false);}
    }
    async function create(event){
        event.preventDefault();if(writing.current || draft.blocked || result)return;
        const c=controller();writing.current=true;setBusy(true);setError('');setNotice('');
        try{const operation=attempt || agreementAttempt(form);if(!attempt)flushSync(()=>setAttempt(operation));
            if(!await draft.flush())throw Error('No se pudo proteger el intento. Reintenta la protección antes de crear la página.');
            const value=await agreementApi.create(kind,containerId,operation,{signal:c.signal});if(valid(c)){
                flushSync(()=>{setAttempt(null);setForm(old=>({...old,touched:false,confirmed:false}));setResult(value);});await draft.flush();
                setNotice(value.created ? 'Página de acuerdos creada. No se ha publicado ningún mensaje en el canal.':'La página ya estaba creada. El reintento no la duplicó.');
            }
        }catch(err){if(valid(c)){if([400,401,403,404].includes(err.status)){setAttempt(null);setForm(old=>({...old,touched:true,confirmed:false}));}setError(err.status ? agreementError(err):err.message);}}
        finally{writing.current=false;requests.current.delete(c);if(valid(c))setBusy(false);}
    }
    async function openPage(){
        if(!result?.page.available || !onOpenPage)return;
        try{if(await onOpenPage({channel_id:result.page.channel_id,page_id:result.page.id})!==false)onClose();}catch{setError('No se pudo abrir la página. Puedes encontrarla en Páginas del canal elegido.');}
    }
    const candidates=[...new Map(messages.filter(row=>agreementId(row.id)).map(row=>[row.id,row])).values()];
    const readonly=busy || !!attempt || !!result || draft.blocked;
    const options=[...new Map([...destinations,...(chosen ? [chosen]:[])].map(row=>[row.id,row])).values()];
    function move(index,offset){setForm(old=>{const entries=[...old.entries];[entries[index],entries[index+offset]]=[entries[index+offset],entries[index]];return {...old,entries,selected:entries.map(row=>row.message_id),confirmed:false,touched:true};});}
    return createPortal(<div className="agreement_scrim"><section className="agreement_dialog" role="dialog" aria-modal="true" aria-labelledby="agreement_title">
        <header><div><h2 id="agreement_title">Página de acuerdos</h2><p>Selecciona, revisa y comparte solo el texto que decidas.</p></div><button type="button" aria-label="Cerrar revisión de acuerdos" onClick={close}><X size={20} aria-hidden="true"/></button></header>
        <div className="agreement_content">
            <p>No se copian imágenes, audios, archivos, reacciones ni permisos del origen. La página será una copia editable del texto aprobado; no se actualizará al editar los mensajes.</p>
            {draft.recovery && <section className="agreement_problem"><p>Hay una revisión cifrada conservada en este dispositivo.</p><button type="button" onClick={draft.recover}>Recuperar revisión de acuerdos</button><button type="button" onClick={draft.discard}>Descartar revisión conservada</button></section>}
            {draft.error && <p role="alert">No se pudo proteger la revisión. <button type="button" onClick={draft.retry}>Reintentar protección</button></p>}
            {result ? <section className="agreement_problem"><h3>{result.page.available ? result.page.title:'Creación confirmada; página no disponible con tus permisos actuales.'}</h3>{result.page.available && <button type="button" onClick={openPage}>Abrir página de acuerdos</button>}</section>:
            form.stage==='selection' ? <section aria-label="Seleccionar mensajes para acuerdos"><h3>Elegir mensajes</h3><p role="status" aria-atomic="true">{form.selected.length} de 20 mensajes seleccionados</p>
                {draft.blocked ? <p role="status">Verificando acceso a la selección o esperando tu decisión sobre la revisión conservada…</p>:<ol className="agreement_candidates">{candidates.map((row,index)=><li key={row.id}><label><input type="checkbox" checked={form.selected.includes(row.id)} disabled={readonly} aria-label={`Seleccionar mensaje para acuerdos ${index+1}`} onChange={()=>{try{change('selected',toggleAgreement(form.selected,row.id));}catch(err){setError(err.message);}}}/><span><strong>{row.author?.name || 'Mensaje de la conversación'}</strong><time>{new Date(row.created_at).toLocaleString('es',{dateStyle:'short',timeStyle:'short'})}</time><span>{row.body?.slice(0,180) || 'Mensaje multimedia sin texto. Solo se conservará la referencia.'}</span></span></label></li>)}</ol>}
                {more && <button type="button" disabled={readonly || loadingMessages} onClick={onMore}>{loadingMessages ? 'Cargando mensajes…':'Cargar más mensajes para seleccionar'}</button>}
                {!candidates.length && <p>No hay mensajes cargados disponibles para seleccionar.</p>}
                <button type="button" disabled={readonly || !form.selected.length} onClick={()=>prepare()}>Revisar {form.selected.length || ''} mensajes</button>
            </section>:<form onSubmit={create} aria-busy={busy}>
                <button type="button" disabled={readonly} onClick={()=>change('stage','selection')}>Cambiar selección</button>
                <label>Buscar canal de destino<input maxLength={80} value={query} disabled={readonly} onChange={event=>setQuery(event.target.value)}/></label><button type="button" disabled={readonly} onClick={()=>findDestinations()}>Buscar canales</button>{next && <button type="button" disabled={readonly} onClick={()=>findDestinations(next)}>Más canales</button>}
                <label>Canal de destino<select required value={form.destination} disabled={readonly} onChange={event=>change('destination',event.target.value)}><option value="">Seleccionar canal autorizado</option>{options.map(row=><option key={row.id} value={row.id}>#{row.name} · {row.department} · {row.visibility==='private' ? 'Privado':row.visibility==='department' ? 'Departamental':'Público'}</option>)}</select></label>
                <label>Título de los acuerdos<input maxLength={160} required value={form.title} disabled={readonly} onChange={event=>change('title',event.target.value)}/></label>
                <label>Introducción opcional<textarea rows={2} maxLength={4000} value={form.introduction} disabled={readonly} onChange={event=>change('introduction',event.target.value)}/></label>
                <ol className="agreement_excerpts">{form.entries.map((row,index)=><li key={row.message_id}><h3>Texto del mensaje {index+1}</h3><details><summary>Ver fuente revisada · versión {row.source_version}</summary><p>{row.source_text || 'Mensaje multimedia sin texto.'}</p></details><label>Texto que se compartirá {index+1}<textarea rows={3} maxLength={10000} disabled={readonly} value={row.text} onChange={event=>change('entries',form.entries.map((value,i)=>i===index ? {...value,text:event.target.value}:value))}/></label><div className="agreement_actions"><button type="button" aria-label={`Subir mensaje ${index+1}`} disabled={readonly || !index} onClick={()=>move(index,-1)}><ArrowUp size={17} aria-hidden="true"/></button><button type="button" aria-label={`Bajar mensaje ${index+1}`} disabled={readonly || index===form.entries.length-1} onClick={()=>move(index,1)}><ArrowDown size={17} aria-hidden="true"/></button></div></li>)}</ol>
                <label className="agreement_consent"><input type="checkbox" checked={form.confirmed} disabled={readonly} onChange={event=>change('confirmed',event.target.checked)}/><span>He revisado el texto y autorizo compartirlo con quienes puedan leer las páginas del canal elegido, ahora y según sus permisos futuros. Esto no les da acceso a los mensajes originales.</span></label>
                {attempt && <p>Hay un intento protegido sin confirmar. Reintentar conserva su texto, selección, destino e identificador.</p>}
                {attempt && !busy && <button type="button" onClick={async()=>{if(await confirmBold('Comprueba si ya existe la página antes de abandonar el intento. ¿Volver a revisar las fuentes con un intento nuevo?')){flushSync(()=>setAttempt(null));prepare(true);}}}>Volver a revisar fuentes</button>}
                <button type="submit" disabled={busy || draft.blocked || !attempt && (!chosen || !form.confirmed || !form.title.trim())}>{busy ? 'Confirmando página…':attempt ? 'Reintentar creación de acuerdos':'Crear página de acuerdos'}</button>
            </form>}
            {error && <p role="alert" className="agreement_problem">{error}</p>}<p role="status" aria-atomic="true">{notice || (draft.status==='protected' ? 'Revisión cifrada protegida en este dispositivo.':'')}</p>
        </div>
    </section></div>,document.body);
}

export function PageMessageOrigins({rows=[],blocks=[]}){
    const core=useCore(),[target,setTarget]=useState(null),present=new Set(blocks.map(row=>row.id));
    if(core.securityUncertain || core.activeAssignment?.chat_enabled!==true)return null;
    const visible=rows.filter(row=>row.block_ids.some(identity=>present.has(identity)));
    if(!visible.length)return null;
    return <section className="agreement_origins" aria-label="Mensajes de origen de la página"><h3>Mensajes de origen</h3><p>La página conserva el texto aprobado, no una copia sincronizada del chat. Las fuentes solo se abren si mantienes acceso.</p>{visible.map((row,index)=><button type="button" key={row.id} onClick={()=>setTarget(row.target)}>Ver mensaje de origen {index+1} · {row.target.kind==='chat' ? 'Chat privado':'Slack'}</button>)}
        {target && <Suspense fallback={<p role="status">Abriendo origen…</p>}><HistorySearch initialTarget={target} initialScope={target.kind==='chat' ? 'chat':'slack'} initialConversation={target.conversation_id || null} onClose={()=>setTarget(null)}/></Suspense>}
    </section>;
}
