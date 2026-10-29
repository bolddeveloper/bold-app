import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {flushSync} from 'react-dom';
import {ArrowLeft,Check,MessageSquare,Pencil,RotateCcw,Trash2,X} from 'lucide-react';
import {useCore} from '../core/core_provider.jsx';
import {useDialog} from '../core/shared/use_dialog.js';
import {confirmBold} from '../core/shared/bold_dialog.js';
import {registerPrivateWork} from '../core/shared/private_work.js';
import {createChannelRefresh} from './channel_api.js';
import {discussionApi,discussionError,commentOnlyDenial} from './page_discussion_api.js';
import {commentAttempt,commentDraft,restoreComment,mergeComments} from './page_discussion_model.js';
import {useComposerDrafts} from './use_composer_drafts.js';
import ComposerRecovery from './composer_recovery.jsx';
import {PageText} from './page_blocks.jsx';
import './page_discussions.css';

const stamp=value=>new Date(value).toLocaleString('es',{dateStyle:'medium',timeStyle:'short'});
function commentHint(event,channelId){const value=event.detail?.payload;return !value || value.channel_id===channelId && (value.kind==='page.comments_changed' || value.kind?.startsWith('channel.') || value.kind?.startsWith('page.'));}

export function usePageDiscussionSummary({channelId,page,onDenied,disabled}){
    const [data,setData]=useState(null),[problem,setProblem]=useState('');
    const refresh=useRef(null),callbacks=useRef({});callbacks.current={onDenied};
    useEffect(()=>{
        setData(null);setProblem('');
        if(!page?.id || !page.can_read_comments || disabled)return;
        let live=true;
        refresh.current=createChannelRefresh(async signal=>{
            try{const result=await discussionApi.summary(channelId,page.id,{signal});if(live && !signal.aborted){setData(result);setProblem('');}}
            catch(error){if(!live || signal.aborted)return;setData(null);if(commentOnlyDenial(error))setProblem(discussionError(error));else if([401,403,404].includes(error.status))callbacks.current.onDenied(error);else setProblem('No se pudo actualizar el resumen de comentarios.');}
        },()=>{});
        const hint=event=>{if(commentHint(event,channelId))refresh.current?.request();};
        refresh.current.request();window.addEventListener('bold:slack-event',hint);window.addEventListener('bold:messaging-reconnect',hint);
        return()=>{live=false;refresh.current?.dispose();window.removeEventListener('bold:slack-event',hint);window.removeEventListener('bold:messaging-reconnect',hint);};
    },[channelId,page?.id,page?.archived_at,page?.can_read_comments,disabled]);
    return {data,problem,retry:()=>refresh.current?.request()};
}

export function BlockCommentButton({blockId,index,summary,onClick,disabled}){
    if(!summary)return null;
    const count=summary.blocks.find(row=>row.id===blockId)?.open || 0;
    return <button type="button" aria-label={`Comentarios del bloque ${index+1}${count ? `: ${count} abiertos`:''}`} title="Comentar este bloque" disabled={disabled} onClick={()=>onClick(blockId)}><MessageSquare size={16} aria-hidden="true"/>{count>0 && <span>{count}</span>}</button>;
}

