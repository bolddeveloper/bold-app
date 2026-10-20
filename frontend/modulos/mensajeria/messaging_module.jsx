import {lazy, Suspense, useCallback, useEffect, useRef, useState} from "react";
import {ArrowLeft, ChevronDown, Forward, ImagePlus, LoaderCircle, LockKeyhole, MessageCircle, PanelLeftClose, PanelLeftOpen, Pencil, RefreshCw, Search, Send, Settings2, Smile, Users, X} from "lucide-react";
import {useCore} from "../core/core_provider.jsx";
import {useShell} from "../core/app_shell.jsx";
import {is_using_real_backend} from "../core/http_client.js";
import {AvatarImage} from "../core/shared/avatar_image.jsx";
import {presenceLabel} from "../core/shared/presence.js";
import {messagingApi} from "./messaging_api.js";
import {applyReceipts, canEditMessage, dayLabel, deliveryState, enterSends, initials, linkParts, mergeMessages, messageError, normalizeQuery, reconcileMessages} from "./messaging_models.js";
import "./messaging.css";
import {MediaDraft, MessageMedia, VoiceRecorder} from "./message_media.jsx";
import {mediaPreview} from "./media_helpers.js";
import ImageQueue from "./image_queue.jsx";
import {appendImages, canReviseFailedImage, captionQueuedImage, replaceQueuedImage} from "./image_queue_model.js";
import {canForward, createMessageForwarder} from "./message_forwarding.js";
const ChatImageEditor = lazy(() => import("./image_editor.jsx"));
const ForwardMessageDialog = lazy(() => import("./forward_message_dialog.jsx"));

function Avatar({person, status}) {
    return <span className="messaging_avatar" aria-hidden="true"><AvatarImage url={person.avatar_url} initials={initials(person.name)}/>{status && <span className={`bold_presence_dot bold_presence_${status}`}/>}</span>;
}

export function MessageText({body}) {
    return <p className="messaging_text">{linkParts(body).map((part, i) => part.href ? <a key={i} href={part.href} target="_blank" rel="noopener noreferrer">{part.text}</a> : part.text)}</p>;
}

export function DeliveryMark({message}) {
    const state = deliveryState(message), label = {sent: "Enviado: guardado en el servidor", delivered: "Entregado al dispositivo del destinatario", read: "Leído por el destinatario"}[state];
    return <span className={`messaging_delivery messaging_delivery_${state}`} title={label} aria-label={label}><span aria-hidden="true"/>{state !== "sent" && <span aria-hidden="true"/>}</span>;
}

