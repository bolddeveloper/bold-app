import {lazy, Suspense, useEffect, useLayoutEffect, useRef, useState} from "react";
import {Archive, ArrowDown, ArrowLeft, Bell, BellOff, CheckCheck, Hash, ImagePlus, LockKeyhole, MessageSquare, MoreHorizontal, Plus, RefreshCw, Send, Settings2, X} from "lucide-react";
import {useCore} from "../core/core_provider.jsx";
import {useShell} from "../core/app_shell.jsx";
import {AvatarImage} from "../core/shared/avatar_image.jsx";
import {useDialog} from "../core/shared/use_dialog.js";
import {channelApi, channelError, createChannelRefresh, mergeChannelDetails, mergeChannelMessages} from "./channel_api.js";
import {useChannelReader} from "./use_channel_reader.js";
import {dayLabel, enterSends, initials, linkParts, normalizeQuery} from "./messaging_models.js";
import {MediaDraft, MessageMedia, VoiceRecorder} from "./message_media.jsx";
import ImageQueue from "./image_queue.jsx";
import {appendImages, canReviseFailedImage, captionQueuedImage, replaceQueuedImage} from "./image_queue_model.js";
import {lockChannelMedia, unlockRejectedChannelMedia} from "./channel_outbox.js";
import "./messaging.css";
import "./channel.css";
import ChannelTaskPicker from "./channel_task_picker.jsx";
import ChannelAccessEditor, {ChannelAccessFields} from "./channel_access_editor.jsx";
const ImageEditor = lazy(() => import("./image_editor.jsx"));

