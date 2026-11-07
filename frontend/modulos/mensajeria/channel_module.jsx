import {lazy, Suspense, useEffect, useLayoutEffect, useRef, useState} from "react";
import {Archive, ArrowDown, ArrowLeft, AtSign, Bell, BellOff, CheckCheck, ChevronDown, Hash, ImagePlus, LockKeyhole, MessageSquare, MoreHorizontal, Plus, RefreshCw, Send, Settings2, Search, PanelLeftClose, History, Bookmark, Mail, ListFilter, X} from "lucide-react";
import {useFileTransfer,FileDropHint} from "../core/shared/use_file_transfer.jsx";
import {useCore} from "../core/core_provider.jsx";
import {useShell} from "../core/app_shell.jsx";
import {AvatarImage} from "../core/shared/avatar_image.jsx";
import {useDialog} from "../core/shared/use_dialog.js";
import {channelApi, channelError, followError, createChannelRefresh, mergeChannelDetails, mergeChannelMessage, mergeChannelMessages,threadPreferenceMessage} from "./channel_api.js";
import {useChannelReader} from "./use_channel_reader.js";
import {dayLabel, enterSends, initials} from "./messaging_models.js";
import {MediaDraft, MessageMedia, VoiceRecorder} from "./message_media.jsx";
import ImageQueue from "./image_queue.jsx";
import {Paperclip, Smartphone} from "lucide-react";
import {DOCUMENT_ACCEPT,DOCUMENT_HINT,prepareDocumentFile} from './document_files.js';
const PhoneTransfer = lazy(() => import("./phone_transfer.jsx"));
import {appendImages, canReviseFailedImage, captionQueuedImage, replaceQueuedImage,renewRejectedMedia} from "./image_queue_model.js";
import {lockChannelMedia, unlockRejectedChannelMedia} from "./channel_outbox.js";
import {captureComposer,restoreComposer} from "./composer_draft.js";
import {useComposerDrafts} from "./use_composer_drafts.js";
import ComposerRecovery from "./composer_recovery.jsx";
import UploadStatus,{UploadDiscard} from './upload_status.jsx';
import "./messaging.css";
import "./channel.css";
import "./thread_follow.css";
import "./channel_controls.css";
import "./channel_pages.css";
import "./slack_workspace_v3.css";
import './channel_editor.css';
import "./chat_panels_v3.css";
import ComposerOptions from "./composer_options.jsx";
import MessageActions from "./chat_message_actions.jsx";
import ChannelTaskPicker from "./channel_task_picker.jsx";
import ChannelAccessEditor, {ChannelAccessFields} from "./channel_access_editor.jsx";
import {SearchField} from "./channel_picker.jsx";
import ChannelColorField from "./channel_color_field.jsx";
import {channelMatches, channelColor,channelServerKey,channelServerFilters} from "./channel_discovery.js";
import {confirmBold} from "../core/shared/bold_dialog.js";
const ChannelPages = lazy(() => import("./channel_pages.jsx"));
const ChannelAutomations = lazy(() => import('./channel_automations.jsx'));
const ImageEditor = lazy(() => import("./image_editor.jsx"));
const HistorySearch = lazy(() => import("./history_search.jsx"));
const ResourceLibrary = lazy(() => import("./resource_library.jsx"));
import {ReadingReminderBanner} from './reading_reminder.jsx';
import MessageAgreements from './message_agreements.jsx';
import {readingScope} from '../core/reading_attention.js';
import MentionPicker from "./mention_picker.jsx";
import MentionText from "./mention_text.jsx";
import {insertMention,chatMentionAtCaret} from "./mention_model.js";
import MentionSuggestions from "./chat_mention_suggestions.jsx";

import ServerEditor from './server_editor.jsx';
import ServerRail from './server_rail.jsx';
import ServerIconEditor from './server_icon_editor.jsx';
import ChannelCategories from './channel_categories.jsx';
import {ChannelCatalog,ChannelContext,ThreadNotice,threadTitle} from './channel_threads.jsx';
import {ThreadActions} from './thread_actions.jsx';