export default function MessagingModule() {
    const core = useCore(), shell = useShell();
    const actorId = core.employee?.id || core.account?.employee || core.activeAssignment?.personId;
    const [conversations, setConversations] = useState([]), [listNext, setListNext] = useState(null);
    const [conversation, setConversation] = useState(null), [messages, setMessages] = useState([]), [older, setOlder] = useState(null);
    const [query, setQuery] = useState(""), [newChat, setNewChat] = useState(false), [contactOpen, setContactOpen] = useState(false);
    const [drafts, setDrafts] = useState({}), [edit, setEdit] = useState(null), [emojiOpen, setEmojiOpen] = useState(false);
    const [loading, setLoading] = useState(false), [refreshing, setRefreshing] = useState(false), [sending, setSending] = useState(false), [listLoading, setListLoading] = useState(false);
    const [error, setError] = useState(""), [notice, setNotice] = useState(""), [now, setNow] = useState(Date.now());
    const [enterBehavior, setEnterBehavior] = useState(null);
    const [mediaDrafts, setMediaDrafts] = useState({}), [imageEditing, setImageEditing] = useState(null), [recording, setRecording] = useState(false);
    const [imageQueues, setImageQueues] = useState({}), [selectedImages, setSelectedImages] = useState({}), [uploadProgress, setUploadProgress] = useState(null);
    const queueStore = useRef({});
    const [forwardSource, setForwardSource] = useState(null);
    const forwarder = useRef(null);
    if (!forwarder.current) forwarder.current = createMessageForwarder(messagingApi);
    const [animatedIds, setAnimatedIds] = useState(new Set()), [viewportHeight, setViewportHeight] = useState(null);
    const imageInput = useRef(null), knownIds = useRef(new Set());
    const compactKey = `bold:chat:compact:${core.account?.id || actorId}`;
    const [collapsed, setCollapsed] = useState(() => {try {return localStorage.getItem(compactKey) === "true";} catch {return false;}});
    function compact(value) {setCollapsed(value); setQuery(""); try {localStorage.setItem(compactKey,String(value));} catch { /* Preference is optional. */ }}
    const unreadCount = id => core.messaging?.unread?.byConversation?.[id]?.count || 0;
    const receipts = useRef(new Map()), refreshRef = useRef(null);
    const activeId = useRef(null), mounted = useRef(false), busy = useRef(false), read = useRef(null), listRead = useRef(null), writes = useRef(null);
    const retry = useRef(new Map()), offset = useRef(0), viewport = useRef(null), composer = useRef(null), editField = useRef(null), scrollBottom = useRef(false);
    const queuedImages = imageQueues[conversation?.id] || [];
    const selectedImage = queuedImages.find(item => item.id === selectedImages[conversation?.id]) || queuedImages[0];
    useEffect(() => {
        const field = (edit ? editField : composer).current;
        if (field) {field.style.height = "auto"; field.style.height = `${Math.min(112, Math.max(40, field.scrollHeight))}px`;}
    }, [edit?.body, edit?.id, drafts, selectedImage?.caption, selectedImage?.id, conversation?.id, loading]);
    const real = is_using_real_backend();
    const merge = (current, incoming) => applyReceipts(mergeMessages(current, incoming), [...receipts.current.values()]);
    const errorFor = err => { if (mounted.current && err.name !== "AbortError") setError(messageError(err)); };
    const clock = page => { if (page.server_now) offset.current = Date.parse(page.server_now) - Date.now(); setNow(Date.now() + offset.current); };
    function animateNew(rows) {
        const fresh = rows.filter(row => !knownIds.current.has(row.id)).map(row => row.id);
        fresh.forEach(id => knownIds.current.add(id));
        if (fresh.length) setAnimatedIds(current => new Set([...current, ...fresh].slice(-100)));
    }
    function updateQueue(id, transform) {
        const rows = transform(queueStore.current[id] || []), next = {...queueStore.current};
        if (rows.length) next[id] = rows; else delete next[id];
        queueStore.current = next; setImageQueues(next); return rows;
    }
    function chooseImages(files) {
        if (!files?.length || busy.current || recording || loading || edit || imageEditing || !conversation?.peer.available) return;
        const id = conversation.id;
        if (mediaDrafts[id]) {setError("Envía o quita primero la nota de voz antes de añadir imágenes."); return;}
        try {
            const current = queueStore.current[id] || [], rows = appendImages(current, files);
            if (!current.length && drafts[id]) {rows[0] = {...rows[0], caption: drafts[id]}; setDrafts(value => ({...value, [id]: ""}));}
            updateQueue(id, () => rows); setSelectedImages(value => ({...value, [id]: rows[current.length].id}));
            setError(""); setEmojiOpen(false);
        } catch (err) {setError(err.message);}
    }
    function removeImage(item) {
        if (busy.current) return;
        const id = conversation.id, current = queueStore.current[id] || [], index = current.findIndex(row => row.id === item.id);
        const rows = updateQueue(id, values => values.filter(row => row.id !== item.id));
        setSelectedImages(value => ({...value, [id]: rows[Math.min(index, rows.length - 1)]?.id}));
        if (!rows.length && item.caption) setDrafts(value => ({...value, [id]: value[id] || item.caption}));
        if (item.attempted) setNotice("Se quitó de la cola. Si la imagen ya llegó al servidor, no se eliminó del chat.");
        setError("");
    }
    function clearImages() {
        if (busy.current) return;
        const id = conversation.id, rows = queueStore.current[id] || [];
        const captions = rows.map(row => row.caption).filter(Boolean).join("\n");
        const preserved = [drafts[id], captions].filter(Boolean).join("\n");
        if (preserved.length > 5000) {setError("No se retiró la cola: sus descripciones superan los 5.000 caracteres del borrador. Copia o acorta el texto antes de quitar todas las imágenes."); return;}
        if (captions) setDrafts(current => ({...current, [id]: preserved}));
        updateQueue(id, () => []); setError("");
        setNotice(rows.some(row => row.attempted) ? "Cola retirada. Las imágenes que hayan llegado al servidor no se eliminan del chat." : "Imágenes retiradas; se conservó su texto como borrador.");
        requestAnimationFrame(() => composer.current?.focus());
    }
    function changeComposer(value) {
        if (busy.current) return;
        if (edit) setEdit(current => ({...current, body: value}));
        else if (selectedImage) updateQueue(conversation.id, rows => captionQueuedImage(rows, selectedImage.id, value));
        else setDrafts(current => ({...current, [conversation.id]: value}));
    }
    useEffect(() => {
        const update = () => setViewportHeight(window.visualViewport?.height || window.innerHeight);
        update(); window.visualViewport?.addEventListener("resize", update);
        return () => window.visualViewport?.removeEventListener("resize", update);
    }, []);
    useEffect(() => {knownIds.current = new Set(messages.map(row => row.id));}, [messages]);

    const loadList = useCallback(async (next = null) => {
        listRead.current?.abort();
        const controller = new AbortController(); listRead.current = controller;
        setListLoading(true);
        try {
            const page = await messagingApi.list(next, {signal: controller.signal});
            if (!mounted.current || controller.signal.aborted) return;
            setConversations(current => next ? [...new Map([...current, ...page.results].map(row => [row.id, row])).values()] : page.results);
            setListNext(page.next);
        } catch (err) { errorFor(err); }
        finally { if (mounted.current && !controller.signal.aborted) setListLoading(false); }
    }, []);

    async function selectConversation(id, employee = null) {
        if (busy.current) return;
        read.current?.abort();
        const controller = new AbortController(); read.current = controller;
        activeId.current = null; setConversation(null); setMessages([]); setOlder(null); setLoading(true); setRefreshing(false); setEdit(null); setEmojiOpen(false); setContactOpen(false); setError(""); setNotice("");
        try {
            const detail = employee ? await messagingApi.open(employee, {signal: controller.signal}) : await messagingApi.detail(id, {signal: controller.signal});
            if (!mounted.current || controller.signal.aborted) return;
            activeId.current = detail.id;
            setConversation(detail);
            const page = await messagingApi.messages(detail.id, null, {signal: controller.signal});
            if (!mounted.current || controller.signal.aborted) return;
            clock(page); scrollBottom.current = true; knownIds.current = new Set(page.results.map(row => row.id)); setAnimatedIds(new Set()); setMessages(current => merge(current, page.results)); setOlder(page.next); setNewChat(false); setQuery("");
            setConversations(current => [{id: detail.id, peer: detail.peer, updated_at: detail.updated_at, preview: mediaPreview(page.results[0])}, ...current.filter(row => row.id !== detail.id)]);
            requestAnimationFrame(() => composer.current?.focus());
        } catch (err) { errorFor(err); }
        finally { if (mounted.current && !controller.signal.aborted) setLoading(false); }
    }

    useEffect(() => {
        mounted.current = true;
        if (real) loadList();
        // UI-only clock: never makes a network request or resets the server deadline.
        const timer = setInterval(() => setNow(Date.now() + offset.current), 15_000);
        return () => {mounted.current = false; clearInterval(timer); read.current?.abort(); listRead.current?.abort(); writes.current?.abort();};
    }, [loadList, real]);
    useEffect(() => {
        if (!real) return;
        const controller = new AbortController();
        messagingApi.preferences({signal: controller.signal}).then(value => {if (!controller.signal.aborted) setEnterBehavior(value.enter_behavior);}).catch(errorFor);
        const change = event => setEnterBehavior(event.detail.enter_behavior);
        window.addEventListener("bold:messaging-preferences", change);
        return () => {controller.abort(); window.removeEventListener("bold:messaging-preferences", change);};
    }, [real]);
    useEffect(() => {
        if (!real) return;
        const receive = event => {
            const envelope = event.detail, payload = envelope?.payload;
            if (!payload) return;
            if (envelope.event_type === "messaging.receipt.updated") {
                if (payload.conversation_id !== activeId.current) return;
                for (const row of payload.receipts || []) {
                    const old = receipts.current.get(row.id);
                    receipts.current.set(row.id, {id: row.id, delivered_at: old?.delivered_at || row.delivered_at, read_at: old?.read_at || row.read_at});
                }
                while (receipts.current.size > 1000) receipts.current.delete(receipts.current.keys().next().value);
                setMessages(current => applyReceipts(current, [...receipts.current.values()]));
            } else {
                const rows = payload.messages || [];
                const active = rows.filter(row => row.conversation_id === activeId.current);
                if (active.length) {
                    if (envelope.event_type === "messaging.message.created") animateNew(active);
                    scrollBottom.current = !viewport.current || viewport.current.scrollHeight - viewport.current.scrollTop - viewport.current.clientHeight < 120;
                    setMessages(current => merge(current, active));
                    if (active.some(row => row.author_id !== actorId)) setNotice("Nuevo mensaje en esta conversación.");
                }
                if (payload.peer) setConversations(current => {
                    const row = current.find(item => item.id === payload.conversation_id), latest = rows.at(-1);
                    return [{...row, id: payload.conversation_id, peer: payload.peer, updated_at: payload.updated_at, preview: envelope.event_type === "messaging.message.created" ? mediaPreview(latest) || row?.preview || "" : row?.preview || ""}, ...current.filter(item => item.id !== payload.conversation_id)].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
                });
                else if (envelope.event_type === "messaging.sync") loadList();
            }
        };
        const recover = () => {if (!document.hidden) refreshRef.current?.();};
        window.addEventListener("bold:messaging-event", receive);
        window.addEventListener("bold:messaging-reconnect", recover);
        return () => {window.removeEventListener("bold:messaging-event", receive); window.removeEventListener("bold:messaging-reconnect", recover);};
    }, [real, actorId, loadList]);
    useEffect(() => { if (real && shell.chat_target?.employee_id) selectConversation(null, shell.chat_target.employee_id); }, [shell.chat_target, real]);
    useEffect(() => { if (scrollBottom.current && viewport.current) {viewport.current.scrollTop = viewport.current.scrollHeight; scrollBottom.current = false;} }, [messages]);
    useEffect(() => {
        const node = viewport.current;
        const followMedia = () => {if (node && node.scrollHeight - node.scrollTop - node.clientHeight < 300) node.scrollTop = node.scrollHeight;};
        node?.addEventListener("bold:chat-media-loaded", followMedia);
        return () => node?.removeEventListener("bold:chat-media-loaded", followMedia);
    }, [conversation?.id]);
    useEffect(() => {if (edit) editField.current?.focus();}, [edit?.id]);
    useEffect(() => {
        if (!conversation || !core.messaging) return;
        const incoming = messages.filter(message => message.author_id !== actorId);
        core.messaging.markDelivered(conversation.id, incoming.filter(row => !row.delivered_at).map(row => row.id));
        let observer;
        function observe() {
            observer?.disconnect();
            if (document.hidden || !document.hasFocus() || typeof IntersectionObserver === "undefined") return;
            const unread = new Set(incoming.filter(row => !row.read_at).map(row => row.id));
            observer = new IntersectionObserver(entries => {
                if (document.hidden || !document.hasFocus()) return;
                const visible = entries.filter(entry => {
                    if (!entry.isIntersecting || entry.intersectionRatio < .8 || !unread.has(entry.target.dataset.receiptId)) return false;
                    const rect = entry.target.getBoundingClientRect();
                    const topmost = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
                    return topmost?.closest(".messaging_message") === entry.target.closest(".messaging_message");
                });
                if (visible.length) core.messaging.markRead(conversation.id, visible.map(entry => entry.target.dataset.receiptId));
            }, {root: viewport.current, threshold: .8});
            viewport.current?.querySelectorAll("[data-receipt-id]").forEach(node => observer.observe(node));
        }
        observe(); window.addEventListener("focus", observe); document.addEventListener("visibilitychange", observe);
        return () => {observer?.disconnect(); window.removeEventListener("focus", observe); document.removeEventListener("visibilitychange", observe);};
    }, [messages, conversation?.id, actorId, core.messaging?.markDelivered, core.messaging?.markRead]);

    async function refresh(previous = false, reconcile = false) {
        if (refreshing || loading) return;
        if (!conversation) { setError(""); await loadList(); return; }
        const id = conversation.id, beforeHeight = viewport.current?.scrollHeight || 0, beforeTop = viewport.current?.scrollTop || 0;
        read.current?.abort(); const controller = new AbortController(); read.current = controller;
        setRefreshing(true); setError("");
        try {
            const page = await messagingApi.messages(id, previous ? older : null, {signal: controller.signal});
            if (!mounted.current || controller.signal.aborted || activeId.current !== id) return;
            clock(page);
            if (!previous) scrollBottom.current = !viewport.current || viewport.current.scrollHeight - viewport.current.scrollTop - viewport.current.clientHeight < 120;
            setMessages(current => applyReceipts(reconcile ? reconcileMessages(current, page.results) : mergeMessages(current, page.results), [...receipts.current.values()]));
            setOlder(page.next);
            if (previous) requestAnimationFrame(() => {if (viewport.current) viewport.current.scrollTop = beforeTop + viewport.current.scrollHeight - beforeHeight;});
            else {await loadList(); setNotice("Conversación actualizada.");}
        } catch (err) { errorFor(err); }
        finally { if (mounted.current && activeId.current === id && !controller.signal.aborted) setRefreshing(false); }
    }
    refreshRef.current = () => refresh(false, true);

    async function submit(event) {
        event.preventDefault();
        const id = conversation?.id, body = (edit ? edit.body : drafts[id] || "").trim();
        const file = !edit ? mediaDrafts[id] : null;
        const images = !edit ? queueStore.current[id] || [] : [];
        if (!id || (!body && !file && !edit?.media && !images.length) || busy.current || loading || recording || imageEditing || !conversation.peer.available) return;
        busy.current = true; setSending(true); setError(""); setNotice(""); setEmojiOpen(false);
        const controller = new AbortController(); writes.current = controller;
        const editing = edit;
        if (images.length) {
            let confirmed = 0, failed = null;
            try {
                for (const item of images) {
                    if (!mounted.current || controller.signal.aborted) return;
                    failed = item; setUploadProgress({current: confirmed + 1, total: images.length});
                    updateQueue(id, rows => rows.map(row => row.id === item.id ? {...row, attempted: true} : row));
                    const result = await messagingApi.sendMedia(id, item.caption.trim(), item.id, item.file, {signal: controller.signal});
                    if (!mounted.current || controller.signal.aborted) return;
                    clock(result); confirmed++;
                    updateQueue(id, rows => rows.filter(row => row.id !== item.id));
                    if (activeId.current === id) {scrollBottom.current = true; animateNew([result.message]); setMessages(current => merge(current, [result.message]));}
                    setConversations(current => current.map(row => row.id === id ? {...row, preview: mediaPreview(result.message), updated_at: result.message.created_at} : row).sort((a,b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)));
                }
                setNotice(`${confirmed} ${confirmed === 1 ? "imagen enviada" : "imágenes enviadas"}.`);
                setSelectedImages(current => {const next = {...current}; delete next[id]; return next;});
            } catch (err) {
                if (mounted.current && !controller.signal.aborted && activeId.current === id) {
                    if (canReviseFailedImage(err)) updateQueue(id, rows => rows.map(row => row.id === failed?.id ? {...row, attempted: false} : row));
                    setSelectedImages(current => ({...current, [id]: failed?.id}));
                    setError(`${confirmed} de ${images.length} imágenes confirmadas. Las restantes siguen en la cola. ${messageError(err)} Reintenta para confirmar las pendientes sin duplicar las ya enviadas.`);
                }
            } finally {if (writes.current === controller) {busy.current = false; if (mounted.current) {setSending(false); setUploadProgress(null);}}}
            return;
        }
        let attempt = retry.current.get(id);
        if (!editing && (!attempt || attempt.body !== body || attempt.file !== file)) {attempt = {body, file, id: crypto.randomUUID()}; retry.current.set(id, attempt);}
        try {
            const result = editing ? await messagingApi.edit(id, editing.id, body, editing.version, {signal: controller.signal}) : file ? await messagingApi.sendMedia(id, body, attempt.id, file, {signal: controller.signal}) : await messagingApi.send(id, body, attempt.id, {signal: controller.signal});
            if (!mounted.current || controller.signal.aborted) return;
            clock(result);
            if (activeId.current === id) {scrollBottom.current = !editing; if (!editing) animateNew([result.message]); setMessages(current => merge(current, [result.message])); if (editing) setEdit(null); setNotice(editing ? "Mensaje editado." : "Mensaje guardado en el servidor.");}
            if (!editing) {retry.current.delete(id); setDrafts(current => ({...current, [id]: current[id]?.trim() === body ? "" : current[id]})); setMediaDrafts(current => {const next = {...current}; delete next[id]; return next;});}
            setConversations(current => current.map(row => row.id === id && !editing ? {...row, preview: mediaPreview(result.message), updated_at: result.message.created_at} : row).sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)));
        } catch (err) { if (activeId.current === id) errorFor(err); }
        finally {if (writes.current === controller) {busy.current = false; if (mounted.current) setSending(false);}}
    }

    const peer = conversation?.peer;
    const presence = core.presence?.rows?.find(row => row.employee_id === peer?.employee_id);
    const statusText = presence ? presenceLabel(presence) : "Disponibilidad sin confirmar";
    const roster = [...new Map([...(core.presence?.rows || []), ...(core.directory || []).map(row => ({employee_id: row.personId || row.employee, name: row.name || row.employee_name, avatar_url: row.avatar_url}))].filter(row => row.employee_id && row.employee_id !== actorId).map(row => [row.employee_id, row])).values()];
    const eligible = new Set((core.directory || []).filter(row => row.chat_enabled === true).map(row => String(row.personId || row.employee)));
    const filteredPeople = roster.filter(row => eligible.has(String(row.employee_id)) && normalizeQuery(row.name).includes(normalizeQuery(query)));
    const filteredChats = conversations.filter(row => normalizeQuery(`${row.peer.name} ${row.peer.departments.join(" ")}`).includes(normalizeQuery(query)));
    const draft = conversation ? selectedImage?.caption ?? drafts[conversation.id] ?? "" : "";
    const editExpired = edit && !canEditMessage(edit, actorId, now);

    if (!real) return <section className="messaging_module"><h1>Chat</h1><p>Los chats privados requieren iniciar sesión con el servidor de BOLD. No se muestran conversaciones simuladas.</p></section>;
    return <section className={`messaging_module ${conversation || loading ? "messaging_has_chat" : ""} ${collapsed && !newChat ? "messaging_compact" : ""}`} style={viewportHeight ? {"--chat_vh": `${viewportHeight}px`} : undefined} aria-label="Mensajería privada">
        <aside className="messaging_sidebar" aria-label="Conversaciones">
            <header className="messaging_list_header"><div><h1>Chat</h1><p>Conversaciones directas</p></div><div className="messaging_list_tools"><button type="button" className="messaging_collapse" aria-label={collapsed ? "Desplegar conversaciones" : "Plegar conversaciones"} title={collapsed ? "Desplegar conversaciones" : "Solo avatares"} aria-expanded={!collapsed} aria-controls="messaging_conversations_list" onClick={() => {compact(!collapsed); setNewChat(false);}}>{collapsed ? <PanelLeftOpen size={19} aria-hidden="true"/> : <PanelLeftClose size={19} aria-hidden="true"/>}</button><button type="button" aria-label={newChat ? "Ver conversaciones" : "Nuevo chat"} title={newChat ? "Ver conversaciones" : "Nuevo chat"} aria-pressed={newChat} onClick={() => {setNewChat(value => !value); setQuery("");}}><MessageCircle size={20} aria-hidden="true"/></button></div></header>
            <label className="messaging_search"><Search size={17} aria-hidden="true"/><input type="search" placeholder={newChat ? "Buscar empleado…" : "Buscar conversación…"} aria-label={newChat ? "Buscar empleado" : "Buscar conversación"} value={query} onChange={event => setQuery(event.target.value)}/></label>
            <div className="messaging_chat_list" id="messaging_conversations_list">
                {newChat ? <><h2>Iniciar una conversación</h2>{filteredPeople.map(person => <button key={person.employee_id} type="button" className="messaging_chat_row" disabled={sending} onClick={() => selectConversation(null, person.employee_id)}><Avatar person={person}/><span className="messaging_row_copy"><strong>{person.name}</strong><small>Chat privado · Piloto IT</small></span></button>)}{!filteredPeople.length && <p className="messaging_hint">No hay empleados de IT con este nombre.</p>}</> : <>{filteredChats.map(row => <button key={row.id} type="button" className="messaging_chat_row" title={row.peer.name + (unreadCount(row.id) ? " · Mensajes sin leer" : "")} aria-label={row.peer.name + (unreadCount(row.id) ? ", mensajes sin leer" : "")} aria-current={conversation?.id === row.id ? "true" : undefined} disabled={sending} onClick={() => selectConversation(row.id)}><Avatar person={row.peer}/><span className="messaging_row_copy"><strong>{row.peer.name}</strong><small>{row.preview || "Aún sin mensajes"}</small></span>{unreadCount(row.id) > 0 && <span className="chat_unread_dot" aria-hidden="true"/>}</button>)}{!listLoading && !filteredChats.length && <div className="messaging_list_empty"><Users size={28} aria-hidden="true"/><h2>{query ? "Sin coincidencias" : "Tu equipo, más cerca"}</h2><p>Abre un chat nuevo o selecciona la tarjeta de un compañero en el panel Equipo.</p><button type="button" onClick={() => {setNewChat(true); setQuery("");}}>Nuevo chat</button></div>}{listNext && <button type="button" className="messaging_more" disabled={listLoading} onClick={() => loadList(listNext)}>Más conversaciones <ChevronDown size={16} aria-hidden="true"/></button>}</>}
                {listLoading && <p role="status" className="messaging_hint">Cargando conversaciones…</p>}
            </div>
            <footer><LockKeyhole size={15} aria-hidden="true"/><span>Solo los dos participantes pueden acceder desde BOLD.</span></footer>
        </aside>
        <div className="messaging_conversation">
            {conversation ? <><header className="messaging_chat_header"><button type="button" className="messaging_back" aria-label="Volver a conversaciones" disabled={sending} onClick={() => {read.current?.abort(); activeId.current = null; setConversation(null); setEdit(null); setLoading(false); setRefreshing(false); setError("");}}><ArrowLeft size={20} aria-hidden="true"/></button><button type="button" className="messaging_peer" aria-expanded={contactOpen} aria-label={`Información de ${peer.name}`} onClick={() => setContactOpen(value => !value)}><Avatar person={peer} status={presence?.status}/><span><strong>{peer.name}</strong><small>{peer.available ? statusText : "Cuenta no disponible"}</small></span></button><button type="button" aria-label="Actualizar conversación" title="Actualizar conversación" disabled={refreshing || loading || sending} onClick={() => refresh()}><RefreshCw className={refreshing ? "messaging_spin" : ""} size={19} aria-hidden="true"/></button></header>
                {contactOpen && <section className="messaging_contact"><strong>{peer.name}</strong><p>{peer.departments.join(" · ") || "Sin departamento activo"}</p><p>Solo sus dos participantes pueden acceder desde BOLD. Las imágenes y notas de voz se guardan en el Drive corporativo; quienes tengan acceso directo a esa carpeta en Google podrán verlas fuera de BOLD.</p><button type="button" onClick={() => setContactOpen(false)}>Cerrar información</button></section>}
                <p className="messaging_stage_note"><LockKeyhole size={13} aria-hidden="true"/>{core.messaging?.connection === "open" ? "Conversación privada · Sincronización en tiempo real" : "Reconectando la conversación · Puedes actualizar manualmente mientras vuelve la conexión"}</p>
                <div className="messaging_log" role="region" aria-label={`Mensajes con ${peer.name}`} tabIndex={0} ref={viewport} aria-busy={loading || refreshing}>
                    {older && <button type="button" className="messaging_more" disabled={refreshing || loading} onClick={() => refresh(true)}>{refreshing ? "Cargando…" : "Ver mensajes anteriores"}</button>}
                    {loading ? <p role="status">Cargando mensajes…</p> : !messages.length && <div className="messaging_welcome"><MessageCircle size={36} aria-hidden="true"/><h2>Conversa con {peer.name.split(/\s+/)[0]}</h2><p>Comparte una idea, haz una consulta o coordina el siguiente paso.</p></div>}
                    {messages.map((message, index) => {
                        const mine = message.author_id === actorId, author = mine ? conversation.me : peer;
                        const day = dayLabel(message.created_at), showDay = index === 0 || dayLabel(messages[index - 1].created_at) !== day;
                        return <div className="messaging_message_group" key={message.id}>
                            {showDay && <div className="messaging_day">{day}</div>}
                            <article className={`messaging_message ${mine ? "messaging_mine" : ""} ${animatedIds.has(message.id) ? "messaging_arriving" : ""}`} onAnimationEnd={() => setAnimatedIds(current => {const next = new Set(current); next.delete(message.id); return next;})} aria-label={`Mensaje de ${author.name}`}>
                                <Avatar person={author}/><div className="messaging_bubble">
                                    <header><strong>{author.name}</strong><span className="messaging_message_actions">{canForward(message) && <button type="button" aria-label={message.media ? "Reenviar imagen" : "Reenviar mensaje"} title="Reenviar a otro chat" disabled={sending || recording || loading} onClick={() => setForwardSource({...message, media: message.media && {...message.media}})}><Forward size={16} aria-hidden="true"/></button>}{canEditMessage(message, actorId, now) && <button type="button" aria-label="Editar mi mensaje" title="Editar durante los primeros diez minutos" disabled={sending || recording} onClick={() => {setEdit({...message}); setEmojiOpen(false); setError("");}}><Pencil size={14} aria-hidden="true"/></button>}</span></header>
                                    {message.media && <MessageMedia message={message} author={author}/>}
                                    {message.body && <MessageText body={message.body}/>}
                                    <footer data-receipt-id={mine ? undefined : message.id}><time dateTime={message.created_at} title={new Date(message.created_at).toLocaleString("es")}>{new Date(message.created_at).toLocaleTimeString("es", {hour: "2-digit", minute: "2-digit"})}</time>{message.edited_at && <span>editado</span>}{mine && <DeliveryMark message={message}/>}</footer>
                                </div>
                            </article>
                        </div>;
                    })}
                </div>
                <div className="messaging_feedback" role="status" aria-live="polite" aria-atomic="true">{notice}</div>
                {error && <div className="messaging_error" role="alert">{error}</div>}
                <form className={`messaging_composer ${!edit && queuedImages.length ? "messaging_preparing_images" : ""}`} onSubmit={submit} onPaste={event => {const files = [...(event.clipboardData?.files || [])].filter(row => row.type.startsWith("image/")); if (files.length) {event.preventDefault(); chooseImages(files);}}} onDragOver={event => {if ([...(event.dataTransfer?.types || [])].includes("Files")) event.preventDefault();}} onDrop={event => {if (event.dataTransfer.files.length) {event.preventDefault(); chooseImages(event.dataTransfer.files);}}}>
                    {!edit && queuedImages.length > 0 && <ImageQueue key={conversation.id} items={queuedImages} activeId={selectedImage?.id} disabled={sending || loading} onSelect={id => {setSelectedImages(current => ({...current, [conversation.id]: id})); setEmojiOpen(false);}} onEdit={item => setImageEditing({file: item.file, imageId: item.id, conversationId: conversation.id})} onRemove={removeImage} onClear={clearImages} onAdd={() => imageInput.current?.click()}/>}
                    {uploadProgress && <p className="messaging_queue_progress" role="status" aria-live="polite">Enviando imagen {uploadProgress.current} de {uploadProgress.total}…</p>}
                    {!edit && mediaDrafts[conversation.id] && <MediaDraft file={mediaDrafts[conversation.id]} disabled={sending} onRemove={() => setMediaDrafts(current => {const next = {...current}; delete next[conversation.id]; return next;})}/>}
                    {edit && <div className="messaging_edit_notice"><span>{editExpired ? "El plazo de edición terminó. Copia tu texto antes de cancelar." : "Editando tu mensaje · el plazo original de diez minutos se mantiene"}</span><button type="button" aria-label="Cancelar edición" disabled={sending} onClick={() => setEdit(null)}><X size={18} aria-hidden="true"/></button></div>}
                    <label className="messaging_sr" htmlFor="messaging_input">{edit ? "Editar mensaje" : selectedImage ? "Descripción de la imagen seleccionada (opcional)" : "Escribir mensaje"}</label>
                    <textarea id="messaging_input" ref={edit ? editField : composer} rows={1} maxLength={5000} aria-describedby="messaging_input_hint" placeholder={peer.available ? selectedImage && !edit ? "Descripción de esta imagen (opcional)…" : "Escribe un mensaje…" : "No se pueden enviar mensajes a esta cuenta"} value={edit ? edit.body : draft} disabled={sending || loading || !peer.available || !edit && !!selectedImage?.attempted} onChange={event => changeComposer(event.target.value)} onKeyDown={event => {if (enterSends({...event, isComposing: event.nativeEvent.isComposing}, enterBehavior)) {event.preventDefault(); if (!editExpired) submit(event);}}}/>
                    {emojiOpen && <div className="messaging_emojis" role="group" aria-label="Insertar emoji">{[["😀", "Sonrisa"], ["👍", "Pulgar arriba"], ["❤️", "Corazón"], ["🎉", "Celebración"], ["👀", "Ojos"], ["✅", "Listo"], ["🙏", "Gracias"], ["🚀", "Cohete"]].map(([emoji, name]) => <button type="button" key={emoji} aria-label={name} onClick={() => {changeComposer(((edit ? edit.body : draft) + emoji).slice(0,5000)); setEmojiOpen(false); (edit ? editField : composer).current?.focus();}}>{emoji}</button>)}</div>}
                    <div className="messaging_composer_actions"><button type="button" aria-label="Insertar emoji" aria-expanded={emojiOpen} disabled={sending || recording || !peer.available || !edit && !!selectedImage?.attempted} onClick={() => setEmojiOpen(value => !value)}><Smile size={20} aria-hidden="true"/></button>
                    <input className="messaging_sr" type="file" accept="image/jpeg,image/png,image/webp" multiple ref={imageInput} tabIndex={-1} aria-label="Seleccionar imagen para Chat" disabled={sending || loading || !!edit || recording} onChange={event => {chooseImages(event.target.files); event.target.value = "";}}/>
                    {!edit && <><button type="button" aria-label="Adjuntar imagen" disabled={sending || loading || recording || !peer.available} onClick={() => imageInput.current?.click()}><ImagePlus size={20} aria-hidden="true"/></button><VoiceRecorder key={conversation.id} disabled={sending || loading || !!mediaDrafts[conversation.id] || !!queuedImages.length || !peer.available} onRecording={setRecording} onError={setError} onReady={file => setMediaDrafts(current => ({...current, [conversation.id]: file}))}/></>}
                    <button type="button" aria-label="Configurar mensajería" title="Configurar Enter" disabled={recording || sending} onClick={() => shell.open_profile(false, "messaging")}><Settings2 size={18} aria-hidden="true"/></button><small id="messaging_input_hint">{(edit ? edit.body : draft).length.toLocaleString("es")}/5.000 · {enterBehavior === "newline" ? "Enter: salto · Ctrl/⌘+Enter: enviar" : enterBehavior === "send" ? "Enter envía · Mayús+Enter: salto" : "Cargando preferencia de Enter…"}</small><button type="submit" className="messaging_send" aria-label={sending ? "Guardando mensaje" : edit ? "Guardar mensaje" : queuedImages.length ? `Enviar ${queuedImages.length} imágenes` : "Enviar mensaje"} disabled={sending || loading || recording || !peer.available || !!imageEditing || editExpired || (!(edit ? edit.body : draft).trim() && !(edit?.media || !edit && (mediaDrafts[conversation.id] || queuedImages.length)))}>{sending ? <LoaderCircle size={17} className="messaging_spin" aria-hidden="true"/> : <Send size={17} aria-hidden="true"/>}<span className="messaging_send_label">{sending ? "Enviando…" : edit ? "Guardar" : queuedImages.length ? `Enviar ${queuedImages.length}` : "Enviar"}</span></button></div>
                </form>
            </> : <div className="messaging_empty"><MessageCircle size={44} aria-hidden="true"/><h2>{loading ? "Abriendo conversación…" : "Un espacio para conversar"}</h2><p>Elige un compañero para iniciar un chat privado.</p><button type="button" aria-label="Actualizar conversaciones" disabled={listLoading} onClick={() => loadList()}><RefreshCw size={17} aria-hidden="true"/> Actualizar</button>{error && <div className="messaging_error" role="alert">{error}</div>}</div>}
        </div>
        {imageEditing && <Suspense fallback={<p role="status">Abriendo editor de imagen…</p>}><ChatImageEditor file={imageEditing.file} onCancel={() => setImageEditing(null)} onSave={file => {try {updateQueue(imageEditing.conversationId, rows => replaceQueuedImage(rows, imageEditing.imageId, file));} catch (err) {setError(err.message);} setImageEditing(null);}}/></Suspense>}
        {forwardSource && <Suspense fallback={<p role="status">Abriendo reenvío…</p>}><ForwardMessageDialog source={forwardSource} people={roster.filter(row => eligible.has(String(row.employee_id)) && row.employee_id !== peer?.employee_id)} forward={forwarder.current} onClose={() => setForwardSource(null)} onSent={(result, person) => {
            clock(result);
            if (activeId.current === result.message.conversation_id) {scrollBottom.current = true; animateNew([result.message]); setMessages(current => merge(current, [result.message]));}
            setConversations(current => [{id: result.conversation.id, peer: result.conversation.peer, updated_at: result.message.created_at, preview: mediaPreview(result.message)}, ...current.filter(row => row.id !== result.conversation.id)].sort((a,b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)));
            setNotice(`Mensaje reenviado a ${person.name}.`);
        }}/></Suspense>}
    </section>;
}