function Department({value}) {
    value = value || {name:"Sin departamento",color:""};
    return <span className="slack_department" style={{"--department-color":/^#[0-9a-f]{6}$/i.test(value.color) ? value.color : "var(--bold_red_dark)"}}>{value.name}</span>;
}

function ChannelEditor({channel, departments, canCreateIndependent, onClose, onSaved}) {
    const [unit, setUnit] = useState(channel ? channel.department?.id || "" : canCreateIndependent ? "" : departments.find(row => row.can_create)?.id || "");
    const [name, setName] = useState(channel?.name || ""), [description, setDescription] = useState(channel?.description || "");
    const [visibility,setVisibility]=useState("public"),[members,setMembers]=useState([]);
    const [busy, setBusy] = useState(false), [error, setError] = useState("");
    const active = useRef(true), request = useRef(null), sending = useRef(false);
    useEffect(() => {active.current = true; return () => {active.current = false; request.current?.abort();};}, []);
    useDialog(true, ".slack_editor", () => {if (!sending.current) onClose();});
    async function save(event) {
        event.preventDefault();
        if (sending.current) return;
        sending.current = true; setBusy(true); setError("");
        request.current = new AbortController();
        try {
            const options = {signal:request.current.signal};
            const result = channel ? await channelApi.update(channel.id, {name, description, version:channel.version}, options)
                : await channelApi.create({unit_id:unit || null, name, description,visibility,members:members.map(({employee_id,access})=>({employee_id,access}))}, options);
            if (active.current) onSaved(result);
        } catch (err) {if (active.current && err.name !== "AbortError") setError(channelError(err));}
        finally {sending.current = false; if (active.current) setBusy(false);}
    }
    return <div className="slack_editor_scrim"><section role="dialog" aria-modal="true" aria-labelledby="slack_editor_title" className="slack_editor">
        <header><h2 id="slack_editor_title">{channel ? "Configurar canal" : "Crear canal"}</h2><button type="button" onClick={onClose} disabled={busy} aria-label="Cerrar configuración"><X aria-hidden="true" size={20}/></button></header>
        <p>Un espacio compartido entre empleados. Los permisos se administran desde el módulo Permisos.</p>
        <form onSubmit={save} aria-busy={busy}>
            <fieldset disabled={busy}>
                {!channel && <label>Departamento<select value={unit} onChange={event => {setUnit(event.target.value);if(!event.target.value && visibility==="department")setVisibility("private");}} required={!canCreateIndependent}>{canCreateIndependent && <option value="">Sin departamento</option>}{departments.filter(row => row.can_create).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select>{canCreateIndependent && <small>Elige «Sin departamento» para un espacio independiente.</small>}</label>}
                <label>Nombre del canal<input autoComplete="off" value={name} onChange={event => setName(event.target.value)} maxLength={80} required/></label>
                <label>Descripción<textarea rows={3} value={description} onChange={event => setDescription(event.target.value)} maxLength={500}/></label>
                {!channel && <ChannelAccessFields unit={unit} visibility={visibility} members={members} onVisibility={setVisibility} onMembers={setMembers} disabled={busy}/>}
            </fieldset>
            {error && <p className="slack_error" role="alert">{error}</p>}
            <button type="submit" className="slack_primary" disabled={busy || !name.trim() || (!channel && !unit && !canCreateIndependent)}>{busy ? "Guardando…" : "Guardar canal"}</button>
        </form>
    </section></div>;
}

export default function ChannelModule() {
    const core = useCore(), shell = useShell();
    const allowed = core.activeAssignment?.chat_enabled === true && !core.securityUncertain;
    const [departments, setDepartments] = useState([]), [channels, setChannels] = useState([]), [channelNext, setChannelNext] = useState(null);
    const [canCreateIndependent, setCanCreateIndependent] = useState(false);
    const [selected, setSelected] = useState(null), [messages, setMessages] = useState([]), [older, setOlder] = useState(null);
    const [parent, setParent] = useState(null), [query, setQuery] = useState(""), [department, setDepartment] = useState("");
    const [archived, setArchived] = useState(false), [editor, setEditor] = useState(null), [drafts, setDrafts] = useState({}), [edit, setEdit] = useState(null);
    const [accessEditor,setAccessEditor]=useState(null);
    const [taskDrafts,setTaskDrafts]=useState({}),[taskPicker,setTaskPicker]=useState(false),[openingTaskId,setOpeningTaskId]=useState(null);
    const [mediaDrafts,setMediaDrafts]=useState({}),[activeImage,setActiveImage]=useState(null),[imageEditor,setImageEditor]=useState(null),[recording,setRecording]=useState(false);
    const fileInput=useRef(null), mediaState=useRef({});
    mediaState.current=mediaDrafts;
    const openingTask=useRef(null);
    const [loading, setLoading] = useState(true), [sending, setSending] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
    const [followingBusy,setFollowingBusy]=useState(false),followWrite=useRef(null);
    const openedTarget=useRef(null);
    const stickToBottom=useRef(true),forceToBottom=useRef(false),lastMessage=useRef(null);
    const [newBelow,setNewBelow]=useState(false);
    const mounted = useRef(false), state = useRef({}), reads = useRef(null), writes = useRef(null), busy = useRef(false), retries = useRef(new Map()), viewport = useRef(null), field = useRef(null), refresh = useRef(null);
    const key = `${selected?.id || ""}:${parent?.id || ""}`;
    state.current = {selected, parent, archived, key};
    const actorId = core.account?.employee || core.employee?.id || core.activeAssignment?.personId;
    const attachments=mediaDrafts[key] || [], images=attachments.filter(item=>item.file.type.startsWith("image/"));
    const activeMedia=images.find(item=>item.id===activeImage) || images[0] || attachments[0];
    const draft = edit?.body ?? activeMedia?.caption ?? drafts[key] ?? "";
    const draftTask=edit ? edit.task : taskDrafts[key];
    const pendingMedia=attachments.some(item=>item.attempted);
    function setAttachments(viewKey, update) {setMediaDrafts(current=>{const items=typeof update === "function" ? update(current[viewKey] || []) : update;const next={...current,[viewKey]:items};mediaState.current=next;return next;});}
    function addImages(files) {
        if (busy.current || recording || edit || !selected?.can_send || retries.current.has(key) || pendingMedia) return;
        try {
            if (attachments.some(item=>!item.file.type.startsWith("image/"))) throw Error("Envía o quita la nota de voz antes de añadir imágenes.");
            let next=appendImages(attachments,files);
            if (next.length===attachments.length) return;
            if (!attachments.length) {next=captionQueuedImage(next,next[0].id,drafts[key] || "");setDrafts(current=>({...current,[key]:""}));}
            setAttachments(key,next);setActiveImage(next[attachments.length].id);setError("");field.current?.focus();
        } catch(err) {setError(err.message);}
    }
    function readyAudio(file) {
        if (!mounted.current || key!==state.current.key || !state.current.selected?.can_send) return;
        setAttachments(key,[{id:crypto.randomUUID(),file,caption:drafts[key] || "",attempted:false}]);
        setDrafts(current=>({...current,[key]:""}));setError("");field.current?.focus();
    }
    function clearMedia() {
        // Preserve the selected caption when explicitly returning to text-only.
        setDrafts(current=>({...current,[key]:activeMedia?.caption || current[key] || ""}));setAttachments(key,[]);setActiveImage(null);
    }
    function clearPrivateState() {
        state.current={...state.current,selected:null,parent:null,key:":"};
        reads.current?.abort();writes.current?.abort();followWrite.current?.abort();openingTask.current?.abort();
        setMessages([]);setChannels([]);setChannelNext(null);setSelected(null);setParent(null);setOlder(null);setEdit(null);setEditor(null);setAccessEditor(null);
        setDrafts({});setTaskDrafts({});setTaskPicker(false);setMediaDrafts({});mediaState.current={};setImageEditor(null);setActiveImage(null);retries.current.clear();
    }
    function report(err) {if (mounted.current && err.name !== "AbortError") {if ([401,403,404].includes(err.status)) clearPrivateState();setError(channelError(err));}}
    function select(row) {
        if (busy.current || recording) return;
        if(row && row.id===state.current.selected?.id && !state.current.parent) {
            setSelected(current=>mergeChannelDetails(current,row));jumpToLatest();refresh.current?.request();return;
        }
        state.current = {...state.current, selected:row, parent:null, key:`${row?.id || ""}:`};
        setLoading(!!row);
        setSelected(row); setParent(null); setMessages([]); setOlder(null); setEdit(null); setError(""); setNotice("");
    }
    async function load(signal) {
        const archivedSnapshot = state.current.archived;
        const page = await channelApi.list(archivedSnapshot, null, {signal});
        if (signal.aborted || !mounted.current || archivedSnapshot !== state.current.archived) return;
        setChannels(current=>page.results.map(row=>mergeChannelDetails(current.find(old=>old.id===row.id),row))); setChannelNext(page.next);
    }
    async function loadMessages(signal, next = null) {
        const snapshot = state.current;
        if (!snapshot.selected) return;
        const page = await channelApi.messages(snapshot.selected.id, snapshot.parent?.id, next, {signal});
        if (signal.aborted || !mounted.current || snapshot.key !== state.current.key) return;
        setSelected(current=>current?.id===page.channel.id ? mergeChannelDetails(current,page.channel) : current);
        setMessages(current => mergeChannelMessages(current,page.results,{recent:!next}));
        setOlder(page.next); setLoading(false);
    }
    useEffect(() => {
        mounted.current = true;
        clearPrivateState();
        if (!allowed) {setChannels([]); setDepartments([]); setCanCreateIndependent(false); return () => {mounted.current = false;};}
        const initial = new AbortController();
        channelApi.departments({signal:initial.signal}).then(page => {if (!initial.signal.aborted) {setDepartments(page.results);setCanCreateIndependent(page.can_create_independent === true);}}).catch(report);
        refresh.current = createChannelRefresh(async signal => {await load(signal); await loadMessages(signal);}, report);
        refresh.current.request();
        const update = event => {
            const channel = event.detail?.payload;
            if (!channel || channel.kind?.startsWith("channel.") || channel.channel_id === state.current.selected?.id) refresh.current.request();
        };
        window.addEventListener("bold:slack-event", update);
        window.addEventListener("bold:messaging-reconnect", update);
        return () => {mounted.current = false; initial.abort(); reads.current?.abort(); writes.current?.abort();followWrite.current?.abort(); openingTask.current?.abort();refresh.current?.dispose();
            window.removeEventListener("bold:slack-event", update); window.removeEventListener("bold:messaging-reconnect", update);};
    }, [allowed, core.authorizationRevision]);
    useEffect(() => {
        if (!allowed) return;
        reads.current?.abort(); const controller = new AbortController(); reads.current = controller;
        setLoading(true);
        load(controller.signal).catch(report).finally(() => {if (!controller.signal.aborted) setLoading(false);});
        return () => controller.abort();
    }, [allowed, archived]);
    useEffect(() => {
        if (!allowed || !selected) return;
        const controller = new AbortController();
        setLoading(true);
        loadMessages(controller.signal).catch(err => {if ([403,404].includes(err.status)) {setMessages([]); setSelected(null);} report(err);}).finally(() => {if (!controller.signal.aborted) setLoading(false);});
        return () => controller.abort();
    }, [allowed, selected?.id, parent?.id]);
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
    function applyPersonalState(value) {
        if(!mounted.current || !value?.channel) return;
        const row=value.channel;
        setSelected(current=>current?.id===row.id ? mergeChannelDetails(current,row) : current);
        setChannels(current=>current.map(channel=>channel.id===row.id ? mergeChannelDetails(channel,row) : channel));
        window.dispatchEvent(new Event("bold:slack-state"));
    }
    const markViewRead=useChannelReader({channelId:selected?.id,parentId:parent?.id,messages,viewport,enabled:allowed && !!selected && !loading && !editor && !taskPicker && !imageEditor,
        onRead:applyPersonalState,onError:err=>{if([401,403,404].includes(err.status)) report(err);else if(mounted.current)setError("No se pudo confirmar la lectura. Conservamos los indicadores; vuelve a intentarlo dentro de un minuto.");}});
    async function toggleFollowing() {
        if(followWrite.current || !selected) return;
        const controller=new AbortController();followWrite.current=controller;setFollowingBusy(true);setError("");
        try {const row=await channelApi.follow(selected.id,!selected.following,{signal:controller.signal});if(!controller.signal.aborted){applyPersonalState({channel:row});if(state.current.selected?.id===row.id)setNotice(row.following ? "Sigues este canal. Recibirás avisos de sus mensajes nuevos." : "Dejaste de seguirlo. Su historial y los no leídos se conservan.");}}
        catch(err){if(!controller.signal.aborted)report(err);}
        finally{if(followWrite.current===controller)followWrite.current=null;if(mounted.current)setFollowingBusy(false);}
    }
    useEffect(()=>{
        const target=shell.slack_target;
        if(!allowed || !target?.channel_id || openedTarget.current===target.requestId || sending || recording || editor || taskPicker || imageEditor) return;
        const controller=new AbortController();
        (async()=>{
            const channel=await channelApi.detail(target.channel_id,{signal:controller.signal});
            const thread=target.parent_id ? (await channelApi.message(channel.id,target.parent_id,{signal:controller.signal})).message : null;
            if(controller.signal.aborted || !mounted.current) return;
            if(thread?.parent_id) throw Error("La referencia no es un hilo principal.");
            openedTarget.current=target.requestId;
            if(state.current.key===`${channel.id}:${thread?.id || ""}`) {
                setSelected(current=>mergeChannelDetails(current,channel));if(thread)setParent(thread);jumpToLatest();refresh.current?.request();return;
            }
            select(channel);
            if(thread){state.current={...state.current,parent:thread,key:`${channel.id}:${thread.id}`};setMessages([]);setOlder(null);setLoading(true);setParent(thread);}
        })().catch(err=>{if(!controller.signal.aborted){openedTarget.current=target.requestId;report(err);}});
        return ()=>controller.abort();
    },[allowed,shell.slack_target?.requestId,sending,recording,!!editor,taskPicker,!!imageEditor]);

    async function send(event) {
        event.preventDefault();
        if (busy.current || recording || !(draft.trim() || draftTask || (!edit && attachments.length) || edit?.media) || !selected?.can_send) return;
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
            if (currentEdit) setEdit(null); else {setDrafts(current => ({...current,[snapshot.key]:""}));setTaskDrafts(current=>({...current,[snapshot.key]:null}));}
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
    async function sendAttachments() {
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
                    const result=await channelApi.sendMedia(snapshot.selected.id,locked.attempt,locked.file,{signal:controller.signal});
                    if (controller.signal.aborted || !mounted.current) return;
                    setAttachments(snapshot.key,items=>items.filter(row=>row.id!==item.id));
                    forceToBottom.current=true;
                    setMessages(current=>mergeChannelMessages(current,[result.message]));
                    if (locked.attempt.task_id) {setTaskDrafts(current=>({...current,[snapshot.key]:null}));taskId=null;}
                    sent++;setNotice(`${sent} de ${batch.length} adjuntos confirmados.`);
                } catch(err) {
                    if (controller.signal.aborted) return;
                    if (canReviseFailedImage(err)) setAttachments(snapshot.key,items=>items.map(row=>row.id===item.id ? unlockRejectedChannelMedia(locked) : row));
                    // A rejected task reference has not committed a message. Drop
                    // only that reference, retaining both the file and caption.
                    if (err.status===404 && locked.attempt.task_id) {
                        setAttachments(snapshot.key,items=>items.map(row=>row.id===item.id ? unlockRejectedChannelMedia(locked) : row));
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
        } finally {busy.current=false;if(mounted.current)setSending(false);}
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
            // Authorize again before opening. The normal Tasks lifecycle then
            // reloads its own graph; the card never injects trusted task data.
            await channelApi.task(task.id,{signal:controller.signal});
            if (mounted.current && !controller.signal.aborted) window.dispatchEvent(new CustomEvent("bold:brand-resource",{detail:{task:task.id}}));
        } catch(err) {if (mounted.current && !controller.signal.aborted) {setError("La tarea no está disponible o perdió acceso. Actualizamos su referencia; el canal sigue abierto.");refresh.current?.request();}}
        finally {if (openingTask.current===controller) openingTask.current=null;if (mounted.current) setOpeningTaskId(null);}
    }
    if (!allowed) return <section className="slack_module"><p role="status">Slack permanece disponible únicamente para el piloto de IT con una sesión autorizada.</p></section>;
    const groups = [{id:"independent",name:"Sin departamento"},...departments];
    const grouped = groups.filter(unit => !department || department === unit.id).map(unit => ({...unit, channels:channels.filter(row => (row.department?.id || "independent") === unit.id && normalizeQuery(row.name).includes(normalizeQuery(query)))}));
    function unreadFor(row) {
        const summary=core.slack?.unread;
        if(summary?.ready && (Object.hasOwn(summary.byChannel,row.id) || !summary.truncated)) return summary.byChannel[row.id] || 0;
        return row.unread_count || 0;
    }
    const fixedAttempt = retries.current.has(edit ? `edit:${edit.id}` : key) || (!edit && !!activeMedia?.attempted);
    const composerLocked=sending || recording || !selected?.can_send || fixedAttempt || edit?.conflict;
    return <section className={`slack_module ${selected ? "slack_channel_open" : ""}`} aria-label="Slack de BOLD">
        <aside className="slack_sidebar" aria-label="Departamentos y canales" inert={editor || accessEditor || taskPicker || imageEditor || recording ? true : undefined}>
            <header><div><h1>Slack</h1><small>Canales de BOLD · Piloto IT</small></div><button type="button" aria-label="Crear canal" disabled={sending || !(canCreateIndependent || departments.some(row => row.can_create))} onClick={() => setEditor({create:true})}><Plus size={20} aria-hidden="true"/></button></header>
            <label>Buscar canal<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Nombre del canal"/></label>
            <label>Departamento<select value={department} onChange={event => setDepartment(event.target.value)}><option value="">Todos los canales</option>{groups.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
            <label className="slack_archive_filter"><input type="checkbox" checked={archived} onChange={event => setArchived(event.target.checked)}/> Incluir archivados</label>
            <nav aria-label="Canales">{grouped.map(unit => <section key={unit.id}><h2><Department value={unit}/></h2>{unit.channels.map(row => <button type="button" key={row.id} aria-current={selected?.id === row.id ? "page" : undefined} aria-label={unreadFor(row)>0 ? `${row.name}, ${unreadFor(row)} ${unreadFor(row)===1 ? "mensaje" : "mensajes"} sin leer` : undefined} disabled={sending} onClick={() => select(row)}><Hash size={17} aria-hidden="true"/><span>{row.name}</span>{row.following && <Bell size={14} aria-label="Siguiendo"/>}{unreadFor(row)>0 && <strong className="slack_unread_badge" aria-hidden="true">{unreadFor(row)>99 ? "99+" : unreadFor(row)}</strong>}{row.archived_at && <Archive size={15} aria-label="Archivado"/>}</button>)}{!unit.channels.length && <small>Sin canales cargados</small>}</section>)}</nav>
            {channelNext && <button type="button" disabled={loading} onClick={async () => {setLoading(true);const controller=reads.current;try {const page = await channelApi.list(archived,channelNext,{signal:controller.signal}); if (!controller.signal.aborted && mounted.current) {setChannels(current => [...new Map([...current,...page.results].map(row => [row.id,row])).values()]); setChannelNext(page.next);}} catch(err) {if(!controller.signal.aborted)report(err);} finally {if (mounted.current && !controller.signal.aborted) setLoading(false);}}}>Cargar más canales</button>}
            <button type="button" disabled={sending || recording} onClick={()=>setAccessEditor({channel:null})}><LockKeyhole size={18} aria-hidden="true"/>Administrar acceso</button>
            <button type="button" onClick={() => shell.set_active_module("messaging")}><MessageSquare size={18} aria-hidden="true"/>Ir al Chat privado</button>
        </aside>
        <main className="slack_main" inert={editor || accessEditor || taskPicker || imageEditor ? true : undefined}>
            {selected?.can_manage_access && <button type="button" className="slack_access_action" disabled={sending || recording} onClick={()=>setAccessEditor({channel:selected})}><LockKeyhole size={17} aria-hidden="true"/>Privacidad e invitaciones · {selected.visibility==="private" ? "Privado" : selected.visibility==="department" ? "Departamental" : "Público"}</button>}
            <header className="slack_header"><button type="button" className="slack_back" aria-label="Ver canales" disabled={sending || recording} onClick={() => select(null)}><ArrowLeft size={20} aria-hidden="true"/></button><div>{selected ? <><h2># {selected.name}</h2><Department value={selected.department}/><p>{selected.description || "Comparte contexto y mantén las conversaciones organizadas."}</p></> : <><h2>El trabajo, en conversación</h2><p>Elige un canal o crea uno para tu departamento.</p></>}</div><button type="button" className="slack_desktop_action" aria-label="Actualizar canales" onClick={() => refresh.current?.request()}><RefreshCw size={18} aria-hidden="true"/></button>{selected?.can_manage && <><button type="button" className="slack_desktop_action" aria-label="Configurar canal" disabled={sending || recording} onClick={() => setEditor({channel:selected})}><Settings2 size={18} aria-hidden="true"/></button><button type="button" className="slack_desktop_action" aria-label={selected.archived_at ? "Restaurar canal" : "Archivar canal"} disabled={sending || recording} onClick={archive}><Archive size={18} aria-hidden="true"/></button></>}<details className="slack_mobile_menu"><summary aria-label="Opciones del canal"><MoreHorizontal size={20} aria-hidden="true"/></summary><div role="group" aria-label="Acciones del canal"><button type="button" onClick={event=>{event.currentTarget.closest("details").open=false;refresh.current?.request();}}><RefreshCw size={17} aria-hidden="true"/>Actualizar canales</button>{selected?.can_manage && <><button type="button" disabled={sending || recording} onClick={event=>{event.currentTarget.closest("details").open=false;setEditor({channel:selected});}}><Settings2 size={17} aria-hidden="true"/>Configurar canal</button><button type="button" disabled={sending || recording} onClick={event=>{event.currentTarget.closest("details").open=false;archive();}}><Archive size={17} aria-hidden="true"/>{selected.archived_at ? "Restaurar canal" : "Archivar canal"}</button></>}</div></details></header>
            {error && <p role="alert" className="slack_error">{error}</p>}
            {notice && <p role="status" className="slack_notice">{notice}</p>}
            {selected && <>
                <div className="slack_channel_actions"><button type="button" aria-pressed={!!selected.following} disabled={followingBusy || sending || recording} onClick={toggleFollowing}>{selected.following ? <Bell size={17} aria-hidden="true"/> : <BellOff size={17} aria-hidden="true"/>}{followingBusy ? "Guardando…" : selected.following ? "Dejar de seguir canal" : "Seguir canal"}</button><small>{selected.following ? "Avisos activados para este canal" : "Sin avisos; los no leídos se conservan"}</small><button type="button" disabled={loading || !messages.length} onClick={markViewRead}><CheckCheck size={17} aria-hidden="true"/>Marcar vista como leída</button></div>
                {parent && <section className="slack_thread_context"><div><strong>Hilo · {parent.author.name}</strong><p>{parent.body || (parent.media ? parent.media.kind==="image" ? "Imagen compartida" : "Nota de voz" : "Tarea compartida")}</p></div><button type="button" disabled={sending || recording} onClick={() => {setParent(null); setEdit(null); setMessages([]);}} aria-label="Volver al canal"><X size={20} aria-hidden="true"/></button></section>}
                <div ref={viewport} className="slack_messages" aria-label={parent ? "Respuestas del hilo" : "Mensajes del canal"} onScroll={event=>{const node=event.currentTarget;stickToBottom.current=node.scrollHeight-node.scrollTop-node.clientHeight<48;if(stickToBottom.current)setNewBelow(false);}}>
                    {older && <button type="button" disabled={loading} onClick={async () => {const controller = new AbortController(); reads.current?.abort(); reads.current = controller; setLoading(true); try {await loadMessages(controller.signal,older);} catch(err) {report(err);} finally {if (!controller.signal.aborted) setLoading(false);}}}>Cargar mensajes anteriores</button>}
                    {loading && <p role="status">Cargando mensajes…</p>}
                    {!loading && !messages.length && <div className="slack_empty"><Hash size={36} aria-hidden="true"/><h3>{parent ? "Inicia este hilo" : `Bienvenido a #${selected.name}`}</h3><p>Da contexto, comparte información y coordina el siguiente paso.</p></div>}
                    {messages.map((message,index) => <div key={message.id}>
                        {(!index || dayLabel(messages[index-1].created_at) !== dayLabel(message.created_at)) && <p className="slack_day">{dayLabel(message.created_at)}</p>}
                        <article data-slack-message={message.id} className={`slack_message ${message.author.employee_id === actorId ? "slack_mine" : ""}`}>
                            <button type="button" className="slack_avatar" disabled={message.author.employee_id === actorId || sending || recording} aria-label={`Abrir chat con ${message.author.name}`} onClick={() => shell.open_direct_chat(message.author)}><AvatarImage url={message.author.avatar_url} initials={initials(message.author.name)}/></button>
                            <div className="slack_message_card"><header><strong>{message.author.name}</strong><Department value={message.department}/><time dateTime={message.created_at} title={new Date(message.created_at).toLocaleString("es")}>{new Date(message.created_at).toLocaleTimeString("es",{hour:"2-digit",minute:"2-digit"})}</time>{message.edited_at && <small>editado</small>}</header>
                                {message.body && <p className="slack_message_body">{linkParts(message.body).map((part,i) => part.href ? <a key={i} href={part.href} target="_blank" rel="noopener noreferrer">{part.text}</a> : part.text)}</p>}
                                {message.media && <MessageMedia message={message} author={message.author} fetchMedia={channelApi.media}/>}
                                {message.task && (message.task.available ? <button type="button" className="slack_task_card" disabled={!!openingTaskId} onClick={()=>openTask(message.task)}><CheckCheck size={22} aria-hidden="true"/><span><strong>{message.task.title}</strong><small>{openingTaskId===message.task.id ? "Verificando acceso…" : message.task.status}</small></span><span>Abrir tarea</span></button> : <p className="slack_task_unavailable"><LockKeyhole size={16} aria-hidden="true"/>Tarea no disponible para tu asignación activa</p>)}
                                <footer>{!parent && <button type="button" disabled={sending || recording} onClick={() => {setParent(message); setEdit(null); setMessages([]);}}><MessageSquare size={15} aria-hidden="true"/>{message.reply_count ? `${message.reply_count} ${message.reply_count===1 ? "respuesta" : "respuestas"}` : "Responder en hilo"}{message.unread_reply_count>0 && <strong className="slack_unread_badge">{message.unread_reply_count} sin leer</strong>}</button>}{message.can_edit && Date.now() < Date.parse(message.editable_until) && <button type="button" disabled={sending || recording} onClick={() => setEdit({...message})}>Editar mi mensaje</button>}</footer>
                            </div>
                        </article>
                    </div>)}
                </div>
                {newBelow && <button type="button" className="slack_jump_latest" onClick={jumpToLatest}><ArrowDown size={17} aria-hidden="true"/>Mensajes nuevos · Ir al último</button>}
                <form className="slack_composer" onSubmit={send} aria-busy={sending} onDragOver={event=>{if (!edit && event.dataTransfer?.types.includes("Files")) event.preventDefault();}} onDrop={event=>{if (event.dataTransfer?.files.length) {event.preventDefault();addImages(event.dataTransfer.files);}}}>
                    {edit && <div className="slack_editing"><span>{edit.conflict ? "Otro cambio impide guardar esta versión. Copia tu texto, cancela y vuelve a editar." : "Editando tu mensaje"}</span><button type="button" disabled={sending} onClick={() => {retries.current.delete(`edit:${edit.id}`); setEdit(null);}}>Cancelar edición</button></div>}
                    {selected.archived_at && <p>Canal archivado · historial de solo lectura.</p>}
                    {!edit && images.length>0 && <ImageQueue items={images} activeId={activeMedia?.id} disabled={sending || recording || !selected.can_send} canAdd={!pendingMedia} onSelect={setActiveImage} onEdit={setImageEditor} onRemove={item=>attachments.length===1 ? clearMedia() : setAttachments(key,items=>items.filter(row=>row.id!==item.id))} onAdd={()=>fileInput.current?.click()} onClear={clearMedia}/>}
                    {!edit && activeMedia && !images.length && <MediaDraft file={activeMedia.file} disabled={sending || recording || !selected.can_send} onRemove={clearMedia}/>}
                    <label htmlFor="slack_message">{!edit && activeMedia ? images.length ? "Texto de la imagen seleccionada" : "Texto de la nota de voz" : parent ? "Responder al hilo" : `Mensaje para #${selected.name}`}</label>
                    {draftTask && <div className="slack_task_draft"><span><CheckCheck size={18} aria-hidden="true"/>{draftTask.title || "Referencia a tarea"}</span>{!edit && <button type="button" disabled={sending || recording || fixedAttempt || pendingMedia} onClick={()=>setTaskDrafts(current=>({...current,[key]:null}))}>Quitar tarea</button>}</div>}
                    <textarea ref={field} id="slack_message" aria-describedby="slack_input_help" rows={2} maxLength={5000} value={draft} disabled={composerLocked} onPaste={event=>{const files=Array.from(event.clipboardData?.items || []).filter(item=>item.kind==="file").map(item=>item.getAsFile()).filter(Boolean);if(files.length){event.preventDefault();addImages(files);}}} onChange={event => edit ? setEdit(current => ({...current,body:event.target.value})) : activeMedia ? setAttachments(key,items=>captionQueuedImage(items,activeMedia.id,event.target.value)) : setDrafts(current => ({...current,[key]:event.target.value}))} onKeyDown={event => {if (enterSends(event,"send")) {event.preventDefault(); send(event);}}}/>
                    <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden aria-label="Seleccionar imágenes para el canal" disabled={composerLocked || !!edit || pendingMedia} onChange={event=>{addImages(event.target.files);event.target.value="";}}/>
                    <footer><div className="slack_composer_tools">{!edit && <>
                        <button type="button" aria-label="Adjuntar imágenes al canal" disabled={composerLocked || loading || pendingMedia || attachments.some(item=>!item.file.type.startsWith("image/"))} onClick={()=>fileInput.current?.click()}><ImagePlus size={20} aria-hidden="true"/></button>
                        <VoiceRecorder key={key} disabled={composerLocked || loading || !!attachments.length} onReady={readyAudio} onError={setError} onRecording={setRecording}/>
                        <button type="button" aria-label="Compartir tarea" disabled={composerLocked || loading || pendingMedia} onClick={()=>setTaskPicker(true)}><CheckCheck size={18} aria-hidden="true"/><span className="slack_tool_label">Compartir tarea</span></button>
                    </>}</div><small id="slack_input_help">{fixedAttempt || pendingMedia ? "Envío sin confirmar: reintentar conserva el archivo y su identificador." : "Enter envía · Mayús+Enter: salto"}</small><button type="submit" className="slack_primary" disabled={sending || recording || loading || !selected.can_send || !(draft.trim() || draftTask || (!edit && attachments.length) || edit?.media) || edit?.conflict}><Send size={18} aria-hidden="true"/>{sending ? "Enviando…" : fixedAttempt || pendingMedia ? "Reintentar" : edit ? "Guardar" : attachments.length>1 ? `Enviar ${attachments.length}` : "Enviar"}</button></footer>
                </form>
            </>}
        </main>
        {editor && <ChannelEditor channel={editor.channel} departments={departments} canCreateIndependent={canCreateIndependent} onClose={() => setEditor(null)} onSaved={row => {setEditor(null); if(!row.access_only)select(row);refresh.current?.request();}}/>}
        {accessEditor && <ChannelAccessEditor channel={accessEditor.channel} onClose={()=>setAccessEditor(null)} onSaved={()=>{clearPrivateState();setNotice("Acceso guardado. Selecciona de nuevo un canal para verificar tus permisos actuales.");refresh.current?.request();}}/>}
        {taskPicker && selected && <ChannelTaskPicker channelId={selected.id} onClose={()=>setTaskPicker(false)} onSelect={task=>{setTaskDrafts(current=>({...current,[key]:task}));setTaskPicker(false);field.current?.focus();}}/>}
        {imageEditor && <Suspense fallback={<div role="status" className="slack_editor_scrim">Abriendo editor…</div>}><ImageEditor file={imageEditor.file} onCancel={()=>setImageEditor(null)} onSave={file=>{if(key!==state.current.key || !mounted.current)return;try{setAttachments(key,replaceQueuedImage(attachments,imageEditor.id,file));setImageEditor(null);field.current?.focus();}catch(err){setError(err.message);}}}/></Suspense>}
    </section>;
}
