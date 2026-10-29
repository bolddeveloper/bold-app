import {lazy,Suspense,useEffect,useRef,useState} from "react";
import {flushSync} from "react-dom";
import {Archive,AtSign,ArrowDown,ArrowLeft,ArrowUp,BookOpen,CheckSquare,Clock,FileText,LayoutTemplate,Lightbulb,Link,Plus,Redo2,Send,Trash2,Undo2,X} from "lucide-react";
import {useCore} from '../core/core_provider.jsx';
import {confirmBold} from "../core/shared/bold_dialog.js";
import {useDialog} from "../core/shared/use_dialog.js";
import {channelApi,createChannelRefresh} from "./channel_api.js";
import {pageApi,pageError,connectPage} from "./page_api.js";
import {createPageEditor,documentContent} from "./page_editor_model.js";
import {createCollaborativePage} from "./page_collab_model.js";
import {createDraftCheckpoint} from "./draft_checkpoint.js";
import {draftService} from "./draft_service.js";
import {registerPrivateWork} from "../core/shared/private_work.js";
import CollaborativeField,{peerColor} from "./collaborative_field.jsx";
import {ReadBlocks} from "./page_blocks.jsx";
import ChannelTaskPicker from "./channel_task_picker.jsx";
import SaveResource from "./save_resource.jsx";
import {PageMessageOrigins} from './message_agreements.jsx';
import MentionPicker from './mention_picker.jsx';
import {PageTree,PageBreadcrumbs,MovePage} from './page_hierarchy.jsx';
import {PageLinkPicker,PageBacklinks} from './page_link_controls.jsx';
import PageDiscussions,{BlockCommentButton,usePageDiscussionSummary} from './page_discussions.jsx';
import {TextBlockContent,ExternalPageLink} from './page_format_controls.jsx';
import {textBlockTypes,formatKeys,rangeHasFormat,applyFormats,formattedSegments,replaceFormattedText,rebaseFormats} from './page_formats.js';
import {insertMention} from './mention_model.js';
import "./channel_pages.css";
const PageTemplates=lazy(()=>import("./page_templates.jsx"));