function Department({value}) {
    value = value || {name:"Sin departamento",color:""};
    return <span className="slack_department" style={{"--department-color":/^#[0-9a-f]{6}$/i.test(value.color) ? value.color : "var(--bold_red_dark)"}}>{value.name}</span>;
}

function ChannelEditor({channel, scope, departments, canCreateIndependent, onClose, onSaved}) {
    const [unit, setUnit] = useState(channel ? channel.department?.id || "" : scope ? scope.departmentId || "" : canCreateIndependent ? "" : departments.find(row => row.can_create)?.id || "");
    const [name, setName] = useState(channel?.name || ""), [description, setDescription] = useState(channel?.description || "");
    const [color,setColor]=useState(channel?.color || ""),[inviting,setInviting]=useState(false);
    const [visibility,setVisibility]=useState(scope?.private ? "private":scope?.departmentId ? "department":"public"),[members,setMembers]=useState([]);
    const [busy, setBusy] = useState(false), [error, setError] = useState("");
    const active = useRef(true), request = useRef(null), sending = useRef(false),nameField=useRef(null);
    useEffect(() => {active.current = true; return () => {active.current = false; request.current?.abort();};}, []);
    useDialog(true, ".slack_editor", () => {if (!sending.current && !inviting) onClose();});
    useEffect(()=>{nameField.current?.focus();},[]);
    async function save(event) {
        event.preventDefault();
        if (sending.current || inviting) return;
        sending.current = true; setBusy(true); setError("");
        request.current = new AbortController();
        try {
            const options = {signal:request.current.signal};
            const result = channel ? await channelApi.update(channel.id, {name, description, color, version:channel.version}, options)
                : await channelApi.create({unit_id:unit || null,...(scope?.private ? {server_id:scope.serverId}:{}),...(scope?.categoryId ? {category_id:scope.categoryId}:{}), name, description,color,visibility,members:members.map(({employee_id,access})=>({employee_id,access}))}, options);
            if (active.current) onSaved(result);
        } catch (err) {if (active.current && err.name !== "AbortError") setError(channelError(err));}
        finally {sending.current = false; if (active.current) setBusy(false);}
    }
    return <div className="slack_editor_scrim"><section role="dialog" aria-modal="true" aria-labelledby="slack_editor_title" className={`slack_editor slack_channel_editor ${channel ? 'is_editing':''}`}>
        <header><div><h2 id="slack_editor_title"><Hash size={18} aria-hidden="true"/>{channel ? "Configurar canal" : "Crear canal"}</h2><p>{scope ? <>En <strong>{scope.name}</strong>{scope.categoryId ? ' · Categoría seleccionada':''}</> : channel ? 'Nombre, descripción y apariencia.':'Conversa y comparte archivos con tu equipo.'}</p></div><button type="button" onClick={onClose} disabled={busy || inviting} aria-label="Cerrar configuración"><X aria-hidden="true" size={18}/></button></header>
        <form onSubmit={save} aria-busy={busy}>
            <div className="slack_channel_editor_body"><fieldset disabled={busy || inviting}>
                {!channel && !scope && <label>Departamento<select value={unit} onChange={event => {setUnit(event.target.value);if(!event.target.value && visibility==="department")setVisibility("private");}} required={!canCreateIndependent}>{canCreateIndependent && <option value="">Sin departamento</option>}{departments.filter(row => row.can_create).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select>{canCreateIndependent && <small>Elige «Sin departamento» para un espacio independiente.</small>}</label>}
                <label>Nombre del canal<div className="slack_channel_name"><Hash size={16} aria-hidden="true"/><input ref={nameField} autoComplete="off" placeholder="Ej. ideas-del-equipo" value={name} onChange={event => setName(event.target.value)} maxLength={80} required/></div></label>
                <details className="slack_channel_appearance" open={channel ? true:undefined}><summary><span>Descripción y color</span><small>Opcional</small><ChevronDown size={15} aria-hidden="true"/></summary><div>
                    <label>Descripción<textarea rows={2} placeholder="¿Para qué usarán este canal?" value={description} onChange={event => setDescription(event.target.value)} maxLength={500}/></label>
                    <ChannelColorField value={color} onChange={setColor} department={channel?.department || departments.find(row=>row.id===unit)}/>
                </div></details>
                {!channel && scope?.private && <p className="slack_server_hint"><LockKeyhole size={15} aria-hidden="true"/> Solo las personas del servidor pueden entrar. Sus permisos se heredan.</p>}
                {!channel && !scope?.private && <ChannelAccessFields compact unit={unit} visibility={visibility} members={members} onVisibility={setVisibility} onMembers={setMembers} onBusyChange={setInviting} disabled={busy}/>}
            </fieldset></div>
            {error && <p className="slack_error" role="alert">{error}</p>}
            <footer className="slack_channel_editor_footer"><button type="button" disabled={busy || inviting} onClick={onClose}>Cancelar</button><button type="submit" className="slack_primary" disabled={busy || inviting || !name.trim() || (!channel && !unit && !scope?.private && !canCreateIndependent)}>{busy ? "Guardando…" : channel ? 'Guardar cambios':'Crear canal'}</button></footer>
        </form>
    </section></div>;
}

export default function ChannelModule() {
    const [historyOpen,setHistoryOpen]=useState(false);
    const [explorerOpen,setExplorerOpen]=useState(true),railSearch=useRef(null);
    const [libraryOpen,setLibraryOpen]=useState(null);
    const [servers,setServers]=useState([]),[serverNext,setServerNext]=useState(null),[serverLoading,setServerLoading]=useState(false),[serverEditor,setServerEditor]=useState(null),[iconEditor,setIconEditor]=useState(null);
    const [phoneTarget, setPhoneTarget] = useState(null);
    const core = useCore(), shell = useShell();
    const [channelTab,setChannelTab]=useState("messages"),[pageTarget,setPageTarget]=useState(null);
    const pageDirty=useRef(false);
    const pageDirtyChanged=value=>{pageDirty.current=value;shell.set_slack_dirty?.(value);};
    const mayLeavePage=async()=>!pageDirty.current || await confirmBold("¿Salir de esta revisión de Slack sin confirmar el guardado? Comprueba que el borrador esté protegido antes de continuar. Salir no elimina ni pausa operaciones que el servidor haya recibido.");
    async function changeTab(tab){if(tab!==channelTab && await mayLeavePage()){setChannelTab(tab);pageDirtyChanged(false);}}
    const allowed = core.activeAssignment?.chat_enabled === true && !core.securityUncertain;
    const [departments, setDepartments] = useState([]), [channels, setChannels] = useState([]), [channelNext, setChannelNext] = useState(null);
    const [canCreateIndependent, setCanCreateIndependent] = useState(false);
    const [selected, setSelected] = useState(null), [messages, setMessages] = useState([]), [older, setOlder] = useState(null);
    const [parent, setParent] = useState(null), [query, setQuery] = useState(""), [department, setDepartment] = useState("");
    const [catalogRequest,setCatalogRequest]=useState(0);
    const [catalogOpen,setCatalogOpen]=useState(false),[threadName,setThreadName]=useState(''),[startingThread,setStartingThread]=useState(false);
    const threadStart=useRef(null);
    const [archived, setArchived] = useState(false), [editor, setEditor] = useState(null), [drafts, setDrafts] = useState({}), [edit, setEdit] = useState(null);
    const [accessEditor,setAccessEditor]=useState(null);
    const [mentionPicker,setMentionPicker]=useState(null),[inlineMention,setInlineMention]=useState(null),[inlineActive,setInlineActive]=useState(undefined);
    const inlinePanel=useRef(null),mentionLive=useRef(null);
    const [taskDrafts,setTaskDrafts]=useState({}),[taskPicker,setTaskPicker]=useState(false),[openingTaskId,setOpeningTaskId]=useState(null);
    const [mediaDrafts,setMediaDrafts]=useState({}),[activeImage,setActiveImage]=useState(null),[imageEditor,setImageEditor]=useState(null),[recording,setRecording]=useState(false);
    const fileInput=useRef(null), documentInput=useRef(null), mediaState=useRef({});
    mediaState.current=mediaDrafts;
    const openingTask=useRef(null);
    const [loading, setLoading] = useState(true), [sendingRequest, setSending] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
    const [discarding,setDiscarding]=useState(false),sending=sendingRequest || discarding;
    const [stagedUpload,setStagedUpload]=useState(null);
    const [followingBusy,setFollowingBusy]=useState(false),followWrite=useRef(null);
    const [threadFollowingBusy,setThreadFollowingBusy]=useState(false),threadFollowWrite=useRef(null);
    const openedTarget=useRef(null);
    const stickToBottom=useRef(true),forceToBottom=useRef(false),lastMessage=useRef(null);
    const [newBelow,setNewBelow]=useState(false);
    const mounted = useRef(false), state = useRef({}), reads = useRef(null), writes = useRef(null), busy = useRef(false), retries = useRef(new Map()), viewport = useRef(null), field = useRef(null), refresh = useRef(null);
    const key = `${selected?.id || ""}:${parent?.id || ""}`;
    const identity=`${core.account?.id || core.account?.employee || ""}:${core.activeAssignment?.id || ""}:${core.authorizationRevision || 0}:${allowed}`;
    state.current = {selected, parent, archived, key, query, department, channelTab, identity};
    const actorId = core.account?.employee || core.employee?.id || core.activeAssignment?.personId;
    const attachments=mediaDrafts[key] || [], images=attachments.filter(item=>item.file.type.startsWith("image/"));
    const activeMedia=images.find(item=>item.id===activeImage) || images[0] || attachments[0];
    const draft = edit?.body ?? activeMedia?.caption ?? drafts[key] ?? "";
    const draftTask=edit ? edit.task : taskDrafts[key];
    const editCache=useRef(new Map());
    if(edit)editCache.current.set(key,edit);
    const composerRecovery=useComposerDrafts({context:`${core.account?.id || ""}:${core.activeAssignment?.id || ""}:${core.authorizationRevision || 0}`,
        resource:selected ? {kind:"channel",resource_id:selected.id,...(parent ? {parent_id:parent.id}:{})}:null,volatile:recording || !!imageEditor,
        read:resource=>{const target=`${resource.resource_id}:${resource.parent_id || ""}`,savedEdit=editCache.current.get(target);return captureComposer({text:drafts[target] || "",items:mediaState.current[target] || [],taskId:taskDrafts[target]?.id,edit:savedEdit,attempt:retries.current.get(savedEdit ? `edit:${savedEdit.id}`:target),selectedId:activeImage});},
        restore:(resource,payload,files)=>{
            const target=`${resource.resource_id}:${resource.parent_id || ""}`;if(target!==state.current.key || busy.current)return false;
            const value=restoreComposer(payload,files);
            const attempts=[value.attempt,...value.items.map(item=>item.attempt)].filter(Boolean);
            if(attempts.some(attempt=>Object.hasOwn(attempt,"parent_id") && (attempt.parent_id || null)!==(resource.parent_id || null)))throw Error("El borrador pertenece a otro hilo.");
            setDrafts(current=>({...current,[target]:value.text}));setAttachments(target,value.items);setActiveImage(value.selectedId);setTaskDrafts(current=>({...current,[target]:value.taskId ? {id:value.taskId,title:"Referencia conservada; se verificará al enviar"}:null}));
            if(value.edit){const source=messages.find(row=>row.id===value.edit.id),restored=source?.can_edit && source.version===value.edit.version ? {...source,body:value.edit.body}:{...value.edit,can_edit:false,conflict:true};editCache.current.set(target,restored);setEdit(restored);}else {editCache.current.delete(target);setEdit(null);}
            const attemptKey=value.edit ? `edit:${value.edit.id}`:target;if(value.attempt)retries.current.set(attemptKey,value.attempt);else retries.current.delete(attemptKey);
            setNotice("Borrador recuperado para este canal o hilo. Revísalo antes de enviar; las referencias a tareas se verifican de nuevo.");return true;
        },onDenied:report});
    const pendingMedia=attachments.some(item=>item.attempted);
    function setAttachments(viewKey, update) {setMediaDrafts(current=>{const items=typeof update === "function" ? update(current[viewKey] || []) : update;const next={...current,[viewKey]:items};mediaState.current=next;return next;});}
    function addImages(files) {
        if (busy.current || recording || edit || composerRecovery.blocked || !selected?.can_send || retries.current.has(key) || pendingMedia) return;
        try {
            if (attachments.some(item=>!item.file.type.startsWith("image/"))) throw Error("Envía o quita el adjunto antes de añadir imágenes.");
            let next=appendImages(attachments,files);
            if (next.length===attachments.length) return;
            if (!attachments.length) {next=captionQueuedImage(next,next[0].id,drafts[key] || "");setDrafts(current=>({...current,[key]:""}));}
            setAttachments(key,next);setActiveImage(next[attachments.length].id);setError("");field.current?.focus();return true;
        } catch(err) {setError(err.message);}
    }
    function addFiles(files){
        const rows=Array.from(files || []);if(!rows.length)return;
        if(rows.every(file=>file.type.startsWith('image/')))return addImages(rows);
        if(busy.current || recording || edit || composerRecovery.blocked || !selected?.can_send || retries.current.has(key) || pendingMedia)return;
        if(rows.length!==1 || attachments.length){setError('Envía o quita los adjuntos pendientes y selecciona un documento por mensaje.');return;}
        try{const file=prepareDocumentFile(rows[0]);setAttachments(key,[{id:crypto.randomUUID(),file,caption:drafts[key] || '',attempted:false}]);setDrafts(current=>({...current,[key]:''}));setError('');}catch(err){setError(err.message);}
    }
    function readyAudio(file) {
        if (!mounted.current || key!==state.current.key || !state.current.selected?.can_send) return;
        setAttachments(key,[{id:crypto.randomUUID(),file,caption:drafts[key] || "",attempted:false}]);
        setDrafts(current=>({...current,[key]:""}));setError("");field.current?.focus();
    }
    function clearMedia() {
        if(busy.current || (mediaState.current[key] || []).some(item=>item.attempted))return;
        // Preserve the selected caption when explicitly returning to text-only.
        setDrafts(current=>({...current,[key]:activeMedia?.caption || current[key] || ""}));setAttachments(key,[]);setActiveImage(null);
    }
    function clearPrivateState() {
        threadStart.current?.abort();threadStart.current=null;setStartingThread(false);setCatalogOpen(false);setCatalogRequest(0);setThreadName('');
        setMentionPicker(null);setInlineMention(null);
        threadFollowWrite.current?.abort();threadFollowWrite.current=null;setThreadFollowingBusy(false);
        pageDirtyChanged(false);setChannelTab("messages");setPageTarget(null);
        state.current={...state.current,selected:null,parent:null,key:":"};
        reads.current?.abort();writes.current?.abort();followWrite.current?.abort();openingTask.current?.abort();
        setMessages([]);setChannels([]);setChannelNext(null);setSelected(null);setParent(null);setOlder(null);setEdit(null);setEditor(null);setAccessEditor(null);
        setDrafts({});setTaskDrafts({});setTaskPicker(false);setMediaDrafts({});mediaState.current={};setImageEditor(null);setActiveImage(null);setServerEditor(null);setIconEditor(null);retries.current.clear();
        editCache.current.clear();
    }
    function report(err) {if (mounted.current && err.name !== "AbortError") {if ([401,403,404].includes(err.status)) {clearPrivateState();setServers([]);}setError(channelError(err));}}
    async function select(row, {signal}={}) {
        if (busy.current || recording || signal?.aborted) return false;
        const snapshot=state.current, leavingPage=snapshot.channelTab!=="messages";
        if((row?.id!==snapshot.selected?.id || leavingPage) && !await mayLeavePage())return false;
        // A confirmation may outlive the identity, target or view which opened it.
        if(signal?.aborted || !mounted.current || snapshot.identity!==state.current.identity || snapshot.key!==state.current.key || snapshot.channelTab!==state.current.channelTab)return false;
        setExplorerOpen(!row);
        setCatalogRequest(0);setCatalogOpen(false);
        if(row)setDepartment(channelServerKey(row));
        if(row?.id!==snapshot.selected?.id || leavingPage){setChannelTab("messages");setPageTarget(null);pageDirtyChanged(false);}
        if(row && row.id===state.current.selected?.id && !state.current.parent) {
            setSelected(current=>mergeChannelDetails(current,row));jumpToLatest();refresh.current?.request();return;
        }
        state.current = {...state.current, selected:row, parent:null, key:`${row?.id || ""}:`};
        setLoading(!!row);
        setSelected(row); setParent(null); setMessages([]); setOlder(null); setEdit(null); setError(""); setNotice("");
    }
    async function load(signal) {
        const archivedSnapshot = state.current.archived;
        const querySnapshot=state.current.query,serverSnapshot=state.current.department;
        if(!serverSnapshot)return;
        const page = await channelApi.list(archivedSnapshot, null, {signal},{...channelServerFilters(serverSnapshot),...(querySnapshot ? {q:querySnapshot}:{})});
        if (signal.aborted || !mounted.current || archivedSnapshot !== state.current.archived || querySnapshot!==state.current.query || serverSnapshot!==state.current.department) return;
        setChannels(current=>page.results.map(row=>mergeChannelDetails(current.find(old=>old.id===row.id),row))); setChannelNext(page.next);
    }
    async function reloadCatalog(next=null){
        if(serverLoading)return;
        const controller=new AbortController(),snapshot=state.current.identity;setServerLoading(true);
        try{const page=await channelApi.servers({signal:controller.signal},next);if(mounted.current && snapshot===state.current.identity){setServers(current=>next ? [...new Map([...current,...page.results].map(row=>[row.id,row])).values()]:page.results);setServerNext(page.next);if(!next)await refresh.current?.request();}}
        catch(err){if(mounted.current && snapshot===state.current.identity)report(err);}
        finally{if(mounted.current && snapshot===state.current.identity)setServerLoading(false);}
    }
    async function serverSaved(row){
        const creating=!!serverEditor?.create,snapshot=state.current.identity;
        setServerEditor(null);setServers(current=>[...current.filter(item=>item.id!==row.id),row]);
        if(creating){
            if(await select(null)===false)return;
            setDepartment(`server:${row.id}`);setChannels([]);setChannelNext(null);setQuery('');setExplorerOpen(true);
        }else{
            clearPrivateState();
            try{const page=await channelApi.servers();if(mounted.current && snapshot===state.current.identity){setServers(page.results);setServerNext(page.next);await refresh.current?.request();}}
            catch(err){if(mounted.current && snapshot===state.current.identity)report(err);}
        }
    }
    async function serverDeleted(id){
        const snapshot=state.current.identity;
        setServerEditor(null);
        setServers(current=>current.filter(row=>row.id!==id));
        if(state.current.department===`server:${id}` || state.current.selected?.server?.id===id){
            pageDirtyChanged(false);
            await select(null);
            if(!mounted.current || snapshot!==state.current.identity)return;
            setChannels([]);setChannelNext(null);setQuery('');
            setDepartment(departments.find(row=>row.id===core.activeAssignment?.unitId)?.id || departments[0]?.id || 'independent');
        }
        setNotice('Servidor privado eliminado.');
    }
    async function loadMessages(signal, next = null) {
        const snapshot = state.current;
        if (!snapshot.selected || snapshot.channelTab!=="messages") return;
        const page = await channelApi.messages(snapshot.selected.id, snapshot.parent?.id, next, {signal});
        if (signal.aborted || !mounted.current || snapshot.key !== state.current.key) return;
        setSelected(current=>current?.id===page.channel.id ? mergeChannelDetails(current,page.channel) : current);
        setMessages(current => mergeChannelMessages(current,page.results,{recent:!next}));
        if(page.thread && snapshot.parent)setParent(current=>current?.id===page.thread.parent_id ? mergeChannelMessage(current,threadPreferenceMessage(current,page.thread)):current);
        if(page.thread_source && snapshot.parent)setParent(current=>current?.id===page.thread_source.id ? mergeChannelMessage(current,page.thread_source):current);
        setOlder(page.next); setLoading(false);
        const cachedEdit=editCache.current.get(snapshot.key);if(cachedEdit){const source=page.results.find(row=>row.id===cachedEdit.id);setEdit(source?.can_edit && source.version===cachedEdit.version ? {...source,body:cachedEdit.body}:{...cachedEdit,can_edit:false,conflict:true});}
    }
    useEffect(() => {
        mounted.current = true;
        clearPrivateState();setDepartment("");setServers([]);setServerNext(null);setServerLoading(false);
        if (!allowed) {setChannels([]); setDepartments([]);setServers([]); setCanCreateIndependent(false); return () => {mounted.current = false;};}
        const initial = new AbortController();
        channelApi.departments({signal:initial.signal}).then(page => {if (!initial.signal.aborted) {setDepartments(page.results);setDepartment(current=>current || page.results.find(row=>row.id===core.activeAssignment?.unitId)?.id || page.results[0]?.id || "independent");setCanCreateIndependent(page.can_create_independent === true);}}).catch(report);
        channelApi.servers({signal:initial.signal}).then(page=>{if(!initial.signal.aborted){setServers(page.results);setServerNext(page.next);}}).catch(report);
        refresh.current = createChannelRefresh(async signal => {await load(signal); await loadMessages(signal);}, report);
        const reactionRefresh=createChannelRefresh(signal=>loadMessages(signal),report);
        const organizationRefresh=createChannelRefresh(signal=>load(signal),report);
        refresh.current.request();
        const update = event => {
            const channel = event.detail?.payload;
            if(channel?.kind==='channel.categories_changed'){if(channel.scope===state.current.department)organizationRefresh.request();return;}
            if(channel?.kind?.startsWith("page.") || channel?.kind==='automation.changed')return;
            if(channel?.kind==='reactions.updated'){
                if(channel.channel_id===state.current.selected?.id)reactionRefresh.request();
                return;
            }
            if (!channel || channel.kind?.startsWith("channel.") || channel.channel_id === state.current.selected?.id) refresh.current.request();
        };
        window.addEventListener("bold:slack-event", update);
        window.addEventListener("bold:messaging-reconnect", update);
        window.addEventListener("bold:slack-collection-change", update);
        return () => {mounted.current = false; initial.abort(); reads.current?.abort(); writes.current?.abort();followWrite.current?.abort();threadFollowWrite.current?.abort(); openingTask.current?.abort();refresh.current?.dispose();reactionRefresh.dispose();organizationRefresh.dispose();
            threadStart.current?.abort();window.removeEventListener("bold:slack-collection-change", update);window.removeEventListener("bold:slack-event", update); window.removeEventListener("bold:messaging-reconnect", update);};
    }, [allowed, core.authorizationRevision,core.account?.id,core.activeAssignment?.id]);
    useEffect(() => {
        if (!allowed) return;
        reads.current?.abort(); const controller = new AbortController(); reads.current = controller;
        setLoading(true);
        const timer=setTimeout(()=>load(controller.signal).catch(report).finally(() => {if (!controller.signal.aborted) setLoading(false);}),query ? 180 : 0);
        return () => {clearTimeout(timer);controller.abort();};
    }, [allowed, archived, query,department]);
    useEffect(() => {
        if (!allowed || !selected || channelTab!=="messages") return;
        const controller = new AbortController();
        setLoading(true);
        loadMessages(controller.signal).catch(err => {if ([403,404].includes(err.status)) {setMessages([]); setSelected(null);} report(err);}).finally(() => {if (!controller.signal.aborted) setLoading(false);});
        return () => controller.abort();
    }, [allowed, selected?.id, parent?.id,channelTab]);
    function jumpToLatest() {stickToBottom.current=true;setNewBelow(false);viewport.current?.scrollTo?.({top:viewport.current.scrollHeight,behavior:"auto"});}
    useLayoutEffect(()=>{stickToBottom.current=true;forceToBottom.current=false;lastMessage.current=null;setNewBelow(false);},[selected?.id,parent?.id]);
    useLayoutEffect(()=>{const latest=messages.at(-1)?.id;if(stickToBottom.current || forceToBottom.current)jumpToLatest();else if(lastMessage.current && latest!==lastMessage.current)setNewBelow(true);forceToBottom.current=false;lastMessage.current=latest;},[selected?.id,parent?.id,messages]);
    useEffect(()=>{
        const node=viewport.current;if(!node)return;let frame;
        const loaded=()=>{if(!stickToBottom.current)return;window.cancelAnimationFrame(frame);frame=window.requestAnimationFrame(()=>{if(stickToBottom.current && node.isConnected)node.scrollTo?.({top:node.scrollHeight,behavior:"auto"});});};
        node.addEventListener("bold:chat-media-loaded",loaded);
        return()=>{window.cancelAnimationFrame(frame);node.removeEventListener("bold:chat-media-loaded",loaded);};
    },[selected?.id,parent?.id]);
    useEffect(() => {field.current?.focus();}, [edit?.id, parent?.id]);
    useLayoutEffect(()=>{const node=field.current;if(!node)return;node.style.height='';if(draft){node.style.height='auto';node.style.height=`${Math.min(112,node.scrollHeight)}px`;}},[draft,key,channelTab]);
    function applyPersonalState(value) {
        if(!mounted.current || !value?.channel) return;
        const row=value.channel;
        setSelected(current=>current?.id===row.id ? mergeChannelDetails(current,row) : current);
        setChannels(current=>current.map(channel=>channel.id===row.id ? mergeChannelDetails(channel,row) : channel));
        window.dispatchEvent(new Event("bold:slack-state"));
    }
    const markViewRead=useChannelReader({channelId:selected?.id,parentId:parent?.id,messages,viewport,enabled:allowed && channelTab==="messages" && !!selected && !loading && !iconEditor && !serverEditor && !editor && !taskPicker && !imageEditor && !mentionPicker && !libraryOpen && !historyOpen && !catalogOpen,
        onRead:applyPersonalState,onError:err=>{if([401,403,404].includes(err.status)) report(err);else if(mounted.current)setError("No se pudo confirmar la lectura. Conservamos los indicadores; vuelve a intentarlo dentro de un minuto.");}});
    async function toggleFollowing() {
        if(followWrite.current || !selected) return;
        const controller=new AbortController();followWrite.current=controller;setFollowingBusy(true);setError("");
        try {const row=await channelApi.follow(selected.id,!selected.following,{signal:controller.signal});if(!controller.signal.aborted){applyPersonalState({channel:row});if(state.current.selected?.id===row.id)setNotice(row.following ? "Sigues este canal. Recibirás avisos de sus mensajes nuevos." : "Dejaste de seguir el canal. Los hilos que sigues mantienen sus avisos; el historial y los no leídos se conservan.");}}
        catch(err){if(!controller.signal.aborted){if([401,403,404].includes(err.status))report(err);else if(mounted.current)setError(followError(err));}}
        finally{if(followWrite.current===controller)followWrite.current=null;if(mounted.current)setFollowingBusy(false);}
    }
    async function toggleThreadFollowing(){
        if(threadFollowWrite.current || !parent || !selected)return;
        const controller=new AbortController(),snapshot=state.current;
        threadFollowWrite.current=controller;setThreadFollowingBusy(true);setError("");
        try{
            const value=await channelApi.followThread(selected.id,parent.id,!parent.thread_following,{signal:controller.signal});
            if(!controller.signal.aborted && mounted.current && state.current.key===snapshot.key){
                setParent(current=>current?.id===value.parent_id ? mergeChannelMessage(current,threadPreferenceMessage(current,value)):current);
                setNotice(value.following ? "Sigues este hilo. Recibirás avisos de sus respuestas nuevas, según tus preferencias de notificación.":state.current.selected.following ? "Dejaste de seguir el hilo por separado; el canal seguido sigue activando sus avisos.":"Dejaste de seguir este hilo. Su historial y los no leídos se conservan.");
            }
        }catch(err){if(!controller.signal.aborted && mounted.current && state.current.key===snapshot.key){if([401,403,404].includes(err.status))report(err);else setError(followError(err));}}
        finally{if(threadFollowWrite.current===controller){threadFollowWrite.current=null;if(mounted.current)setThreadFollowingBusy(false);}}
    }
    function openThread(message){
        if(busy.current || recording || startingThread)return;
        if(state.current.parent?.id===message.id){setParent(current=>mergeChannelMessage(current,message));refresh.current?.request();return;}
        state.current={...state.current,parent:message,key:`${selected.id}:${message.id}`};
        setParent(message);setThreadName('');setEdit(null);setMessages([]);setOlder(null);setLoading(true);
    }
    async function openCatalogThread(message){
        const snapshot=state.current;
        if(!await mayLeavePage() || snapshot.identity!==state.current.identity || snapshot.key!==state.current.key)return;
        setChannelTab('messages');pageDirtyChanged(false);openThread(message);
    }
    function returnToChannel(message){
        if(busy.current || recording || startingThread)return;
        state.current={...state.current,parent:null,key:`${selected.id}:`};
        setParent(null);setThreadName('');setMessages([]);setOlder(null);setLoading(true);setEdit(message || null);
        if(message)editCache.current.set(`${selected.id}:`,message);
    }
    function messageChanged(message){
        setMessages(current=>current.map(row=>row.id===message.id ? mergeChannelMessage(row,message):row));
        setParent(current=>current?.id===message.id ? mergeChannelMessage(current,message):current);
    }
    async function startNamedThread(){
        if(threadStart.current || !parent || !selected?.can_send)return false;
        const controller=new AbortController(),snapshot=state.current;threadStart.current=controller;setStartingThread(true);setError('');
        try{const result=await channelApi.startThread(selected.id,parent.id,threadName.trim(),{signal:controller.signal});if(!controller.signal.aborted && mounted.current && snapshot.key===state.current.key){messageChanged(result.message);setThreadName('');window.dispatchEvent(new CustomEvent('bold:slack-collection-change',{detail:{channel_id:selected.id}}));return true;}}
        catch(err){if(!controller.signal.aborted && snapshot.key===state.current.key)report(err);}
        finally{if(threadStart.current===controller){threadStart.current=null;if(mounted.current)setStartingThread(false);}}
        return false;
    }
    async function openChannelTarget(target,{signal}={}){
            const channel=await channelApi.detail(target.channel_id,{signal});
            const thread=target.parent_id ? (await channelApi.message(channel.id,target.parent_id,{signal})).message : null;
            if(signal?.aborted || !mounted.current) return false;
            if(thread?.parent_id) throw Error("La referencia no es un hilo principal.");
            if(target.page_id){
                if(channel.id!==state.current.selected?.id && await select(channel,{signal})===false)return false;
                if(signal?.aborted || !mounted.current)return false;
                setSelected(channel);setChannelTab("pages");setPageTarget({id:target.page_id,block_id:target.block_id,requestId:target.requestId});return true;
            }
            if(state.current.channelTab==="messages" && state.current.key===`${channel.id}:${thread?.id || ""}`) {
                setSelected(current=>mergeChannelDetails(current,channel));if(thread)setParent(thread);jumpToLatest();refresh.current?.request();return true;
            }
            if(await select(channel,{signal})===false)return false;
            if(signal?.aborted || !mounted.current)return false;
            if(thread){state.current={...state.current,parent:thread,key:`${channel.id}:${thread.id}`};setMessages([]);setOlder(null);setLoading(true);setParent(thread);refresh.current?.request();}
            return true;
    }
    useEffect(()=>{
        const target=shell.slack_target;
        if(!allowed || !target?.channel_id || openedTarget.current===target.requestId || sending || recording || editor || taskPicker || imageEditor || mentionPicker) return;
        const controller=new AbortController();
        openedTarget.current=target.requestId;
        openChannelTarget(target,{signal:controller.signal}).catch(err=>{if(!controller.signal.aborted)report(err);});
        return ()=>controller.abort();
    },[allowed,identity,shell.slack_target?.requestId,sending,recording,!!editor,taskPicker,!!imageEditor,!!mentionPicker]);

    async function send(event) {
        event.preventDefault();
        if(threadReadOnly)return;
        if (busy.current || recording || composerRecovery.blocked || edit?.conflict || edit?.can_edit===false || !(draft.trim() || draftTask || (!edit && attachments.length) || edit?.media) || !selected?.can_send) return;
        if(startingThread)return;
        if(!edit && parent && !parent.thread_started_at && threadName.trim() && !await startNamedThread())return;
        if (!edit && attachments.length) {await sendAttachments();return;}
        const snapshot = state.current, currentEdit = edit;
        const retryKey = currentEdit ? `edit:${currentEdit.id}` : snapshot.key;
        let attempt = retries.current.get(retryKey);
        if (!attempt) {attempt = currentEdit ? {body:draft.trim(),version:currentEdit.version} : {body:draft.trim(),parent_id:snapshot.parent?.id || null,client_id:crypto.randomUUID(),...(draftTask ? {task_id:draftTask.id} : {})}; retries.current.set(retryKey,attempt);}
        busy.current = true; setSending(true); setError(""); setNotice(""); const controller=new AbortController();writes.current=controller;
        try {
            const options = {signal:controller.signal};
            const result = currentEdit ? await channelApi.edit(snapshot.selected.id,currentEdit.id,attempt,options) : await channelApi.send(snapshot.selected.id,attempt,options);
            if (!mounted.current || controller.signal.aborted || snapshot.key!==state.current.key) return;
            retries.current.delete(retryKey);
            if (currentEdit) {editCache.current.delete(snapshot.key);setEdit(null);} else {setDrafts(current => ({...current,[snapshot.key]:""}));setTaskDrafts(current=>({...current,[snapshot.key]:null}));}
            if(!currentEdit)forceToBottom.current=true;
            setMessages(current => mergeChannelMessages(current,[result.message]));
            setNotice(currentEdit ? "Mensaje actualizado." : "Mensaje enviado.");
        } catch (err) {
            if (controller.signal.aborted) return;
            if ([400,403,404,409,429].includes(err.status)) retries.current.delete(retryKey);
            if (currentEdit && err.status === 409) {setEdit(current => current && {...current, conflict:true}); refresh.current?.request();}
            if (!currentEdit && attempt.task_id && err.status===404) {
                setTaskDrafts(current=>({...current,[snapshot.key]:null}));
                setError("La tarea ya no está disponible. Quitamos su referencia y conservamos el texto; puedes seleccionar otra tarea.");
                refresh.current?.request();
            } else report(err);
        } finally {busy.current = false; if (mounted.current) setSending(false);}
    }
    async function discardPreparation(){
        const snapshot=state.current,item=activeMedia;
        if(!item?.attempted || busy.current || recording || edit || loading || composerRecovery.blocked || !allowed)return;
        if(!await confirmBold('¿Descartar esta preparación? Conservaremos el archivo y su texto para revisarlos o quitarlos. Si el mensaje ya se publicó, se recuperará sin eliminarlo.'))return;
        if(!mounted.current || snapshot.identity!==state.current.identity || snapshot.key!==state.current.key || busy.current)return;
        const controller=new AbortController();writes.current=controller;busy.current=true;setDiscarding(true);setError('');
        try{
            const result=await channelApi.discardMedia(snapshot.selected.id,item.attempt.client_id,{signal:controller.signal});
            if(controller.signal.aborted || !mounted.current || snapshot.identity!==state.current.identity || snapshot.key!==state.current.key)return;
            if(result.outcome==='published'){
                setAttachments(snapshot.key,items=>items.filter(row=>row.id!==item.id));
                if((result.message.parent_id || null)===(snapshot.parent?.id || null))setMessages(current=>mergeChannelMessages(current,[result.message]));
                refresh.current?.request();setNotice('El mensaje ya estaba publicado. No se eliminó ni se volvió a enviar.');
            }else{
                const nextId=crypto.randomUUID();setAttachments(snapshot.key,items=>items.map(row=>row.id===item.id ? {...unlockRejectedChannelMedia(row),id:nextId}:row));setActiveImage(nextId);
                setNotice('Preparación descartada. Conservamos el archivo y su texto; puedes editarlos, quitarlos o iniciar otro envío.');
            }
        }catch(err){if(!controller.signal.aborted && snapshot.identity===state.current.identity && snapshot.key===state.current.key)report(err);}
        finally{if(writes.current===controller){busy.current=false;if(mounted.current)setDiscarding(false);}}
    }

    async function sendAttachments() {
        if(threadReadOnly)return;
        const snapshot=state.current, controller=new AbortController();writes.current=controller;
        busy.current=true;setSending(true);setError("");setNotice("");
        let sent=0, taskId=draftTask?.id;
        try {
            const batch=mediaState.current[snapshot.key] || [];
            for (const item of batch) {
                if (controller.signal.aborted || !mounted.current) return;
                const locked=lockChannelMedia(item,{parentId:snapshot.parent?.id,taskId});
                setAttachments(snapshot.key,items=>items.map(row=>row.id===item.id ? locked : row));
                try {
                    const result=await channelApi.sendMedia(snapshot.selected.id,locked.attempt,locked.file,{signal:controller.signal,
                        onStage:value=>{if(mounted.current && !controller.signal.aborted && state.current.key===snapshot.key)setStagedUpload(value);}});
                    if (controller.signal.aborted || !mounted.current) return;
                    setAttachments(snapshot.key,items=>items.filter(row=>row.id!==item.id));
                    forceToBottom.current=true;
                    setMessages(current=>mergeChannelMessages(current,[result.message]));
                    if (locked.attempt.task_id) {setTaskDrafts(current=>({...current,[snapshot.key]:null}));taskId=null;}
                    sent++;setNotice(`${sent} de ${batch.length} adjuntos confirmados.`);
                } catch(err) {
                    if (controller.signal.aborted) return;
                    if (canReviseFailedImage(err)) {
                        const renewed=renewRejectedMedia(locked,err);
                        setAttachments(snapshot.key,items=>items.map(row=>row.id===item.id ? renewed : row));
                        setActiveImage(renewed.id);
                    }
                    // A rejected task reference has not committed a message. Drop
                    // only that reference, retaining both the file and caption.
                    if (err.status===404 && locked.attempt.task_id) {
                        const nextId=crypto.randomUUID();
                        setAttachments(snapshot.key,items=>items.map(row=>row.id===item.id ? {...unlockRejectedChannelMedia(locked),id:nextId} : row));setActiveImage(nextId);
                        setTaskDrafts(current=>({...current,[snapshot.key]:null}));
                        setError("La tarea ya no está disponible. Conservamos el adjunto y su texto; selecciona otra tarea o vuelve a enviar sin ella.");refresh.current?.request();
                    } else if (err.name!=="AbortError" && mounted.current) {
                        if ([401,403,404].includes(err.status)) report(err);
                        else setError(`${sent ? `${sent} adjuntos confirmados. ` : ""}${channelError(err)} Los restantes siguen en la cola.`);
                    }
                    return;
                }
            }
            if (mounted.current) {setActiveImage(null);setNotice(`${sent} ${sent===1 ? "adjunto enviado" : "adjuntos enviados"}.`);field.current?.focus();}
        } finally {busy.current=false;if(mounted.current){setSending(false);setStagedUpload(null);}}
    }
    async function archive() {
        if (busy.current || recording) return;
        busy.current = true; setSending(true); setError("");const controller=new AbortController();writes.current=controller;const channelId=selected.id;
        try {
            const updated = await channelApi.update(channelId, {archived:!selected.archived_at,version:selected.version}, {signal:controller.signal});
            if (mounted.current && !controller.signal.aborted && state.current.selected?.id===channelId) {setSelected(updated); setNotice(updated.archived_at ? "Canal archivado; se conserva el historial." : "Canal restaurado."); refresh.current?.request();}
        } catch (err) {report(err);} finally {busy.current = false; if (mounted.current) setSending(false);}
    }
    async function openTask(task) {
        if (!task?.available || openingTask.current) return;
        const controller=new AbortController();openingTask.current=controller;setOpeningTaskId(task.id);setError("");
        try {
            // The shared detail panel reloads authorized data without leaving Slack.
            await channelApi.task(task.id,{signal:controller.signal});
            if (mounted.current && !controller.signal.aborted) window.dispatchEvent(new CustomEvent("bold:brand-resource",{detail:{task:task.id,context:"slack"}}));
        } catch(err) {if (mounted.current && !controller.signal.aborted) {setError("La tarea no está disponible o perdió acceso. Actualizamos su referencia; el canal sigue abierto.");refresh.current?.request();}}
        finally {if (openingTask.current===controller) openingTask.current=null;if (mounted.current) setOpeningTaskId(null);}
    }
    const fixedAttempt = retries.current.has(edit ? `edit:${edit.id}` : key) || (!edit && !!activeMedia?.attempted);
    const threadReadOnly=!!parent && (parent.can_reply_thread===false || !!parent.thread_closed_at || parent.thread_locked || !!parent.thread_deleted_at);
    const composerLocked=sending || recording || composerRecovery.blocked || !selected?.can_send || threadReadOnly || fixedAttempt || edit?.conflict;
    const sidebarLocked=!!(iconEditor || serverEditor || libraryOpen || historyOpen || editor || accessEditor || taskPicker || imageEditor || mentionPicker || recording);
    const mentionKey=`${identity}:${key}:${edit?.id || "draft"}:${edit?.version || ""}:${activeMedia?.id || "text"}`;
    const mentionBlocked=composerLocked || loading || sidebarLocked || catalogOpen || startingThread || channelTab!=="messages" || pendingMedia;
    mentionLive.current={key:mentionKey,body:draft,blocked:composerLocked || loading || !!core.securityUncertain};
    const inlineOpen=inlineMention?.key===mentionKey && !mentionBlocked,inlineListId="slack_inline_mentions";
    useEffect(()=>{if(mentionBlocked)setInlineMention(null);},[mentionBlocked]);
    function changeComposer(value){
        if(edit)setEdit(current=>({...current,body:value}));
        else if(activeMedia)setAttachments(key,items=>captionQueuedImage(items,activeMedia.id,value));
        else setDrafts(current=>({...current,[key]:value}));
    }
    function findInlineMention(input){
        const match=!mentionBlocked && chatMentionAtCaret(input.value,input.selectionStart,input.selectionEnd);
        setInlineMention(match ? {...match,key:mentionKey}:null);
    }
    function chooseMention(person,target){
        const current=mentionLive.current;
        if(!mounted.current || current.key!==target.key || current.blocked){setMentionPicker(null);setInlineMention(null);return;}
        try{const value=insertMention(current.body,person,target.start,target.end),context=current.key;
            changeComposer(value.text);setMentionPicker(null);setInlineMention(null);
            window.requestAnimationFrame(()=>{if(mentionLive.current?.key===context){field.current?.focus();field.current?.setSelectionRange(value.caret,value.caret);}});
        }catch(err){setError(err.message);setMentionPicker(null);setInlineMention(null);}
    }
    const fileTransfer=useFileTransfer({field,context:`${identity}:${key}`,disabled:composerLocked || loading || !!edit || pendingMedia || sidebarLocked || catalogOpen || startingThread,onFiles:addFiles});
    if (!allowed) return <section className="slack_module"><p role="status">Slack requiere una sesión autorizada y permisos de acceso. Si cambiaste de cargo, vuelve a comprobar tu sesión.</p></section>;
    const groups=[...new Map([
        ...departments.map(row=>({...row,departmentId:row.id})),
        ...servers.map(row=>({...row,id:`server:${row.id}`,serverId:row.id})),
        ...(selected?.server && !servers.some(row=>row.id===selected.server.id) ? [{...selected.server,id:`server:${selected.server.id}`,serverId:selected.server.id}]:[]),
        {id:'independent',name:'Independientes',can_create:canCreateIndependent},
    ].map(row=>[row.id,row])).values()];
    const activeServer=groups.find(row=>row.id===department) || groups[0];
    const matchingChannels=channels.filter(row=>channelServerKey(row)===activeServer?.id && channelMatches(row.name,query));
    async function chooseServer(row){
        if(row.id===department){setExplorerOpen(true);return;}
        if(await select(null)===false)return false;
        setChannels([]);setChannelNext(null);setDepartment(row.id);setQuery('');setExplorerOpen(true);
    }
    const createInServer=(categoryId=null)=>setEditor({create:true,scope:{...activeServer,categoryId:typeof categoryId==='string' ? categoryId:null}});
    const manageAccess=()=>selected?.server ? setServerEditor(selected.server):setAccessEditor({channel:selected});
    function unreadFor(row) {
        const summary=core.slack?.unread;
        if(summary?.ready && (Object.hasOwn(summary.byChannel,row.id) || !summary.truncated)) return summary.byChannel[row.id] || 0;
        return row.unread_count || 0;
    }
    const hideExplorer=()=>{setExplorerOpen(false);railSearch.current?.focus();};
    return <section className={`slack_module ${selected ? "slack_channel_open" : ""} ${explorerOpen ? "slack_explorer_open":""}`} aria-label="Slack de BOLD">
        <ServerRail key={identity} groups={groups} activeId={activeServer?.id} identity={identity} homeRef={railSearch} locked={sidebarLocked} disabled={sending || recording} canCreate={canCreateIndependent} next={serverNext} loading={serverLoading} onMore={()=>reloadCatalog(serverNext)} onSelect={async row=>{if(row.private)setServers(current=>[...current.filter(item=>item.id!==row.serverId),{...row,id:row.serverId}]);return chooseServer(row);}} onIcon={setIconEditor} onCreate={()=>setServerEditor({create:true})} onChat={()=>shell.set_active_module('messaging')}/>
        <aside id="slack_channel_browser" className="slack_sidebar" aria-label="Departamentos y canales" inert={sidebarLocked ? true:undefined} onKeyDown={event=>{if(event.key==='Escape' && selected){event.stopPropagation();hideExplorer();}}}>
            <header><div><h1 title={activeServer?.name}>{activeServer?.name || "Slack"}</h1>{activeServer?.private && <small>Privado</small>}</div>{activeServer?.can_edit_icon && <button type="button" aria-label="Cambiar imagen del servidor" title="Cambiar imagen del servidor" disabled={sending || recording} onClick={()=>setIconEditor(activeServer)}><ImagePlus size={17}/></button>}{activeServer?.private && activeServer.can_manage && <button type="button" aria-label="Configurar servidor" title="Invitaciones y configuración" onClick={()=>setServerEditor({...activeServer,id:activeServer.serverId})}><Settings2 size={17}/></button>}<button type="button" aria-label="Ocultar canales" title="Ocultar canales" onClick={hideExplorer}><PanelLeftClose size={18} aria-hidden="true"/></button></header>
            <div className="slack_channel_search"><span className="slack_field_label">Buscar canal</span><SearchField label="Buscar canal" value={query} onChange={setQuery} placeholder="Nombre del canal"/></div>
            <details className="slack_filters"><summary><ListFilter size={15} aria-hidden="true"/>Filtrar canales</summary><div><label className="slack_archive_filter"><input type="checkbox" checked={archived} onChange={event=>setArchived(event.target.checked)}/> Incluir archivados</label></div></details>
            <ChannelCategories key={`${identity}:${activeServer?.id}`} server={activeServer} channels={matchingChannels} selectedId={selected?.id} loading={loading} query={query} disabled={sending || recording} unreadFor={unreadFor} onSelect={select} onCreateChannel={createInServer} onDenied={report} onChannelChanged={row=>{setChannels(current=>current.map(item=>item.id===row.id ? mergeChannelDetails(item,row):item));setSelected(current=>current?.id===row.id ? mergeChannelDetails(current,row):current);}}/>
            {channelNext && <button type="button" disabled={loading} onClick={async () => {setLoading(true);const controller=reads.current,querySnapshot=query,serverSnapshot=department;try {const page = await channelApi.list(archived,channelNext,{signal:controller.signal},{...channelServerFilters(serverSnapshot),...(query ? {q:query}:{})}); if (!controller.signal.aborted && mounted.current && querySnapshot===state.current.query && serverSnapshot===state.current.department) {setChannels(current => [...new Map([...current,...page.results].map(row => [row.id,row])).values()]); setChannelNext(page.next);}} catch(err) {if(!controller.signal.aborted)report(err);} finally {if (mounted.current && !controller.signal.aborted) setLoading(false);}}}>Cargar más canales</button>}
            <div className="slack_sidebar_shortcuts">
                <button type="button" aria-label="Buscar en el historial" disabled={sending || recording} onClick={()=>setHistoryOpen(true)}><History size={16} aria-hidden="true"/><span>Historial</span></button>
                <button type="button" aria-label="Mis guardados" disabled={sending || recording} onClick={()=>setHistoryOpen('saved')}><Bookmark size={16} aria-hidden="true"/><span>Guardados</span></button>
                <button type="button" aria-label="Hilos que sigo" disabled={sending || recording} onClick={()=>setHistoryOpen('threads')}><MessageSquare size={16} aria-hidden="true"/><span>Hilos</span></button>
                <button type="button" aria-label="Marcados como no leídos" disabled={sending || recording} onClick={()=>setHistoryOpen('unread')}><Mail size={16} aria-hidden="true"/><span>Sin leer</span></button>
            </div>
            <button type="button" className="slack_access_shortcut" disabled={sending || recording || (activeServer?.private && !activeServer.can_manage)} onClick={()=>activeServer?.private ? setServerEditor({...activeServer,id:activeServer.serverId}):setAccessEditor({channel:null})}><LockKeyhole size={16} aria-hidden="true"/>{activeServer?.private ? "Invitaciones del servidor":"Administrar acceso"}</button>
        </aside>
        <main className="slack_main" inert={iconEditor || serverEditor || libraryOpen || historyOpen || editor || accessEditor || taskPicker || imageEditor || mentionPicker ? true : undefined}>

            <header className="slack_header"><button type="button" className="slack_back" aria-label="Ver canales" disabled={sending || recording} onClick={() => setExplorerOpen(true)}><ArrowLeft size={20} aria-hidden="true"/></button><div>{selected ? <><h2># {selected.name}</h2><Department value={selected.server || selected.department}/><p title={selected.description || ""}>{selected.description || "Comparte contexto y mantén las conversaciones organizadas."}</p></> : <><h2>El trabajo, en conversación</h2><p>Elige un canal o crea uno para tu departamento.</p></>}</div>{selected && <ChannelCatalog key={`${identity}:${selected.id}`} channel={selected} disabled={sending || recording || startingThread} onThread={openCatalogThread} onMessage={message=>setHistoryOpen({target:{kind:"channel",channel_id:selected.id,message_id:message.id,parent_id:message.parent_id}})} onDenied={report} onOpenChange={setCatalogOpen} openRequest={catalogRequest} onThreadChange={messageChanged} onRead={applyPersonalState}/>}{selected?.can_manage_access && <button type="button" className="slack_privacy" aria-label="Privacidad e invitaciones" title="Privacidad e invitaciones" disabled={sending || recording} onClick={manageAccess}><LockKeyhole size={17} aria-hidden="true"/></button>}<button type="button" className="slack_desktop_action" aria-label="Actualizar canales" onClick={()=>reloadCatalog()}><RefreshCw size={18} aria-hidden="true"/></button>{selected?.can_manage && <><button type="button" className="slack_desktop_action" aria-label="Configurar canal" disabled={sending || recording} onClick={() => setEditor({channel:selected})}><Settings2 size={18} aria-hidden="true"/></button><button type="button" className="slack_desktop_action" aria-label={selected.archived_at ? "Restaurar canal" : "Archivar canal"} disabled={sending || recording} onClick={archive}><Archive size={18} aria-hidden="true"/></button></>}<details className="slack_mobile_menu"><summary aria-label="Opciones del canal"><MoreHorizontal size={20} aria-hidden="true"/></summary><div role="group" aria-label="Acciones del canal">{selected && <button type="button" disabled={sending || recording} onClick={event=>{event.currentTarget.closest("details").open=false;setLibraryOpen({id:selected.id,title:`# ${selected.name}`,parent:channelTab==="messages" ? parent?.id:null,identity});}}><Paperclip size={17} aria-hidden="true"/>Archivos y enlaces</button>}{selected?.can_manage_access && <button type="button" disabled={sending || recording} onClick={event=>{event.currentTarget.closest('details').open=false;manageAccess();}}><LockKeyhole size={17} aria-hidden="true"/>Privacidad e invitaciones</button>}<button type="button" onClick={event=>{event.currentTarget.closest("details").open=false;reloadCatalog();}}><RefreshCw size={17} aria-hidden="true"/>Actualizar canales</button>{selected?.can_manage && <><button type="button" disabled={sending || recording} onClick={event=>{event.currentTarget.closest("details").open=false;setEditor({channel:selected});}}><Settings2 size={17} aria-hidden="true"/>Configurar canal</button><button type="button" disabled={sending || recording} onClick={event=>{event.currentTarget.closest("details").open=false;archive();}}><Archive size={17} aria-hidden="true"/>{selected.archived_at ? "Restaurar canal" : "Archivar canal"}</button></>}</div></details></header>
            {!selected && <section className="slack_welcome"><Hash size={34} aria-hidden="true"/><h3>Un espacio para cada conversación</h3><p>Elige un servidor de la barra y abre uno de sus canales de texto para ver mensajes y páginas.</p><div><button type="button" onClick={()=>setExplorerOpen(true)}><Search size={16} aria-hidden="true"/>Explorar canales</button>{activeServer?.can_create && <button type="button" className="slack_primary" disabled={sending || recording} onClick={createInServer}><Plus size={16} aria-hidden="true"/>Crear un canal</button>}</div></section>}
            {error && <p role="alert" className="slack_error">{error}</p>}
            {notice && <p role="status" className="slack_notice">{notice}</p>}
            {selected && <nav className="slack_channel_tabs" aria-label="Contenido del canal"><button type="button" aria-pressed={channelTab==="messages"} disabled={sending || recording} onClick={()=>changeTab("messages")}>Mensajes</button><button type="button" aria-pressed={channelTab==="pages"} disabled={sending || recording} onClick={()=>changeTab("pages")}>Páginas</button>{selected.can_read_automations===true && <button type="button" aria-pressed={channelTab==='automations'} disabled={sending || recording} onClick={()=>changeTab('automations')}>Automatizaciones</button>}<button type="button" disabled={sending || recording} onClick={()=>setLibraryOpen({id:selected.id,title:`# ${selected.name}`,parent:channelTab==='messages' ? parent?.id:null,identity})}>Archivos y enlaces</button></nav>}
            {selected && channelTab==='automations' && <Suspense fallback={<p role="status">Abriendo automatizaciones…</p>}><ChannelAutomations key={`${identity}:${selected.id}`} channel={selected} onDirty={pageDirtyChanged} onDenied={report}/></Suspense>}
            {selected && channelTab==="pages" && <Suspense fallback={<p role="status">Abriendo páginas…</p>}><ChannelPages key={`${selected.id}:${core.authorizationRevision}`} channel={selected} targetPage={pageTarget} onDirty={pageDirtyChanged} onDenied={report} onTask={openTask} onNavigatePage={target=>shell.open_channel(target)} onShared={message=>{setMessages(current=>mergeChannelMessages(current,[message]));refresh.current?.request();}}/></Suspense>}
            {selected && channelTab==="messages" && <div className={`slack_conversation_split ${parent ? 'slack_thread_open':''}`}>
                {parent && <ChannelContext key={`${identity}:${selected.id}`} channel={selected} source={parent} disabled={sending || recording || startingThread} readerEnabled={allowed && !catalogOpen && !historyOpen && !libraryOpen && !editor && !taskPicker && !imageEditor && !mentionPicker && !iconEditor && !serverEditor} onThread={openThread} onReturn={returnToChannel} onTask={openTask} onPage={page=>{setChannelTab('pages');setPageTarget({id:page.id,requestId:crypto.randomUUID()});}} onRead={applyPersonalState} onDenied={report} onMessageChanged={messageChanged} onBrowseThreads={()=>setCatalogRequest(value=>value+1)}/>}
                <section className="slack_active_conversation bold_file_drop_target" aria-label={parent ? 'Panel del hilo':'Conversación principal'} {...fileTransfer.bindings}>
                {fileTransfer.dragging && <FileDropHint label={parent ? "Suelta archivos en este hilo":"Suelta archivos en este canal"}/>}
                <div className="slack_channel_actions"><MessageAgreements key={`${identity}:${selected.id}:${parent?.id || ''}`} kind="channel" containerId={selected.id} messages={parent ? [parent,...messages]:messages} more={older} loadingMessages={loading} disabled={sending || recording || loading} onOpenPage={target=>shell.open_channel(target)} onMore={async()=>{const c=new AbortController();reads.current?.abort();reads.current=c;setLoading(true);try{await loadMessages(c.signal,older);}catch(err){report(err);}finally{if(!c.signal.aborted)setLoading(false);}}}/><span className="slack_action_help">Seleccionar mensajes para una página de acuerdos</span>
                <button type="button" aria-label={selected.following ? "Dejar de seguir canal":"Seguir canal"} title={selected.following ? "Dejar de seguir canal":"Seguir canal"} aria-pressed={!!selected.following} disabled={followingBusy || sending || recording} onClick={toggleFollowing}>{selected.following ? <Bell size={17} aria-hidden="true"/> : <BellOff size={17} aria-hidden="true"/>}{followingBusy ? "Guardando…" : selected.following ? "Dejar de seguir canal" : "Seguir canal"}</button><button type="button" aria-label="Marcar vista como leída" title="Marcar vista como leída" disabled={loading || !messages.length} onClick={markViewRead}><CheckCheck size={17} aria-hidden="true"/>Marcar vista como leída</button></div>
                <ReadingReminderBanner scopeKey={parent ? 'thread:'+parent.id:'channel:'+selected.id} disabled={sending || recording} onOpen={target=>setHistoryOpen({unread:true,target})}/>
                {parent && <section className="slack_thread_context"><div><strong title={threadTitle(parent)}>Hilo · {threadTitle(parent)}</strong><div className="slack_thread_author"><span className="slack_avatar"><AvatarImage url={parent.author.avatar_url} initials={initials(parent.author.name)}/></span><small>{parent.author.name}</small></div><p>{parent.body ? <MentionText text={parent.body} mentions={parent.mentions}/>:parent.media ? parent.media.kind==="image" ? "Imagen compartida" : "Nota de voz" : parent.page ? "Página compartida" : "Tarea compartida"}</p>
                    {!parent.thread_started_at && !parent.reply_count && <div className="slack_thread_name"><label>Nombre del hilo <small>(opcional)</small><input aria-label="Nombre del hilo" placeholder={threadTitle(parent)} maxLength={120} value={threadName} disabled={sending || recording || startingThread || !selected.can_send} onChange={event=>setThreadName(event.target.value)}/></label><button type="button" className="slack_primary" disabled={sending || recording || startingThread || !selected.can_send} onClick={startNamedThread}>{startingThread ? 'Creando…':'Crear hilo'}</button></div>}
                    {parent.media && <MessageMedia message={parent} author={parent.author} fetchMedia={channelApi.media}/>}<div className="slack_thread_follow"><button type="button" aria-pressed={!!parent.thread_following} disabled={threadFollowingBusy || loading || sending || recording} onClick={toggleThreadFollowing}>{parent.thread_following ? <Bell size={17} aria-hidden="true"/>:<BellOff size={17} aria-hidden="true"/>}{threadFollowingBusy ? "Guardando seguimiento…":parent.thread_following ? "Dejar de seguir hilo":"Seguir hilo"}</button><small>{selected.following ? "El canal ya activa sus avisos.":"Seguir avisa solo de este hilo."}</small></div>
                </div><ThreadActions key={parent.id} channel={selected} message={parent} disabled={sending || recording || startingThread} onOpenChange={setCatalogOpen} onChange={messageChanged} onRead={applyPersonalState} onDenied={report}/><button type="button" disabled={sending || recording} onClick={()=>returnToChannel()} aria-label="Volver al canal"><X size={20} aria-hidden="true"/></button></section>}
                {threadReadOnly && <div className="slack_thread_readonly" role="status"><strong>{parent.thread_deleted_at ? 'Hilo en Eliminados':parent.thread_locked ? 'Hilo bloqueado':parent.thread_closed_at ? 'Hilo cerrado':'Hilo de solo lectura'}.</strong> El historial y tu borrador se conservan. Usa las opciones del hilo para reabrirlo cuando tengas permiso.</div>}
                <div ref={viewport} className="slack_messages" aria-label={parent ? "Respuestas del hilo" : "Mensajes del canal"} onScroll={event=>{const node=event.currentTarget;stickToBottom.current=node.scrollHeight-node.scrollTop-node.clientHeight<48;if(stickToBottom.current)setNewBelow(false);}}>
                    {older && <button type="button" disabled={loading} onClick={async () => {const controller = new AbortController(); reads.current?.abort(); reads.current = controller; setLoading(true); try {await loadMessages(controller.signal,older);} catch(err) {report(err);} finally {if (!controller.signal.aborted) setLoading(false);}}}>Cargar mensajes anteriores</button>}
                    {loading && <p role="status">Cargando mensajes…</p>}
                    {!loading && !messages.length && <div className="slack_empty"><Hash size={36} aria-hidden="true"/><h3>{parent ? "Inicia este hilo" : `Bienvenido a #${selected.name}`}</h3><p>Da contexto, comparte información y coordina el siguiente paso.</p></div>}
                    {messages.map((message,index) => <div key={message.id}>
                        {(!index || dayLabel(messages[index-1].created_at) !== dayLabel(message.created_at)) && <p className="slack_day">{dayLabel(message.created_at)}</p>}
                        <article data-slack-message={message.id} className={`slack_message ${message.author.employee_id === actorId ? "slack_mine" : ""}`}>
                            <button type="button" className="slack_avatar" disabled={message.author.is_bot || message.author.employee_id === actorId || sending || recording} aria-label={message.author.is_bot ? `${message.author.name}, asistente de inteligencia artificial` : `Abrir chat con ${message.author.name}`} onClick={() => shell.open_direct_chat(message.author)}><AvatarImage url={message.author.avatar_url} initials={initials(message.author.name)}/></button>
                            <div className="slack_message_card"><header><strong>{message.author.name}</strong><Department value={message.department}/><time dateTime={message.created_at} title={new Date(message.created_at).toLocaleString("es")}>{new Date(message.created_at).toLocaleTimeString("es",{hour:"2-digit",minute:"2-digit"})}</time>{message.edited_at && <small>editado</small>}</header>
                                {message.body && <p className="slack_message_body"><MentionText text={message.body} mentions={message.mentions}/></p>}
                                {message.media && <MessageMedia message={message} author={message.author} fetchMedia={channelApi.media}/>}
                                <MessageActions key={`${identity}:${message.id}`} kind="channel" containerId={selected.id} scopeKey={readingScope({kind:'channel',channel_id:selected.id,parent_id:message.parent_id})} message={message} disabled={sending || recording} canPin={selected.can_manage && selected.can_send} onPinChange={messageChanged} onDenied={report} onThread={!message.parent_id ? ()=>openThread(message):undefined} canEdit={message.can_edit && Date.now()<Date.parse(message.editable_until)} onEdit={()=>setEdit({...message})}/>
                                {message.page && (message.page.available ? <button type="button" className="slack_task_card" onClick={()=>{setChannelTab("pages");setPageTarget({id:message.page.id,requestId:crypto.randomUUID()});}}><MessageSquare size={20} aria-hidden="true"/><span><strong>{message.page.title}</strong><small>{message.page.archived ? "Página archivada":"Página del canal"}</small></span><span>Abrir página</span></button>:<p className="slack_task_unavailable">Página no disponible para tu asignación activa.</p>)}
                                {message.task && (message.task.available ? <button type="button" className="slack_task_card" disabled={!!openingTaskId} onClick={()=>openTask(message.task)}><CheckCheck size={22} aria-hidden="true"/><span><strong>{message.task.title}</strong><small>{openingTaskId===message.task.id ? "Verificando acceso…" : message.task.status}</small></span><span>Abrir tarea</span></button> : <p className="slack_task_unavailable"><LockKeyhole size={16} aria-hidden="true"/>Tarea no disponible para tu asignación activa</p>)}
                                {message.pinned_at && <small className="slack_pinned_label">Mensaje fijado</small>}{!parent && <ThreadNotice message={message} disabled={sending || recording} onBrowse={()=>setCatalogRequest(value=>value+1)}/>}
                            </div>
                        </article>
                    </div>)}
                </div>
                {newBelow && <button type="button" className="slack_jump_latest" onClick={jumpToLatest}><ArrowDown size={17} aria-hidden="true"/>Mensajes nuevos · Ir al último</button>}
                <ComposerRecovery draft={composerRecovery} disabled={sending || recording}/>
                <UploadStatus value={stagedUpload} onPause={()=>{writes.current?.abort();setNotice('Espera detenida. Conservamos los adjuntos y sus intentos; pulsa Enviar para comprobarlos y retomarlos.');}}/>
                {!edit && activeMedia?.attempted && <UploadDiscard filename={activeMedia.file.name} disabled={sending || recording || loading || !!composerRecovery.blocked || !allowed} onDiscard={discardPreparation}/>}
                <form inert={composerRecovery.blocked ? true:undefined} className="slack_composer" onSubmit={send} aria-busy={sending}>
                    {edit && <div className="slack_editing"><span>{edit.conflict ? "Otro cambio impide guardar esta versión. Copia tu texto, cancela y vuelve a editar." : "Editando tu mensaje"}</span><button type="button" disabled={sending} onClick={() => {editCache.current.delete(key);retries.current.delete(`edit:${edit.id}`); setEdit(null);}}>Cancelar edición</button></div>}
                    {selected.archived_at && <p>Canal archivado · historial de solo lectura.</p>}
                    {!edit && images.length>0 && <ImageQueue items={images} activeId={activeMedia?.id} disabled={sending || recording || !selected.can_send} canAdd={!pendingMedia} onSelect={setActiveImage} onEdit={setImageEditor} onRemove={item=>attachments.length===1 ? clearMedia() : setAttachments(key,items=>items.filter(row=>row.id!==item.id))} onAdd={()=>fileInput.current?.click()} onClear={clearMedia}/>}
                    {!edit && activeMedia && !images.length && <MediaDraft file={activeMedia.file} disabled={sending || recording || activeMedia.attempted || !selected.can_send} onRemove={clearMedia}/>}
                    <label htmlFor="slack_message">{!edit && activeMedia ? images.length ? "Texto de la imagen seleccionada" : activeMedia.file.type.startsWith("audio/") ? "Texto de la nota de voz" : "Texto del documento" : parent ? "Responder al hilo" : `Mensaje para #${selected.name}`}</label>
                    {draftTask && <div className="slack_task_draft"><span><CheckCheck size={18} aria-hidden="true"/>{draftTask.title || "Referencia a tarea"}</span>{!edit && <button type="button" disabled={sending || recording || fixedAttempt || pendingMedia} onClick={()=>setTaskDrafts(current=>({...current,[key]:null}))}>Quitar tarea</button>}</div>}
                    <textarea ref={field} id="slack_message" aria-describedby="slack_input_help" aria-autocomplete="list" aria-controls={inlineOpen ? inlineListId:undefined} aria-activedescendant={inlineOpen ? inlineActive:undefined} placeholder="Escribe aquí…" rows={1} maxLength={5000} value={draft} disabled={composerLocked} onChange={event=>{changeComposer(event.target.value);if(event.nativeEvent.isComposing)setInlineMention(null);else findInlineMention(event.currentTarget);}} onCompositionEnd={event=>findInlineMention(event.currentTarget)} onClick={event=>findInlineMention(event.currentTarget)} onKeyUp={event=>{if(["ArrowLeft","ArrowRight","Home","End"].includes(event.key))findInlineMention(event.currentTarget);}} onBlur={event=>{if(!inlinePanel.current?.contains(event.relatedTarget))setInlineMention(null);}} onKeyDown={event=>{if(enterSends({...event,isComposing:event.nativeEvent.isComposing},"send")){event.preventDefault();send(event);}}}/>

                    <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden aria-label="Seleccionar imágenes para el canal" disabled={composerLocked || !!edit || pendingMedia} onChange={event=>{addImages(event.target.files);event.target.value="";}}/>
                    <input ref={documentInput} type="file" accept={DOCUMENT_ACCEPT} hidden aria-label="Seleccionar documento para el canal" disabled={composerLocked || !!edit || pendingMedia} onChange={event=>{addFiles(event.target.files);event.target.value='';}}/>
                    <footer><div className="slack_composer_tools"><ComposerOptions key={`options:${key}`} disabled={composerLocked || loading || pendingMedia}><button type="button" aria-label="Mencionar a una persona" disabled={composerLocked || loading || pendingMedia} onClick={()=>{setInlineMention(null);setMentionPicker({key:mentionKey,start:field.current?.selectionStart ?? draft.length,end:field.current?.selectionEnd ?? draft.length});}}><AtSign size={20} aria-hidden="true"/><span>Mencionar persona</span></button>{!edit && <>
                        <button type="button" aria-label="Adjuntar imágenes al canal" disabled={composerLocked || loading || pendingMedia || attachments.some(item=>!item.file.type.startsWith("image/"))} onClick={()=>fileInput.current?.click()}><ImagePlus size={20} aria-hidden="true"/><span>Imagen</span></button>
                        <button type="button" aria-label="Adjuntar documento al canal" title={DOCUMENT_HINT} disabled={composerLocked || loading || pendingMedia || !!attachments.length} onClick={()=>documentInput.current?.click()}><Paperclip size={20} aria-hidden="true"/><span>Documento</span></button>
                        <button type="button" className="phone_transfer_launch" aria-label="Añadir desde el teléfono" title="Añadir desde el teléfono" disabled={composerLocked || loading || pendingMedia || images.length >= 10 || attachments.some(item=>!item.file.type.startsWith("image/"))} onClick={()=>setPhoneTarget(key)}><Smartphone size={20} aria-hidden="true"/><span>Desde el teléfono</span></button>
                        <button type="button" aria-label="Compartir tarea" disabled={composerLocked || loading || pendingMedia} onClick={()=>setTaskPicker(true)}><CheckCheck size={18} aria-hidden="true"/><span className="slack_tool_label">Compartir tarea</span></button>
                    </>}</ComposerOptions>{!edit && <VoiceRecorder key={key} disabled={composerLocked || loading || !!attachments.length} onReady={readyAudio} onError={setError} onRecording={setRecording}/>}</div><small id="slack_input_help">{fixedAttempt || pendingMedia ? "Envío sin confirmar: reintentar conserva el archivo y su identificador." : "Enter envía · Mayús+Enter: salto"}</small><button type="submit" className="slack_primary" aria-label={edit ? "Guardar mensaje":"Enviar mensaje al canal"} disabled={sending || recording || loading || threadReadOnly || !selected.can_send || !(draft.trim() || draftTask || (!edit && attachments.length) || edit?.media) || edit?.conflict}><Send size={18} aria-hidden="true"/>{sending ? discarding ? "Descartando…" : "Enviando…" : fixedAttempt || pendingMedia ? "Reintentar" : edit ? "Guardar" : attachments.length>1 ? `Enviar ${attachments.length}` : "Enviar"}</button></footer>
                </form>
                </section>
            </div>}
        </main>
        {editor && <ChannelEditor channel={editor.channel} scope={editor.scope} departments={departments} canCreateIndependent={canCreateIndependent} onClose={() => setEditor(null)} onSaved={row => {setEditor(null); if(!row.access_only){setChannels(current=>[...current.filter(item=>item.id!==row.id),mergeChannelDetails(current.find(item=>item.id===row.id),row)].sort((a,b)=>a.name.localeCompare(b.name,"es")));select(row);}refresh.current?.request();}}/>}
        {iconEditor && <ServerIconEditor server={iconEditor} onClose={()=>setIconEditor(null)} onSaved={value=>{const row=iconEditor;setIconEditor(null);if(row.private){setServers(current=>current.map(item=>item.id===row.serverId ? {...item,...value}:item));setSelected(current=>current?.server?.id===row.serverId ? {...current,server:{...current.server,...value}}:current);}else setDepartments(current=>current.map(item=>item.id===row.id ? {...item,...value}:item));}}/>}
        {serverEditor && <ServerEditor server={serverEditor.create ? null:serverEditor} onClose={()=>setServerEditor(null)} onSaved={serverSaved} onDeleted={serverDeleted}/>}
        {accessEditor && <ChannelAccessEditor channel={accessEditor.channel} onClose={()=>setAccessEditor(null)} onSaved={()=>{clearPrivateState();setNotice("Acceso guardado. Selecciona de nuevo un canal para verificar tus permisos actuales.");refresh.current?.request();}}/>}
        {taskPicker && selected && <ChannelTaskPicker channelId={selected.id} onClose={()=>setTaskPicker(false)} onSelect={task=>{setTaskDrafts(current=>({...current,[key]:task}));setTaskPicker(false);field.current?.focus();}}/>}
        {inlineOpen && selected && <MentionSuggestions key={`${mentionKey}:${inlineMention.start}`} channelId={selected.id} anchorRef={field} panelRef={inlinePanel} listId={inlineListId} query={inlineMention.query} onActiveChange={setInlineActive} onClose={()=>setInlineMention(null)} onDenied={report} onSelect={person=>chooseMention(person,inlineMention)}/>}
        {mentionPicker && selected && <MentionPicker key={`${identity}:${key}`} channelId={selected.id} onClose={()=>setMentionPicker(null)} onDenied={report} onSelect={person=>chooseMention(person,mentionPicker)}/>}

        {imageEditor && <Suspense fallback={<div role="status" className="slack_editor_scrim">Abriendo editor…</div>}><ImageEditor file={imageEditor.file} onCancel={()=>setImageEditor(null)} onSave={file=>{if(key!==state.current.key || !mounted.current)return;try{setAttachments(key,replaceQueuedImage(attachments,imageEditor.id,file));setImageEditor(null);field.current?.focus();}catch(err){setError(err.message);}}}/></Suspense>}
        {phoneTarget === key && selected?.can_send && <Suspense fallback={<p role="status">Abriendo transferencia…</p>}><PhoneTransfer key={key} target={{channel_id:selected.id, parent_id:parent?.id || null,max_images:10-images.length}} onFiles={addImages} onClose={()=>setPhoneTarget(null)}/></Suspense>}
        {libraryOpen && <Suspense fallback={<p role="status">Abriendo biblioteca…</p>}><ResourceLibrary key={`${libraryOpen.identity}:${libraryOpen.id}:${libraryOpen.parent || ''}`} kind="channel" container={libraryOpen.id} parent={libraryOpen.parent} title={libraryOpen.title} onClose={()=>setLibraryOpen(null)} onContext={target=>{setLibraryOpen(null);setHistoryOpen({target});}}/></Suspense>}
        {historyOpen && <Suspense fallback={<p role="status">Abriendo búsqueda…</p>}><HistorySearch initialScope={historyOpen==="saved" || historyOpen==='unread' ? "all":"slack"} initialSaved={historyOpen==="saved"} initialThreads={historyOpen==="threads"} initialUnread={historyOpen==='unread' || !!historyOpen.unread} initialTarget={historyOpen.target} initialChannel={typeof historyOpen==="string" ? null:selected} onClose={()=>setHistoryOpen(false)} onOpenThread={openChannelTarget} onOpenPage={async(target,{signal}={})=>{if(!await mayLeavePage() || signal?.aborted)return false;await shell.open_channel(target);return true;}}/></Suspense>}
    </section>;
}