export function CommentComposer({identity,channelId,pageId,mode,parent,comment,allowed,onSent,onDenied,leaveRef}){
    const [form,setForm]=useState(()=>({body:comment?.body || '',version:comment?.version ?? null,attempt:null,touched:false}));
    const [busy,setBusy]=useState(false),[error,setError]=useState(''),[conflict,setConflict]=useState(null),[notice,setNotice]=useState('');
    const current=useRef(null),live=useRef(false),request=useRef(null),sending=useRef(false);
    current.current={form,allowed,onSent,onDenied};
    function updateForm(next){const value=typeof next==='function' ? next(current.current.form):next;current.current.form=value;setForm(value);}
    const draft=useComposerDrafts({context:identity,resource:{kind:'page-discussion',resource_id:pageId,channel_id:channelId,mode,parent_id:parent},
        read:()=>commentDraft(current.current.form.body,current.current.form.attempt,current.current.form.touched,current.current.form.version),
        restore:(_,payload,files)=>{updateForm(restoreComment(payload,files,mode,parent));setNotice('Borrador recuperado. Revísalo: no se ha enviado.');return true;},
        onDenied:error=>current.current.onDenied(error),volatile:busy});
    async function leave(){const value=current.current.form;return !value.touched && !value.attempt || !!draft.recovery || await draft.flush() || await confirmBold('No se pudo conservar el comentario. ¿Salir sin conservar los últimos cambios?');}
    const latestLeave=useRef(null);latestLeave.current=leave;
    useLayoutEffect(()=>{live.current=true;const fn=()=>latestLeave.current();if(leaveRef)leaveRef.current=fn;return()=>{live.current=false;request.current?.abort();if(leaveRef?.current===fn)leaveRef.current=null;};},[]);
    async function submit(event){
        event.preventDefault();if(sending.current || !allowed || draft.blocked || conflict)return;
        sending.current=true;setBusy(true);setError('');setNotice('');
        const c=new AbortController();request.current=c;
        try{
            const attempt=form.attempt || commentAttempt(mode,parent,form.body,form.version,crypto.randomUUID());
            flushSync(()=>updateForm(old=>({...old,attempt,touched:true})));
            if(!await draft.flush()){setError('No se pudo proteger el intento. Reintenta la protección del borrador antes de enviarlo.');return;}
            if(!live.current || c.signal.aborted || !current.current.allowed)return;
            const options={signal:c.signal};
            const value=await (mode==='root' ? discussionApi.create(channelId,pageId,attempt,options):mode==='reply' ? discussionApi.reply(channelId,pageId,parent,attempt,options):discussionApi.edit(channelId,pageId,parent,attempt,options));
            if(!live.current || c.signal.aborted)return;
            flushSync(()=>updateForm({body:'',version:value.comment?.version ?? null,attempt:null,touched:false}));
            await draft.flush();
            if(live.current && !c.signal.aborted){setNotice(mode==='edit' ? 'Comentario guardado.':'Comentario enviado.');current.current.onSent(value);}
        }catch(error){if(live.current && !c.signal.aborted){
            if([401,403,404].includes(error.status))current.current.onDenied(error);
            else {setError(discussionError(error));if(error.fields?.current_comment)setConflict(error.fields.current_comment);else if(error.status===400)updateForm(old=>({...old,attempt:null}));}
        }}finally{sending.current=false;if(live.current)setBusy(false);}
    }
    async function rebase(){
        if(!conflict || conflict.deleted_at || !await confirmBold('Tu texto local se conservará. El próximo envío será una nueva edición sobre la versión que acabas de revisar. ¿Prepararla?'))return;
        updateForm(old=>({...old,attempt:null,version:conflict.version,touched:true}));setConflict(null);setError('');
    }
    return <form className="slack_comment_composer" onSubmit={submit} aria-label={mode==='edit' ? 'Editar mi comentario':mode==='root' ? 'Nuevo comentario de bloque':'Responder conversación'}>
        <ComposerRecovery draft={draft} disabled={busy}/>
        {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
        {conflict && <section className="slack_page_problem"><strong>Versión guardada {conflict.version}</strong><div className="slack_comment_text"><PageText value={conflict.body || 'Comentario eliminado.'}/></div>{!conflict.deleted_at && <button type="button" onClick={rebase}>Preparar nueva edición con mi texto</button>}</section>}
        <label>{mode==='edit' ? 'Tu comentario':mode==='root' ? 'Comentar el bloque':'Tu respuesta'}<textarea rows={3} maxLength={4000} required value={form.body} disabled={busy || draft.blocked || !!form.attempt || !!conflict} onChange={event=>{const body=event.target.value;updateForm(old=>({...old,body,touched:true}));void draft.flush();setNotice('');}}/></label>
        <small>{form.body.length}/4.000 · Enter agrega una línea.</small>
        {!allowed && <p role="status">Esta conversación no admite envíos ahora. El borrador no se enviará automáticamente.</p>}
        {form.attempt && !busy && !conflict && <p>Hay un intento sin confirmar. Reinténtalo antes de cambiar su contenido.</p>}
        <button type="submit" className="slack_primary" disabled={busy || draft.blocked || !allowed || !form.body.trim() || !!conflict}>{busy ? 'Confirmando…':form.attempt ? 'Reintentar mismo comentario':mode==='edit' ? 'Guardar mi comentario':'Enviar comentario'}</button>
    </form>;
}

export default function PageDiscussions({channelId,page,identity,initialBlock=null,summary,onClose,onDenied}){
    const core=useCore(),[state,setState]=useState('open'),[block,setBlock]=useState(initialBlock),[selected,setSelected]=useState(null),[editing,setEditing]=useState(null),[creating,setCreating]=useState(!!initialBlock);
    const [rows,setRows]=useState([]),[next,setNext]=useState(null),[comments,setComments]=useState([]),[commentNext,setCommentNext]=useState(null),[thread,setThread]=useState(null);
    const [loading,setLoading]=useState(false),[commentLoading,setCommentLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[pending,setPending]=useState(null),[denied,setDenied]=useState(false);
    const live=useRef(false),listRefresh=useRef(null),commentRefresh=useRef(null),listRead=useRef(null),commentRead=useRef(null),write=useRef(null),formLeave=useRef(null),action=useRef(null),callbacks=useRef({}),listGeneration=useRef(0),commentGeneration=useRef(0),mutating=useRef(false);
    callbacks.current={onClose,onDenied};
    const allowed=!core.securityUncertain && !denied;
    function failure(err){
        if(commentOnlyDenial(err)){
            if(err.fields?.action==='read'){setDenied(true);setRows([]);setComments([]);setThread(null);setEditing(null);setCreating(false);}
            else {listRefresh.current?.request();commentRefresh.current?.request();}
            setError(discussionError(err));
        }
        else if([401,403,404].includes(err.status))callbacks.current.onDenied(err);
        else setError(discussionError(err));
    }
    async function mayLeave(){
        if(action.current && !await confirmBold('Hay una acción sin confirmar. Al volver, revisa el estado guardado antes de repetirla. ¿Salir?'))return false;
        return !formLeave.current || await formLeave.current();
    }
    async function close(){if(await mayLeave())callbacks.current.onClose();}
    useDialog(true,'.slack_page_discussions',close);
    useEffect(()=>{live.current=true;const guard=registerPrivateWork(()=>!action.current);
        const leave=event=>{if(action.current){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',leave);
        return()=>{live.current=false;guard();listRead.current?.abort();commentRead.current?.abort();write.current?.abort();window.removeEventListener('beforeunload',leave);};},[]);
    async function load(signal,cursor=null){
        if(listRead.current?.signal!==signal)listRead.current?.abort();const generation=++listGeneration.current;
        setLoading(true);
        try{const value=await discussionApi.list(channelId,page.id,state,block,cursor,{signal});if(live.current && !signal.aborted && generation===listGeneration.current){setRows(old=>cursor ? [...new Map([...old,...value.results].map(row=>[row.id,row])).values()]:value.results);setNext(value.next);}}
        catch(err){if(live.current && !signal.aborted && generation===listGeneration.current)failure(err);}finally{if(live.current && !signal.aborted && generation===listGeneration.current)setLoading(false);}
    }
    async function loadComments(signal,cursor=null){
        if(commentRead.current?.signal!==signal)commentRead.current?.abort();const generation=++commentGeneration.current;
        setCommentLoading(true);
        try{const value=await discussionApi.comments(channelId,page.id,selected,cursor,{signal});if(live.current && !signal.aborted && generation===commentGeneration.current){setComments(old=>mergeComments(cursor ? old:[],[...(value.thread.root ? [value.thread.root]:[]),...value.results]));setCommentNext(value.next);setThread(value.thread);}}
        catch(err){if(live.current && !signal.aborted && generation===commentGeneration.current)failure(err);}finally{if(live.current && !signal.aborted && generation===commentGeneration.current)setCommentLoading(false);}
    }
    useEffect(()=>{
        setRows([]);setNext(null);if(!allowed)return;
        const refresh=createChannelRefresh(signal=>load(signal),failure);listRefresh.current=refresh;refresh.request();
        const hint=event=>{if(commentHint(event,channelId))refresh.request();};
        window.addEventListener('bold:slack-event',hint);window.addEventListener('bold:messaging-reconnect',hint);
        return()=>{refresh.dispose();listRead.current?.abort();window.removeEventListener('bold:slack-event',hint);window.removeEventListener('bold:messaging-reconnect',hint);};
    },[state,block,allowed,channelId,page.id]);
    useEffect(()=>{
        setComments([]);setCommentNext(null);setThread(null);if(!selected || !allowed)return;
        const refresh=createChannelRefresh(signal=>loadComments(signal),failure);commentRefresh.current=refresh;refresh.request();
        const hint=event=>{if(commentHint(event,channelId))refresh.request();};
        window.addEventListener('bold:slack-event',hint);window.addEventListener('bold:messaging-reconnect',hint);
        return()=>{refresh.dispose();commentRead.current?.abort();window.removeEventListener('bold:slack-event',hint);window.removeEventListener('bold:messaging-reconnect',hint);};
    },[selected,allowed,channelId,page.id]);
    async function navigate(fn){if(await mayLeave()){formLeave.current=null;setEditing(null);setCreating(false);setError('');setNotice('');fn();}}
    async function mutate(attempt){
        if(mutating.current || !allowed)return;mutating.current=true;
        action.current=attempt;setPending(attempt);setBusy(true);setError('');const c=new AbortController();write.current=c;
        try{
            const value=attempt.kind==='resolve' ? await discussionApi.resolve(channelId,page.id,attempt.id,attempt.values,{signal:c.signal}):await discussionApi.remove(channelId,page.id,attempt.id,attempt.values,{signal:c.signal});
            if(live.current && !c.signal.aborted){action.current=null;setPending(null);setThread(value.thread);setNotice(attempt.kind==='resolve' ? (value.thread.resolved_at ? 'Conversación resuelta.':'Conversación reabierta.'):'Tu comentario fue eliminado. Las respuestas de los demás se conservan.');listRefresh.current?.request();commentRefresh.current?.request();}
        }catch(err){if(live.current && !c.signal.aborted){
            if(err.status && err.status<500 && err.status!==429){action.current=null;setPending(null);if(err.fields?.current_thread)setThread(err.fields.current_thread);commentRefresh.current?.request();}
            failure(err);
        }}finally{mutating.current=false;if(live.current)setBusy(false);}
    }
    function sent(value){setNotice('Comentario confirmado.');setCreating(false);setEditing(null);if(selected===value.thread.id)commentRefresh.current?.request();else setSelected(value.thread.id);listRefresh.current?.request();}
    const canCreate=allowed && summary?.can_create && block && page.blocks.some(row=>row.id===block);
    const form=creating && block ? {mode:'root',parent:block,allowed:canCreate}:editing ? {mode:'edit',parent:editing.id,comment:editing,allowed:allowed && !!comments.find(row=>row.id===editing.id)?.can_edit}:thread && !thread.resolved_at ? {mode:'reply',parent:thread.id,allowed:allowed && thread.can_reply}:null;
    return <div className="slack_editor_scrim"><section className="slack_editor slack_page_discussions" role="dialog" aria-modal="true" aria-labelledby="page_discussions_title">
        <header><div><h2 id="page_discussions_title">Comentarios de la página</h2><small>Conversaciones por bloque · {page.title}</small></div><button type="button" aria-label="Cerrar comentarios de la página" onClick={close}><X size={20} aria-hidden="true"/></button></header>
        <p>Solo cada autor puede editar o eliminar su comentario. Resolver un hilo no modifica la página.</p>
        {error && <p role="alert">{error} {!denied && <button type="button" onClick={()=>{setError('');listRefresh.current?.request();commentRefresh.current?.request();}}>Actualizar comentarios</button>}</p>}{notice && <p role="status">{notice}</p>}
        {pending && <p role="status">{busy ? 'Confirmando acción…':<>Acción sin confirmar. <button type="button" onClick={()=>mutate(pending)}>Reintentar misma acción</button></>}</p>}
        <div className="slack_discussion_filters"><label>Estado<select value={state} disabled={busy || denied} onChange={event=>{const value=event.target.value;navigate(()=>{setState(value);setSelected(null);});}}><option value="open">Abiertos</option><option value="resolved">Resueltos</option><option value="all">Todos</option></select></label>
            <label>Bloque<select value={block || ''} disabled={busy || denied} onChange={event=>{const value=event.target.value;navigate(()=>{setBlock(value || null);setSelected(null);});}}><option value="">Toda la página</option>{page.blocks.map((row,index)=><option key={row.id} value={row.id}>Bloque {index+1}</option>)}{block && !page.blocks.some(row=>row.id===block) && <option value={block}>Bloque retirado</option>}</select></label>
            <button type="button" disabled={!canCreate || busy || !!pending} onClick={()=>navigate(()=>{setSelected(null);setCreating(true);})}><MessageSquare size={17} aria-hidden="true"/>Nuevo hilo en este bloque</button>
        </div>
        {!block && !selected && <small>Selecciona un bloque para iniciar un hilo. Aquí también se conservan los hilos de bloques retirados.</small>}
        {loading && <p role="status">Cargando conversaciones…</p>}
        {!selected && !creating && <><ul className="slack_discussion_list" aria-label="Conversaciones de la página">{rows.map(row=><li key={row.id}><button type="button" onClick={()=>navigate(()=>setSelected(row.id))}><span><strong>{row.root?.author.name}</strong> · {stamp(row.created_at)}</span><span>{row.root?.deleted_at ? 'Comentario eliminado.':row.root?.body}</span><small>{row.resolved_at ? 'Resuelto':'Abierto'} · {row.reply_count} respuestas{!row.anchor_present ? ' · Bloque retirado':''}</small></button></li>)}</ul>{!loading && !rows.length && !denied && <p>No hay conversaciones en este filtro.</p>}{next && <button type="button" disabled={loading} onClick={()=>{listRead.current?.abort();const c=new AbortController();listRead.current=c;load(c.signal,next);}}>Más conversaciones</button>}</>}
        {selected && <section aria-label="Conversación del bloque" className="slack_discussion_thread"><button type="button" onClick={()=>navigate(()=>setSelected(null))}><ArrowLeft size={17} aria-hidden="true"/>Volver a conversaciones</button>
            {commentLoading && <p role="status">Actualizando conversación…</p>}
            {thread && <><div className="slack_discussion_status"><strong>{thread.resolved_at ? 'Conversación resuelta':'Conversación abierta'}</strong>{thread.can_resolve && <button type="button" disabled={busy || !!pending} onClick={()=>mutate({kind:'resolve',id:thread.id,values:{client_id:crypto.randomUUID(),version:thread.version,resolved:!thread.resolved_at}})}>{thread.resolved_at ? <RotateCcw size={17} aria-hidden="true"/>:<Check size={17} aria-hidden="true"/>}{thread.resolved_at ? 'Reabrir hilo':'Resolver hilo'}</button>}</div>{!thread.anchor_present && <p>El bloque fue retirado. Este hilo se conserva sin recrearlo.</p>}
                <ol className="slack_discussion_comments">{comments.map(row=><li key={row.id}><header><strong>{row.author.name}</strong><small>{stamp(row.created_at)}{row.edited_at ? ' · Editado':''}</small></header><div className="slack_comment_text"><PageText value={row.deleted_at ? 'Comentario eliminado.':row.body}/></div><div className="slack_comment_actions">{row.can_edit && <button type="button" disabled={busy || !!pending} aria-label={`Editar mi comentario de ${stamp(row.created_at)}`} onClick={()=>navigate(()=>setEditing(row))}><Pencil size={16} aria-hidden="true"/>Editar</button>}{row.can_delete && <button type="button" disabled={busy || !!pending} aria-label={`Eliminar mi comentario de ${stamp(row.created_at)}`} onClick={async()=>{if(await confirmBold('¿Eliminar tu comentario? Su texto se retirará y no se podrá recuperar; las respuestas de otros se conservan.'))mutate({kind:'delete',id:row.id,values:{client_id:crypto.randomUUID(),version:row.version}});}}><Trash2 size={16} aria-hidden="true"/>Eliminar</button>}</div></li>)}</ol>
                {commentNext && <><small>Se muestran los comentarios más recientes y el inicio del hilo.</small><button type="button" disabled={commentLoading} onClick={()=>{commentRead.current?.abort();const c=new AbortController();commentRead.current=c;loadComments(c.signal,commentNext);}}>Comentarios anteriores</button></>}
                {thread.resolved_at && <p>Reabre el hilo para agregar respuestas.</p>}</>}
        </section>}
        {form && allowed && <CommentComposer key={`${identity}:${form.mode}:${form.parent}`} identity={identity} channelId={channelId} pageId={page.id} {...form} onSent={sent} onDenied={failure} leaveRef={formLeave}/>}
        {(creating || editing) && <button type="button" disabled={busy} onClick={()=>navigate(()=>{})}>Volver sin enviar</button>}
    </section></div>;
}