const icons={note:FileText,book:BookOpen,checklist:CheckSquare,idea:Lightbulb};
const kinds={paragraph:"Texto",heading:"Título",bullet:"Lista",check:"Casilla",task:"Tarea",page:"Enlace a página",code:"Código"};
const stamp=value=>new Date(value).toLocaleString("es",{dateStyle:"medium",timeStyle:"short"});
function PageIcon({value}){const Icon=icons[value] || FileText;return <Icon size={20} aria-hidden="true"/>;}
function History({channelId,page,onClose,onRestore,onDenied,disabled,onTask,onPage}){
    const [rows,setRows]=useState([]),[next,setNext]=useState(null),[snapshot,setSnapshot]=useState(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
    const active=useRef(false),request=useRef(null);
    useDialog(true,".slack_page_history",onClose);
    async function load(cursor=null){
        request.current?.abort();const c=new AbortController();request.current=c;setBusy(true);setError("");
        try{const result=await pageApi.history(channelId,page.id,cursor,{signal:c.signal});if(!c.signal.aborted && active.current){setRows(current=>cursor ? [...current,...result.results]:result.results);setNext(result.next);}}
        catch(err){if(!c.signal.aborted && active.current){if([401,403,404].includes(err.status))onDenied(err);else setError(pageError(err));}}
        finally{if(!c.signal.aborted && active.current)setBusy(false);}
    }
    async function preview(version){
        request.current?.abort();const c=new AbortController();request.current=c;setBusy(true);setError("");
        try{const result=await pageApi.revision(channelId,page.id,version,{signal:c.signal});if(!c.signal.aborted && active.current)setSnapshot(result);}
        catch(err){if(!c.signal.aborted && active.current){if([401,403,404].includes(err.status))onDenied(err);else setError(pageError(err));}}
        finally{if(!c.signal.aborted && active.current)setBusy(false);}
    }
    useEffect(()=>{active.current=true;load();return()=>{active.current=false;request.current?.abort();};},[]);
    return <div className="slack_editor_scrim"><section className="slack_editor slack_page_history" role="dialog" aria-modal="true" aria-labelledby="page_history_title">
        <header><h2 id="page_history_title">Historial de la página</h2><button type="button" aria-label="Cerrar historial" onClick={onClose}><X size={20}/></button></header>
        <p>El historial conserva puntos de recuperación, no cada pulsación. Recuperar una versión crea otra nueva sin borrar el historial anterior.</p>
        {error && <p role="alert" className="slack_error">{error}</p>}{busy && <p role="status">Cargando versiones…</p>}
        <ol className="slack_page_versions">{rows.map(row=><li key={row.version}><button type="button" disabled={busy} onClick={()=>preview(row.version)} aria-pressed={snapshot?.version===row.version}><strong>Versión {row.version} · {row.title}</strong><small>{stamp(row.created_at)} · {row.actor}{row.archived ? " · Archivada":""}</small></button></li>)}</ol>
        {next && <button type="button" disabled={busy} onClick={()=>load(next)}>Más versiones</button>}
        {snapshot && <section className="slack_page_snapshot"><h3>{snapshot.title}</h3><ReadBlocks blocks={snapshot.blocks} mentions={snapshot.mentions} onTask={onTask} onPage={onPage}/><button type="button" className="slack_primary" disabled={disabled || busy || !page.can_edit || snapshot.version===page.version} onClick={()=>onRestore(snapshot.version)}>Recuperar versión {snapshot.version}</button>{disabled && <small>Guarda o resuelve tu borrador antes de recuperar otra versión.</small>}</section>}
    </section></div>;
}

export default function ChannelPages({channel,onDirty,onDenied,onTask,targetPage,onShared,onNavigatePage}){
    const core=useCore(),identity=`${core.account?.id || ''}:${core.activeAssignment?.id || ''}:${core.authorizationRevision || 0}`;
    const [mentionPicker,setMentionPicker]=useState(null),mentionIdentity=useRef(identity);mentionIdentity.current=identity;
    const [rows,setRows]=useState([]),[next,setNext]=useState(null),[archived,setArchived]=useState(false),[canCreate,setCanCreate]=useState(false),[canTemplates,setCanTemplates]=useState(false),[templates,setTemplates]=useState(null);
    const [session,setSession]=useState(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
    const [history,setHistory]=useState(false),[taskPicker,setTaskPicker]=useState(false),[preview,setPreview]=useState(false),[remotePreview,setRemotePreview]=useState(false),[recovery,setRecovery]=useState(null),[labels,setLabels]=useState({});
    const [moving,setMoving]=useState(false),[treeRevision,setTreeRevision]=useState(0);
    const [linkPicker,setLinkPicker]=useState(false);
    const [discussions,setDiscussions]=useState(null);
    const [externalLink,setExternalLink]=useState(null);
    const discussionSummary=usePageDiscussionSummary({channelId:channel.id,page:session?.base,onDenied:denied,disabled:!!core.securityUncertain});
    const active=useRef(false),editor=useRef(null),current=useRef(null),callbacks=useRef({}),reads=useRef(null),writes=useRef(null),refresh=useRef(null),actionRetry=useRef(null),createRetry=useRef(null),shareRetry=useRef(null),acting=useRef(false),archiveFilter=useRef(archived);
    const previousFilter=useRef(archived);
    const focusedSearchTarget=useRef(null);
    const installedSearchTarget=useRef(null);
    const [searchInstallation,setSearchInstallation]=useState(null);
    const checkpoint=useRef(null),unregisterProtection=useRef(null);
    const [storedRecovery,setStoredRecovery]=useState(null),[draftProtection,setDraftProtection]=useState(null),[draftProblem,setDraftProblem]=useState("");
    function closeCheckpoint(){checkpoint.current?.close();checkpoint.current=null;unregisterProtection.current?.();unregisterProtection.current=null;}
    callbacks.current={onDirty,onDenied,onTask,onShared,onNavigatePage};archiveFilter.current=archived;current.current=session;
    function denied(err){closeCheckpoint();draftService.purge();editor.current?.dispose();editor.current=null;setSession(null);setRows([]);setHistory(false);setTaskPicker(false);setLinkPicker(false);setTemplates(null);setMentionPicker(null);setMoving(false);setRecovery(null);setStoredRecovery(null);setLabels({});callbacks.current.onDirty(false);callbacks.current.onDenied(err);}
    function report(err){if([401,403,404].includes(err.status))denied(err);else setError(pageError(err));}
    function install(page,searchRequest=null){
        setDiscussions(null);
        setExternalLink(null);
        installedSearchTarget.current=searchRequest;
        setSearchInstallation(searchRequest);
        closeCheckpoint();editor.current?.dispose();setPreview(false);setHistory(false);setLinkPicker(false);setMentionPicker(null);setRecovery(null);setStoredRecovery(null);setDraftProtection(null);setDraftProblem("");setLabels({});setNotice('');actionRetry.current=null;shareRetry.current=null;
        const options={page,onDenied:denied,onChange:(value,{remote=false}={})=>{if(active.current){current.current=value;if(remote)flushSync(()=>setSession(value));else setSession(value);callbacks.current.onDirty(value.dirty || value.status==="conflict" || !!value.recoveredBlocks?.length);queueMicrotask(()=>checkpoint.current?.changed());}}};
        editor.current=page.collaboration_enabled ? createCollaborativePage({...options,connect:signal=>connectPage(channel.id,page.id,signal),onBeforeRemote:()=>{
            const field=document.activeElement,identity=field?.dataset?.pageField;
            if(!identity || editor.current?.isComposing?.(identity))return ()=>{};
            const bookmark=editor.current?.bookmark?.(identity,field.selectionStart,field.selectionEnd);
            return ()=>{const position=editor.current?.resolveRange?.(bookmark);if(position && field.isConnected)field.setSelectionRange(position.start,position.end);};
        }}):createPageEditor({...options,save:(value,signal)=>pageApi.save(channel.id,page.id,value,signal)});
        if(page.collaboration_enabled){
            const own=editor.current;
            checkpoint.current=createDraftCheckpoint({open:()=>draftService.open({kind:"page",resource_id:page.id,channel_id:channel.id}),snapshot:()=>own.recoverySnapshot(),onDenied:denied,
                onRecovery:value=>{if(active.current && editor.current===own)setStoredRecovery(value);},
                onStatus:(value,problem)=>{if(active.current && editor.current===own){setDraftProtection(value);setDraftProblem(problem ? "No se pudo conservar el borrador en este dispositivo. No cierres la vista sin guardar; puedes reintentar.":"");}}});
            const protection=checkpoint.current;unregisterProtection.current=registerPrivateWork(()=>protection.flush());
        }
    }
    async function mayLeave(){
        if(!current.current?.dirty && current.current?.status!=="conflict" && !current.current?.recoveredBlocks?.length)return true;
        const protectedDraft=await checkpoint.current?.flush();
        return confirmBold(protectedDraft ? "El borrador está conservado en este dispositivo. ¿Salir antes de confirmar el guardado en el servidor?":"¿Salir de la página sin confirmar el guardado? Los cambios no protegidos podrían perderse.");
    }
    async function list(signal,cursor=null){
        const filter=archiveFilter.current,result=await pageApi.branch(channel.id,null,filter,cursor,{signal});
        if(!active.current || signal.aborted || filter!==archiveFilter.current)return;
        setRows(old=>cursor ? [...new Map([...old,...result.results].map(row=>[row.id,row])).values()]:result.results);setNext(result.next);setCanCreate(result.can_create);setCanTemplates(result.can_templates===true);setLoading(false);if(!cursor)setTreeRevision(value=>value+1);
    }
    async function open(identity,searchRequest=null){
        if(acting.current || !await mayLeave())return;
        reads.current?.abort();const c=new AbortController();reads.current=c;setLoading(true);setError("");
        try{const page=await pageApi.get(channel.id,identity,{signal:c.signal});if(active.current && !c.signal.aborted)install(page,searchRequest);}
        catch(err){if(active.current && !c.signal.aborted)report(err);}finally{if(active.current && !c.signal.aborted)setLoading(false);}
    }
    useEffect(()=>{
        active.current=true;
        refresh.current=createChannelRefresh(async signal=>{
            await list(signal);
            const identity=current.current?.base.id;
            if(identity){const page=await pageApi.get(channel.id,identity,{signal});if(active.current && !signal.aborted && current.current?.base.id===identity)editor.current?.remote(page);}
        },report);
        refresh.current.request();
        const hint=event=>{const payload=event.detail?.payload;if(!payload || payload.kind!=='page.comments_changed' && payload.channel_id===channel.id && (payload.kind?.startsWith("page.") || payload.kind?.startsWith("channel.")))refresh.current?.request();};
        const leave=event=>{if((current.current?.dirty || current.current?.status==="conflict" || current.current?.recoveredBlocks?.length) && !checkpoint.current?.isProtected()){event.preventDefault();event.returnValue="";}};
        window.addEventListener("bold:slack-event",hint);window.addEventListener("bold:messaging-reconnect",hint);window.addEventListener("beforeunload",leave);
        return()=>{active.current=false;closeCheckpoint();editor.current?.dispose();reads.current?.abort();writes.current?.abort();refresh.current?.dispose();callbacks.current.onDirty(false);window.removeEventListener("bold:slack-event",hint);window.removeEventListener("bold:messaging-reconnect",hint);window.removeEventListener("beforeunload",leave);};
    },[channel.id]);
    useEffect(()=>{if(previousFilter.current!==archived){previousFilter.current=archived;refresh.current?.request();}},[archived]);
    useEffect(()=>{if(!session?.base.id)closeCheckpoint();},[session?.base.id]);
    useEffect(()=>{setMentionPicker(null);setMoving(false);setLinkPicker(false);setDiscussions(null);setExternalLink(null);},[identity,core.securityUncertain]);
    useEffect(()=>{if(targetPage?.id)open(targetPage.id,targetPage.requestId);},[targetPage?.requestId]);
    useEffect(()=>{
        if(!targetPage?.block_id || installedSearchTarget.current!==targetPage.requestId || session?.base.id!==targetPage.id || loading || busy || preview || storedRecovery || mentionPicker || session?.status==="connecting" || focusedSearchTarget.current===targetPage.requestId)return;
        const target=targetPage;
        // Installation is explicit state: reopening the same page may batch
        // connecting/loading away. Focus only the final committed fields.
        const frame=window.requestAnimationFrame(()=>{
            if(!active.current || installedSearchTarget.current!==target.requestId || current.current?.base.id!==target.id || current.current?.status==="connecting")return;
            const node=[...document.querySelectorAll('[data-page-field]')].find(field=>field.dataset.pageField===target.block_id && !field.disabled)
                || [...document.querySelectorAll('[data-page-block]')].find(field=>field.dataset.pageBlock===target.block_id);
            if(node?.isConnected){node.focus({preventScroll:true});if(document.activeElement===node){focusedSearchTarget.current=target.requestId;node.scrollIntoView?.({block:"center",behavior:"instant"});}}
        });
        return()=>window.cancelAnimationFrame(frame);
    },[targetPage?.requestId,searchInstallation,session?.base.id,session?.status,session?.base.can_edit,loading,busy,preview,storedRecovery,!!mentionPicker]);
    async function create(parentId=null){
        if(acting.current || !await mayLeave())return;
        if(createRetry.current && createRetry.current.parent_id!==parentId){setError('Hay una creación sin confirmar. Reintenta esa creación antes de elegir otra ubicación.');return;}
        acting.current=true;setBusy(true);setError("");createRetry.current ||= {client_id:crypto.randomUUID(),title:"Página sin título",icon:"note",blocks:[{id:crypto.randomUUID(),type:"paragraph",text:""}],parent_id:parentId};
        const c=new AbortController();writes.current=c;
        try{const page=await pageApi.create(channel.id,createRetry.current,{signal:c.signal});if(active.current && !c.signal.aborted){createRetry.current=null;install(page);refresh.current.request();}}
        catch(err){if(active.current && !c.signal.aborted){if([400,409].includes(err.status))createRetry.current=null;report(err);}}finally{acting.current=false;if(active.current)setBusy(false);}
    }
    function edit(value){editor.current?.edit(value);setNotice("");}
    function blockChange(identity,patch){edit({...current.current.draft,blocks:current.current.draft.blocks.map(row=>row.id===identity ? {...row,...patch,...(!current.current.collaborative && typeof patch.text==='string' && !Object.hasOwn(patch,'formats') && row.formats ? {formats:rebaseFormats(row.text,row.formats,patch.text)}:{})}:row)});}
    function formatSelection(row){
        if(!editable || core.securityUncertain || current.current?.conflict || editor.current?.isComposing?.(row.id))throw Error('El bloque no admite cambios en este momento.');
        const field=document.querySelector(`[data-page-field="${row.id}"]`),start=field?.selectionStart ?? row.text.length,end=field?.selectionEnd ?? start;
        return {identity,pageId:page.id,field:row.id,own:editor.current,bookmark:editor.current?.bookmark?.(row.id,start,end),start,end,selected:row.text.slice(start,end),text:row.text};
    }
    function currentFormatRange(target){
        const value=current.current,row=value?.draft.blocks.find(block=>block.id===target.field);
        if(!active.current || target.identity!==mentionIdentity.current || value?.base.id!==target.pageId || target.own!==editor.current || !value?.base.can_edit || value.conflict || core.securityUncertain || !row || !textBlockTypes.has(row.type))throw Error('El contexto cambió. Selecciona de nuevo el texto.');
        const range=target.bookmark ? editor.current.resolveRange(target.bookmark):row.text===target.text ? {field:row.id,start:target.start,end:target.end}:null;
        if(!range || range.field!==row.id)throw Error('El bloque o la selección ya no está disponible.');
        return {row,start:Math.min(range.start,range.end),end:Math.max(range.start,range.end)};
    }
    function focusFormatted(target,range){window.requestAnimationFrame(()=>{if(target.identity!==mentionIdentity.current || target.own!==editor.current)return;const field=document.querySelector(`[data-page-field="${target.field}"]`);if(field && !field.disabled){field.focus({preventScroll:true});field.setSelectionRange(range.start,range.end);}});}
    function formatAction(row,kind){
        try{
            const target=formatSelection(row),{start,end}=target;
            if(kind==='link'){const href=formattedSegments(row.text,row.formats).find(part=>part.start<=start && part.end>start)?.attrs.href || '';setExternalLink({...target,url:href});return;}
            const patch=kind==='clear' ? Object.fromEntries(formatKeys.map(key=>[key,null])):kind==='unlink' ? {href:null,no_link:true}:{[kind]:rangeHasFormat(row.text,row.formats,start,end,kind) ? null:true};
            const formats=applyFormats(row.text,row.formats || [],start,end,patch);
            if(target.bookmark && editor.current.applyTextFormat)editor.current.applyTextFormat(target.bookmark,patch);else blockChange(row.id,{formats});
            focusFormatted(target,{start,end});setNotice('Formato aplicado. Vista previa muestra el resultado completo.');
        }catch(error){setError(error.message);}
    }
    function applyExternalLink(href,alias){
        const target=externalLink,{row,start,end}=currentFormatRange(target);
        if(row.text.slice(start,end)!==target.selected)throw Error('El texto seleccionado cambió mientras el diálogo estaba abierto. Cancela y selecciona de nuevo; no se reemplazó nada.');
        const source=formattedSegments(row.text,row.formats).find(part=>part.start<=start && part.end>start)?.attrs || {},attrs={...source,href};delete attrs.no_link;
        const next=replaceFormattedText(row.text,row.formats || [],start,end,alias,attrs);
        if(target.bookmark && editor.current.applyTextFormat){
            if(alias===row.text.slice(start,end) && end>start)editor.current.applyTextFormat(target.bookmark,{href,no_link:null});else editor.current.replaceText(target.bookmark,alias,attrs);
        }else blockChange(row.id,next);
        setExternalLink(null);setNotice('Enlace aplicado. Su nombre y dirección forman parte del contenido compartido.');focusFormatted(target,{start,end:start+alias.length});
    }
    function startMention(row){
        if(!editable || core.securityUncertain || session?.conflict || editor.current?.isComposing?.(row.id))return;
        const field=[...document.querySelectorAll('[data-page-field]')].find(node=>node.dataset.pageField===row.id),start=field?.selectionStart ?? row.text.length,end=field?.selectionEnd ?? start;
        setMentionPicker({identity,pageId:page.id,field:row.id,own:editor.current,bookmark:editor.current?.bookmark?.(row.id,start,end),start,end,text:row.text});
    }
    function selectMention(person){
        const target=mentionPicker,value=current.current;
        if(!target || !active.current || target.identity!==mentionIdentity.current || value?.base.id!==target.pageId || target.own!==editor.current || !value?.base.can_edit || value.conflict || core.securityUncertain){setMentionPicker(null);return;}
        const row=value.draft.blocks.find(block=>block.id===target.field && block.type!=='task');
        const position=target.bookmark ? editor.current.resolveRange(target.bookmark) : row?.text===target.text ? {field:target.field,start:target.start,end:target.end}:null;
        if(!row || !position || position.field!==target.field){setMentionPicker(null);setError('El bloque cambió o fue eliminado. Selecciona de nuevo dónde mencionar; tu texto se conserva.');return;}
        try{const result=insertMention(row.text,person,Math.min(position.start,position.end),Math.max(position.start,position.end));
            if(result.text.length>4000)throw Error('El bloque admite hasta 4.000 caracteres. Reduce el texto antes de añadir la mención.');
            blockChange(row.id,{text:result.text});setMentionPicker(null);
            window.requestAnimationFrame(()=>{if(target.identity!==mentionIdentity.current || current.current?.base.id!==target.pageId || target.own!==editor.current)return;
                const field=[...document.querySelectorAll('[data-page-field]')].find(node=>node.dataset.pageField===target.field && !node.disabled);field?.focus();field?.setSelectionRange(result.caret,result.caret);});
        }catch(err){setMentionPicker(null);setError(err.message);}
    }
    function add(kind){if(kind==="task"){setTaskPicker(true);return;}if(kind==='page'){setLinkPicker(true);return;}edit({...session.draft,blocks:[...session.draft.blocks,{id:crypto.randomUUID(),type:kind,text:"",...(kind==="heading" ? {level:2}:{}),...(kind==="check" ? {checked:false}:{}),...(kind==='code' ? {language:'text'}:{})}]});}
    async function navigatePage(target){
        if(!active.current || core.securityUncertain || busy)return false;
        if(callbacks.current.onNavigatePage){setHistory(false);setTemplates(null);return callbacks.current.onNavigatePage(target);}
        if(target.channel_id===channel.id)return open(target.page_id);
        setError('No se pudo abrir la página en este contexto. Cierra y vuelve a entrar en Slack.');return false;
    }
    function move(index,offset){const blocks=[...session.draft.blocks];[blocks[index],blocks[index+offset]]=[blocks[index+offset],blocks[index]];edit({...session.draft,blocks});}
    async function action(values){
        if(acting.current || current.current?.dirty || current.current?.status==="conflict")return;
        if(!await confirmBold("restore_version" in values ? "¿Recuperar esta versión como una nueva revisión?":"archived" in values && values.archived ? "¿Archivar esta página? Su historial se conservará.":"¿Restaurar la página archivada?"))return;
        if(current.current?.dirty || current.current?.status==="conflict")return;
        acting.current=true;setBusy(true);setError("");
        actionRetry.current ||= {...values,version:session.base.version,client_id:crypto.randomUUID()};
        const c=new AbortController();writes.current=c;
        try{const page=await pageApi.action(channel.id,session.base.id,actionRetry.current,{signal:c.signal});if(active.current && !c.signal.aborted){actionRetry.current=null;install(page);refresh.current.request();}}
        catch(err){if(active.current && !c.signal.aborted){if(err.status===409 && err.fields?.current){actionRetry.current=null;editor.current.remote(err.fields.current);}report(err);}}
        finally{acting.current=false;if(active.current)setBusy(false);}
    }
    async function share(){
        if(acting.current || session?.dirty)return;
        acting.current=true;setBusy(true);setError("");shareRetry.current ||= {client_id:crypto.randomUUID(),body:"",page_id:session.base.id};
        const c=new AbortController();writes.current=c;
        try{const result=await channelApi.send(channel.id,shareRetry.current,{signal:c.signal});if(active.current && !c.signal.aborted){shareRetry.current=null;callbacks.current.onShared(result.message);setNotice("Enlace publicado en el canal. No concede acceso a terceros.");}}
        catch(err){if(active.current && !c.signal.aborted)report(err);}finally{acting.current=false;if(active.current)setBusy(false);}
    }
    async function copyLink(){try{const url=new URL(location.href);url.search="";url.hash="";url.searchParams.set("slack_channel",channel.id);url.searchParams.set("slack_page",session.base.id);await navigator.clipboard.writeText(url.href);if(active.current)setNotice("Enlace copiado. Solo funciona para personas autorizadas en este canal.");}catch{setError("No se pudo copiar. Puedes compartir la página en el canal.");}}
    const page=session?.base,draft=session?.draft,conflict=session?.conflict;
    const editable=!!page?.can_edit && !preview && !busy && !storedRecovery;
    const commentButton=(row,index)=><BlockCommentButton blockId={row.id} index={index} summary={discussionSummary.data} disabled={!!core.securityUncertain || !page.blocks.some(block=>block.id===row.id)} onClick={blockId=>setDiscussions({blockId})}/>;
    const displayBlocks=draft?.blocks.map(row=>row.type==="task" ? {...row,task:page.blocks.find(old=>old.id===row.id)?.task || labels[row.task_id] || {available:false}}:row.type==='page' ? {...row,page:!core.securityUncertain && page.blocks.find(old=>old.id===row.id)?.page || {available:false}}:row) || [];
    const status={saved:"Guardado",saving:"Guardando…",connecting:"Conectando colaboración…",unsaved:"Cambios sin guardar",error:"Guardado sin confirmar",conflict:"Conflicto de versiones"}[session?.status];
    function historyKey(event){
        if(!editable || !session.collaborative || !event.target?.dataset?.pageField || event.isComposing || editor.current?.isComposing?.(event.target.dataset.pageField) || event.altKey || !(event.ctrlKey || event.metaKey))return;
        const key=event.key.toLowerCase(),redo=key==="y" || key==="z" && event.shiftKey;
        if(['b','i','k'].includes(key) && !event.shiftKey){const row=displayBlocks.find(row=>row.id===event.target.dataset.pageField);if(row && textBlockTypes.has(row.type)){event.preventDefault();formatAction(row,{b:'bold',i:'italic',k:'link'}[key]);}return;}
        if(key!=="z" && key!=="y")return;
        event.preventDefault();if(redo)editor.current?.redo();else editor.current?.undo();
    }
    return <section className={`slack_pages ${page ? "slack_page_open":""}`} aria-label="Páginas del canal" onKeyDown={historyKey}>
        <aside className="slack_page_list" inert={history || taskPicker || templates || mentionPicker || moving || linkPicker || discussions || externalLink ? true:undefined}><header><div><h3>Páginas</h3><small>Contexto para el equipo</small></div><button type="button" aria-label="Crear página" disabled={!canCreate || busy} onClick={()=>create()}><Plus size={20}/></button></header>
            {canTemplates && <button type="button" disabled={busy} onClick={()=>setTemplates({capture:false})}><LayoutTemplate size={18} aria-hidden="true"/>Plantillas</button>}<label className="slack_archive_filter"><input type="checkbox" checked={archived} onChange={e=>setArchived(e.target.checked)}/>Incluir archivadas</label>
            <PageTree rows={rows} channelId={channel.id} archived={archived} revision={treeRevision} selected={page?.id} disabled={busy} onOpen={open} onError={report}/>
            {loading && <p role="status">Cargando páginas…</p>}{!loading && !rows.length && <p>No hay páginas todavía. Crea una para reunir acuerdos, notas o listas del equipo.</p>}
            {next && <button type="button" disabled={loading || busy} onClick={()=>{reads.current?.abort();reads.current=new AbortController();list(reads.current.signal,next).catch(report);}}>Más páginas</button>}
        </aside>
        <div className="slack_page_workspace" inert={history || taskPicker || templates || mentionPicker || moving || linkPicker || discussions || externalLink ? true:undefined}>
            {error && <p role="alert" className="slack_error">{error}{createRetry.current && <button type="button" disabled={busy} onClick={()=>create(createRetry.current.parent_id)}>Reintentar creación pendiente</button>}</p>}{notice && <p role="status" className="slack_notice">{notice}</p>}
            {!page && <div className="slack_page_empty"><FileText size={40} aria-hidden="true"/><h3>Del acuerdo al documento</h3><p>Elige una página o crea una nota. El acceso siempre depende de este canal.</p>{canCreate && <button type="button" className="slack_primary" disabled={busy} onClick={()=>create()}>Crear primera página</button>}</div>}
            {page && <>
                <PageBreadcrumbs channelId={channel.id} pageId={page.id} revision={treeRevision} onOpen={open} onDenied={denied}/>
                <div className="slack_page_structure_tools" role="group" aria-label="Organización de la página">{canCreate && !page.archived_at && <button type="button" disabled={busy || !!core.securityUncertain} onClick={()=>create(page.id)}><Plus size={16} aria-hidden="true"/>Crear subpágina</button>}{page.can_manage && <button type="button" disabled={busy || !!core.securityUncertain} onClick={()=>setMoving(true)}>Mover página</button>}</div>
                {storedRecovery && <section className="slack_page_problem" aria-label="Borrador de una sesión anterior"><strong>Hay un borrador conservado en este dispositivo.</strong><p>Del {stamp(storedRecovery.updatedAt)}. Puedes combinarlo con la página actual o descartarlo. Recuperarlo no revierte los cambios de tus compañeros.</p><div><button type="button" disabled={!page.can_edit || busy || session.dirty} onClick={()=>checkpoint.current?.decide(value=>editor.current.recoverSnapshot(value)).catch(()=>setDraftProblem("No se pudo recuperar el borrador. La copia conservada sigue disponible."))}>Recuperar borrador conservado</button><button type="button" disabled={busy} onClick={async()=>{if(await confirmBold("¿Descartar el borrador conservado de esta página en este dispositivo?"))checkpoint.current?.decide(null).catch(()=>setDraftProblem("No se pudo descartar el borrador. Reintenta."));}}>Descartar borrador conservado</button></div>{!page.can_edit && <p>Necesitas permiso de edición para combinarlo; no se enviará con acceso de solo lectura.</p>}</section>}
                {draftProblem && <p className="slack_page_problem" role="alert">{draftProblem} <button type="button" onClick={()=>checkpoint.current?.retry()}>Reintentar protección</button></p>}
                {draftProtection==="protected" && <p className="slack_notice" role="status">Borrador cifrado conservado en este dispositivo mientras se confirma el guardado.</p>}
                <header className="slack_page_toolbar"><button type="button" className="slack_page_back" aria-label="Ver páginas" disabled={busy} onClick={async()=>{if(await mayLeave()){editor.current?.dispose();setSession(null);current.current=null;callbacks.current.onDirty(false);}}}><ArrowLeft size={20}/></button><span role="status" aria-live="polite" className={`slack_page_save is_${session.status}`}>{status}</span><div><button type="button" aria-pressed={preview} onClick={()=>setPreview(!preview)}>{preview ? "Editar":"Vista previa"}</button><button type="button" aria-label="Ver historial" onClick={()=>setHistory(true)}><Clock size={18}/></button><button type="button" aria-label="Copiar enlace de la página" onClick={copyLink}><Link size={18}/></button>{(page.can_create_template || page.can_update_templates) && <button type="button" aria-label="Guardar página como plantilla" disabled={busy || session.dirty || !!conflict} onClick={()=>setTemplates({capture:true})}><LayoutTemplate size={18} aria-hidden="true"/></button>}{page.can_manage && <button type="button" aria-label={page.archived_at ? "Restaurar página":"Archivar página"} disabled={busy || session.dirty || !!conflict} onClick={()=>action({archived:!page.archived_at})}><Archive size={18}/></button>}<button type="button" className="slack_primary" disabled={busy || session.dirty || !!conflict || !channel.can_send} onClick={share}><Send size={17}/>Compartir</button></div></header>
                {session.collaborative && page.can_edit && <div className="slack_page_add" role="group" aria-label="Historial de tus cambios"><button type="button" disabled={!editable || !session.canUndo} onClick={()=>editor.current?.undo()} title="Deshacer mi último cambio (Ctrl/Cmd+Z)"><Undo2 size={18} aria-hidden="true"/>Deshacer</button><button type="button" disabled={!editable || !session.canRedo} onClick={()=>editor.current?.redo()} title="Rehacer mi cambio (Ctrl/Cmd+Mayús+Z)"><Redo2 size={18} aria-hidden="true"/>Rehacer</button></div>}
                {(page.archived_at || !page.can_edit && session.status!=="connecting") && <p className="slack_notice">{page.archived_at ? "Página archivada. Su historial sigue disponible.":"Tienes acceso de solo lectura a esta página."}</p>}
                {session.collaborative && <div className="slack_collab_presence" role="status" aria-live="polite" aria-atomic="true"><span>{session.status==="connecting" ? "Abriendo colaboración segura…":session.status==="error" ? "Sincronización pendiente · borrador conservado":"Coedición activa"}</span><ul aria-label="Personas en esta página">{[...new Map((session.peers || []).map(peer=>[peer.person.employee_id,peer])).values()].map(peer=><li key={peer.person.employee_id} style={{"--peer-color":peerColor(peer.person.employee_id)}}>{peer.person.name}</li>)}</ul></div>}
                {session.status==="error" && <div role="alert" className="slack_page_problem"><p>{pageError(session.error)}</p><button type="button" disabled={busy} onClick={()=>editor.current.flush()}>Reintentar guardado</button></div>}
                <SaveResource kind="page" sourceId={page.id} initialSaved={page.saved} documentId={page.saved_document_id} disabled={busy}/>
                {page.can_read_comments && <div className="slack_page_comment_tools"><button type="button" disabled={!!core.securityUncertain} onClick={()=>setDiscussions({blockId:null})}>Comentarios de la página{discussionSummary.data ? ` · ${discussionSummary.data.blocks.reduce((sum,row)=>sum+row.open,0)} abiertos`:''}</button>{discussionSummary.problem && <p role="alert">{discussionSummary.problem} <button type="button" onClick={discussionSummary.retry}>Reintentar resumen</button></p>}</div>}
                {conflict && <section className="slack_page_problem" aria-label="Resolver conflicto"><strong>Hay una versión más reciente: {conflict.version}</strong><p>Tu borrador permanece intacto. Revisa la versión guardada antes de decidir.</p><div><button type="button" onClick={()=>setRemotePreview(!remotePreview)}>Ver versión guardada</button><button type="button" disabled={session.status==="saving" || !conflict.can_edit} onClick={()=>{editor.current.resolve(true);setRemotePreview(false);}}>Guardar mi borrador como nueva versión</button><button type="button" onClick={()=>{const own=editor.current.resolve(false);setRecovery(own);setRemotePreview(false);}}>Usar versión del servidor</button></div>{remotePreview && <div className="slack_page_snapshot"><h3>{conflict.title}</h3><ReadBlocks blocks={conflict.blocks} mentions={conflict.mentions} onTask={onTask}/></div>}</section>}
                {recovery && <p className="slack_notice">Conservamos tu borrador anterior en esta página. <button type="button" disabled={!page.can_edit || busy} onClick={()=>{edit(recovery);setRecovery(null);}}>Recuperar mi borrador</button></p>}
                {!!session.recoveredBlocks?.length && <section className="slack_page_problem" aria-label="Texto recuperable"><strong>Un bloque que estabas editando se eliminó en otra sesión.</strong><p>Conservamos tu texto para que no se pierda al combinar los cambios.</p><details><summary>Ver texto conservado</summary><pre>{session.recoveredBlocks.map(row=>row.text).join("\n\n")}</pre></details><div><button type="button" disabled={!page.can_edit} onClick={()=>editor.current.recoverBlocks()}>Recuperar como bloques nuevos</button><button type="button" onClick={async()=>{if(await confirmBold("¿Descartar la copia conservada de los bloques eliminados?"))editor.current.dismissRecovery();}}>Descartar copia</button></div></section>}
                <article className="slack_page_document">
                    <div className="slack_page_title" data-page-block="title" tabIndex={-1}><label>Icono<select aria-label="Icono de la página" value={draft.icon} disabled={!editable} onChange={e=>edit({...draft,icon:e.target.value})}><option value="note">Nota</option><option value="book">Libro</option><option value="checklist">Lista</option><option value="idea">Idea</option></select></label><PageIcon value={draft.icon}/><label className="slack_page_title_field">Título de la página<CollaborativeField as="input" field="title" peers={session.peers} editorRef={editor} value={draft.title} maxLength={160} disabled={!editable} onChange={e=>edit({...draft,title:e.target.value})}/></label></div>
                    <small className="slack_page_byline">Versión {page.version} · {stamp(page.updated_at)} · {page.updated_by}</small>
                    <PageMessageOrigins key={`${identity}:${page.id}`} rows={page.message_origins || []} blocks={displayBlocks}/>
                    {preview || !page.can_edit ? <ReadBlocks blocks={displayBlocks} mentions={page.mentions} onTask={onTask} onPage={navigatePage} renderComment={commentButton}/>:<ol className="slack_page_blocks" aria-label="Bloques de la página">{displayBlocks.map((row,index)=><li key={row.id} className={`slack_page_block is_${row.type}`}><div className="slack_page_block_content">{row.type==="task" ? <ReadBlocks blocks={[row]} onTask={onTask}/>:row.type==='page' ? <div className="slack_page_link_editor"><ReadBlocks blocks={[row]} onPage={navigatePage}/><label>Nombre opcional del enlace<CollaborativeField as="input" field={row.id} peers={session.peers} editorRef={editor} aria-label={`Nombre del enlace ${index+1}`} maxLength={160} value={row.text || ''} disabled={!editable} onChange={e=>blockChange(row.id,{text:e.target.value})}/></label></div>:<TextBlockContent row={row} index={index} label={kinds[row.type]} editable={editable} peers={session.peers} editorRef={editor} onChange={patch=>blockChange(row.id,patch)} onFormat={formatAction} mentions={page.mentions}/>}</div><div className="slack_page_block_tools">
                        {commentButton(row,index)}
                        {textBlockTypes.has(row.type) && <button type="button" aria-label={`Mencionar en bloque ${index+1}`} disabled={!editable || !!core.securityUncertain || !!conflict} onClick={()=>startMention(row)}><AtSign size={16} aria-hidden="true"/></button>}
                        <button type="button" aria-label={`Subir bloque ${index+1}`} disabled={!editable || !index} onClick={()=>move(index,-1)}><ArrowUp size={16}/></button><button type="button" aria-label={`Bajar bloque ${index+1}`} disabled={!editable || index===draft.blocks.length-1} onClick={()=>move(index,1)}><ArrowDown size={16}/></button><button type="button" aria-label={`Quitar bloque ${index+1}`} disabled={!editable} onClick={()=>edit({...draft,blocks:draft.blocks.filter(b=>b.id!==row.id)})}><Trash2 size={16}/></button></div></li>)}</ol>}
                    {page.can_edit && !preview && <div className="slack_page_add" role="group" aria-label="Añadir bloque">{Object.entries(kinds).map(([kind,label])=><button type="button" key={kind} disabled={!editable || draft.blocks.length>=200} onClick={()=>add(kind)}><Plus size={16}/>{label}</button>)}</div>}
                    <PageBacklinks key={`backlinks:${identity}:${page.id}`} channelId={channel.id} pageId={page.id} onOpen={navigatePage} onDenied={denied} disabled={!!core.securityUncertain}/>
                </article>
            </>}
        </div>
        {history && page && <History channelId={channel.id} page={page} onClose={()=>setHistory(false)} onRestore={version=>action({restore_version:version})} onDenied={denied} disabled={busy || session.dirty || !!conflict} onTask={onTask} onPage={navigatePage}/>}
        {discussions && page && !core.securityUncertain && <PageDiscussions key={`${identity}:${page.id}`} identity={identity} channelId={channel.id} page={page} initialBlock={discussions.blockId} summary={discussionSummary.data} onClose={()=>setDiscussions(null)} onDenied={denied}/>}
        {externalLink && page && <ExternalPageLink key={`${identity}:${page.id}`} selected={externalLink.selected} url={externalLink.url} onClose={()=>setExternalLink(null)} onConfirm={applyExternalLink}/>}
        {templates && <Suspense fallback={<div className="slack_editor_scrim" role="status">Abriendo plantillas…</div>}><PageTemplates channel={{...channel,can_create_page:canCreate}} page={page} capture={templates.capture} onClose={()=>setTemplates(null)} onDenied={denied} onTask={onTask} onPage={navigatePage} onCreated={result=>{setTemplates(null);install(result);refresh.current?.request();}}/></Suspense>}
        {taskPicker && <ChannelTaskPicker channelId={channel.id} purpose="page" onClose={()=>setTaskPicker(false)} onSelect={task=>{setLabels(old=>({...old,[task.id]:{...task,available:true}}));edit({...current.current.draft,blocks:[...current.current.draft.blocks,{id:crypto.randomUUID(),type:"task",task_id:task.id}]});setTaskPicker(false);}}/>}
        {mentionPicker && page && <MentionPicker key={`${identity}:${page.id}`} channelId={channel.id} pageId={page.id} onClose={()=>setMentionPicker(null)} onDenied={denied} onSelect={selectMention}/>}
        {moving && page && <MovePage key={`${identity}:${page.id}`} channelId={channel.id} page={page} onClose={()=>setMoving(false)} onDenied={denied} onMoved={()=>{setMoving(false);setNotice('Ubicación guardada. El contenido y los permisos no han cambiado.');refresh.current?.request();}}/>}
        {linkPicker && page && <PageLinkPicker key={`${identity}:${page.id}`} channelId={channel.id} pageId={page.id} onClose={()=>setLinkPicker(false)} onDenied={denied} onSelect={(linked,alias)=>{
            setLinkPicker(false);
            if(!active.current || core.securityUncertain || !current.current?.base.can_edit || current.current.conflict || current.current.draft.blocks.length>=200){setError('La página cambió o alcanzó su límite. Tu borrador sigue conservado.');return;}
            edit({...current.current.draft,blocks:[...current.current.draft.blocks,{id:crypto.randomUUID(),type:'page',page_id:linked.id,text:alias}]});
        }}/>}
    </section>;
}
