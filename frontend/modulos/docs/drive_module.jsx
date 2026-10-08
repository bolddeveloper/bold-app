import {BackgroundSyncNotice} from "../core/shared/background_sync_notice.jsx";
import {confirmBold} from "../core/shared/bold_dialog.js";
import {useFileDrop} from "./use_file_drop.js";
import {uploadDriveFiles} from "./drive_upload.js";
import ColorPicker from "../core/shared/color_picker.jsx";
import { googleCache, googleThumbnailCache, cacheScope, backgroundRefresh, clearGoogleCache, restoreGoogleConnection, cachedContentChanged, announceBackgroundUpdate } from "../core/google_cache.js";
import { http } from "../core/http_client.js";
import { officeFileKind, officeInBold } from "./office_files.js";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Home, HardDrive, Users, Clock, Star, Trash2, Cloud, Folder, FileText, Sheet, Presentation, Image, File, Search, Plus, Upload, LayoutGrid, List, Info, MoreVertical, ChevronDown, ChevronRight, X, ExternalLink, Sparkles, Calendar, CheckCircle, ArrowLeft, Move, RefreshCw, Check } from "lucide-react";
import { createPortal } from "react-dom";
import GoogleConnection from "./google_connection.jsx";
import { workspaceApi } from "./workspace_api.js";
import { googleFileUrl } from "./google_links.js";
import { bytesLabel, canMove, floatingMenuPosition, isDriveFolder, optimisticMove, previewable, selectDriveFile, triggerDownload } from "./drive_helpers.js";
import "./drive.css";
import { useShell } from "../core/app_shell.jsx";

const navigation = [["home", "Página principal", Home], ["my", "Mi unidad", HardDrive], ["drives", "Unidades compartidas", Users], ["shared", "Compartido conmigo", Users], ["recent", "Reciente", Clock], ["starred", "Destacados", Star], ["trash", "Papelera", Trash2], ["storage", "Almacenamiento", Cloud]];
const types = {docs: ["Documento", "application/vnd.google-apps.document", FileText, "#4285f4"], sheets: ["Hoja de cálculo", "application/vnd.google-apps.spreadsheet", Sheet, "#0f9d58"], slides: ["Presentación", "application/vnd.google-apps.presentation", Presentation, "#e5a900"]};
const kindOf = file => Object.keys(types).find(key => types[key][1] === file.mimeType);
const dateLabel = value => value ? new Date(value).toLocaleDateString("es", {year: "numeric", month: "short", day: "numeric"}) : "—";
function FileIcon({file, size = 23}) {
    const kind = kindOf(file) || officeFileKind(file), Icon = isDriveFolder(file) ? Folder : types[kind]?.[2] || (file.mimeType?.startsWith("image/") ? Image : File);
    return <Icon size={size} style={{color: isDriveFolder(file) ? file.folderColorRgb : types[kind]?.[3]}} aria-hidden="true" />;
}
function googleUrl(email, route = "home") {
    const url = new URL(`https://drive.google.com/drive/${route}`); url.searchParams.set("authuser", email || ""); return url.href;
}
function FileThumbnail({file, cacheNamespace}) {
    const ref = useRef(null), [url, setUrl] = useState("");
    const available = Boolean(file.hasThumbnail || file.thumbnailLink);
    useEffect(() => {
        setUrl("");
        if (isDriveFolder(file) || !available || !cacheNamespace) return;
        let alive = true, object = "";
        const controller = new AbortController();
        const key = `thumbnail:${file.id}:${file.version || file.modifiedTime || "original"}`;
        const show = blob => {if (alive) {object = URL.createObjectURL(blob); setUrl(object);}};
        const observer = new IntersectionObserver(async entries => {
            if (!entries.some(entry => entry.isIntersecting)) return;
            observer.disconnect();
            try {
                const blob = await workspaceApi.thumbnail(file.id, {signal: controller.signal});
                if (!alive) return;
                show(blob);
                void googleThumbnailCache.put(cacheNamespace, key, blob);
            } catch {}
        }, {rootMargin: "200px"});
        googleThumbnailCache.get(cacheNamespace, key).then(blob => {
            if (!alive) return;
            if (blob) show(blob); else observer.observe(ref.current);
        });
        return () => {alive = false; observer.disconnect(); controller.abort(); if (object) URL.revokeObjectURL(object);};
    }, [cacheNamespace, file.id, file.version, file.modifiedTime, available]);
    return <div ref={ref} className="drive_card_preview">{url ? <img src={url} alt="" draggable={false} onError={() => setUrl("")}/> : <FileIcon file={file} size={58}/>}</div>;
}
function Modal({title, children, close, wide = false}) {
    const ref = useRef(null), closeRef = useRef(close); closeRef.current = close;
    useEffect(() => {
        const previous = document.activeElement;
        const controls = () => [...ref.current.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],iframe,[tabindex="0"]')].filter(node => node.getClientRects().length);
        controls()[0]?.focus();
        const key = event => {
            if (event.key === "Escape") {event.stopPropagation(); closeRef.current();}
            if (event.key === "Tab") {const items = controls(), first = items[0], last = items.at(-1); if (event.shiftKey && document.activeElement === first) {event.preventDefault(); last?.focus();} else if (!event.shiftKey && document.activeElement === last) {event.preventDefault(); first?.focus();}}
        };
        const focus = event => {if (ref.current && !ref.current.contains(event.target)) controls()[0]?.focus();};
        ref.current.addEventListener("keydown", key); document.addEventListener("focusin", focus);
        const node = ref.current;
        return () => {node.removeEventListener("keydown", key); document.removeEventListener("focusin", focus); previous?.focus();};
    }, []);
    return createPortal(<div className="drive_overlay_root"><div className="drive_backdrop" onMouseDown={event => {if (event.target === event.currentTarget) close();}}><section ref={ref} className={`drive_dialog ${wide ? "drive_dialog_wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}><header><h2>{title}</h2><button aria-label="Cerrar diálogo" onClick={close}><X size={20}/></button></header>{children}</section></div></div>, document.body);
}

function FloatingMenu({anchor, point, close, label, children}) {
    const ref = useRef(null), closeRef = useRef(close); closeRef.current = close;
    const [position, setPosition] = useState({left: 8, top: 8});
    useLayoutEffect(() => {
        const node = ref.current;
        const place = () => {
            const viewport = window.visualViewport;
            const bounds = {width: viewport?.width || window.innerWidth, height: viewport?.height || window.innerHeight, left: viewport?.offsetLeft || 0, top: viewport?.offsetTop || 0};
            node.style.maxWidth = `${Math.max(0, bounds.width - 16)}px`;
            node.style.maxHeight = `${Math.max(0, bounds.height - 16)}px`;
            const rect = anchor?.getBoundingClientRect() || {left: point.x, top: point.y, bottom: point.y};
            setPosition(floatingMenuPosition(rect, {width: node.offsetWidth, height: node.offsetHeight}, bounds));
        };
        place();
        node.querySelectorAll('button').forEach(button => button.setAttribute('role', 'menuitem'));
        node.querySelector('button:not(:disabled)')?.focus({preventScroll: true});
        const scroll = event => {if (!node.contains(event.target)) closeRef.current();};
        window.addEventListener('resize', place); window.addEventListener('scroll', scroll, true); window.visualViewport?.addEventListener('resize', place);
        return () => {window.removeEventListener('resize', place); window.removeEventListener('scroll', scroll, true); window.visualViewport?.removeEventListener('resize', place);};
    }, [anchor, point]);
    function key(event) {
        const buttons = [...ref.current.querySelectorAll('button:not(:disabled)')], index = buttons.indexOf(document.activeElement);
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            const target = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
            buttons[target]?.focus();
        }
        if (event.key === 'Escape' || event.key === 'Tab') {event.stopPropagation(); closeRef.current(); if (event.key === 'Escape') {event.preventDefault(); anchor?.focus({preventScroll: true});}}
    }
    return createPortal(<div className="drive_overlay_root"><div ref={ref} role="menu" aria-label={label} className="drive_context" style={position} onKeyDown={key}>{children}</div></div>, document.body);
}

export default function DriveModule() {
    const shell = useShell();
    function editInBold(file) {shell.open_workspace_tab(file); shell.set_active_module("docs");}
    const [connection, setConnection] = useState(null), [reconnectView, setReconnectView] = useState(false), [view, setView] = useState("home"), [path, setPath] = useState([]), [drive, setDrive] = useState("");
    const [files, setFiles] = useState([]), [suggested, setSuggested] = useState([]), [drives, setDrives] = useState([]), [about, setAbout] = useState(null);
    const [layout, setLayout] = useState("list"), [order, setOrder] = useState(""), [type, setType] = useState(""), [owner, setOwner] = useState(""), [ownerDraft, setOwnerDraft] = useState(""), [after, setAfter] = useState(""), [search, setSearch] = useState(""), [query, setQuery] = useState("");
    const [restoredFor, setRestoredFor] = useState(""), [displayReady, setDisplayReady] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const cacheNamespace = cacheScope(connection, http.getSession().assignmentId);
    const identityTicket = useRef(0), loadLock = useRef(false), pageCount = useRef(1), lastQuery = useRef(""), currentCache = useRef(cacheNamespace); currentCache.current = cacheNamespace;
    const [next, setNext] = useState(""), [busy, setBusy] = useState(false), [working, setWorking] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
    const [selected, setSelected] = useState([]), [menu, setMenu] = useState(null), [newMenu, setNewMenu] = useState(false), [details, setDetails] = useState(false), [modal, setModal] = useState(null);
    const [foldersOpen, setFoldersOpen] = useState(true), [filesOpen, setFilesOpen] = useState(true), [drop, setDrop] = useState(null), [dragging, setDragging] = useState([]), [queue, setQueue] = useState([]), [revision, setRevision] = useState(0);
    const mutationBusy = useRef(false), anchor = useRef(null), requests = useRef(0), uploadController = useRef(null), uploads = useRef(false), uploadInput = useRef(null), folderInput = useRef(null), mounted = useRef(true), filesRef = useRef([]), selectedRef = useRef([]), scope = useRef(0);
    filesRef.current = files; selectedRef.current = selected;
    const parent = path.at(-1)?.id || drive || "root", home = view === "home" && !query;
    const activeFiles = [...files, ...suggested.filter(file => !files.some(row => row.id === file.id))];
    const chosen = activeFiles.filter(file => selected.includes(file.id)), current = chosen[0];
    const [preparedDownload, setPreparedDownload] = useState(null);
    useLayoutEffect(() => {++requests.current; loadLock.current?.controller?.abort(); ++identityTicket.current; setDisplayReady(false); filesRef.current = []; setFiles([]); setSuggested([]); setAbout(null); setDrives([]); setSelected([]); setDetails(false); setModal(null);}, [cacheNamespace]);
    useEffect(() => () => {if (preparedDownload) URL.revokeObjectURL(preparedDownload.url);}, [preparedDownload]);
    const preferenceKey = connection?.preference_key ? `bold:drive:${connection.preference_key}` : null;
    useEffect(() => {mounted.current = true; restoreGoogleConnection(`account:${http.getSession().email}:${http.getSession().assignmentId}`, "drive", () => workspaceApi.connection(), value => {if (mounted.current) {setConnection(value); shell.sync_workspace_account(value);}}).catch(problem => {if (mounted.current) setError(problem.message);}); return () => {mounted.current = false; ++requests.current; loadLock.current?.controller?.abort(); ++scope.current; uploadController.current?.abort();};}, []);
    useEffect(() => {if (!preferenceKey) return; try {const saved = JSON.parse(localStorage.getItem(preferenceKey) || "{}"); if (["list", "grid"].includes(saved.layout)) setLayout(saved.layout); if (["", "folder,name", "folder,name desc", "modifiedTime desc", "quotaBytesUsed desc"].includes(saved.order)) setOrder(saved.order || "");} catch {}}, [preferenceKey]);
    function preference(name, value) {if (name === "layout") setLayout(value); else setOrder(value); try {if (preferenceKey) localStorage.setItem(preferenceKey, JSON.stringify({layout, order, [name]: value}));} catch {}}
    async function load(page = "", force = false) {
        const params = {view: ["home", "drives"].includes(view) ? "all" : view, parent: query || home || ["recent", "storage", "shared", "starred", "trash"].includes(view) && !path.length ? "" : parent, drive, search: query, type, owner, after, order};
        const key = "drive:data:" + JSON.stringify(params), context = cacheNamespace;
        if (!context || loadLock.current?.key === context + key && loadLock.current.ticket === requests.current && !force) return;
        const ticket = ++requests.current; loadLock.current?.controller?.abort(); const controller = new AbortController(), options = {signal: controller.signal}; loadLock.current = {key: context + key, ticket, controller}; setError("");
        const valid = () => ticket === requests.current && mounted.current && context === currentCache.current;
        try {
            const cached = !page ? await googleCache.get(context, key) : null;
            if (!valid()) return;
            const changed = lastQuery.current !== context + key; lastQuery.current = context + key;
            if (cached) {setFiles(cached.files); filesRef.current = cached.files; setSuggested(cached.suggested); setNext(cached.next); pageCount.current = cached.pages || 1;}
            else if (changed) {setFiles([]); filesRef.current = []; setSuggested([]); setNext(""); pageCount.current = 1;}
            setBusy(!cached && !page && !filesRef.current.length); setRefreshing(Boolean(cached || page || filesRef.current.length)); setDisplayReady(true);
            const confirmed = await workspaceApi.connection(options);
            if (!valid()) return;
            if (cacheScope(confirmed, http.getSession().assignmentId) !== context) {setFiles([]); filesRef.current = []; setSuggested([]); setAbout(null); setDrives([]); setConnection(confirmed); return;}
            let result, folders = [], combined = [], token = page, pages = page ? 1 : pageCount.current;
            if (home) {
                const results = await Promise.all([workspaceApi.files({...params, view: "recent", order: "viewedByMeTime desc", page: token}, options), workspaceApi.files({...params, view: "all", type: "folder", order: "modifiedTime desc", page: ""}, options)]);
                result = results[0]; folders = results[1].files.slice(0, 8); combined = result.files;
                for (let index = 1; !page && index < pages && result.nextPageToken; index++) {result = await workspaceApi.files({...params, view: "recent", order: "viewedByMeTime desc", page: result.nextPageToken}, options); combined.push(...result.files);}
            } else if (view === "drives" && !drive) result = {files: []};
            else {
                for (let index = 0; index < pages; index++) {result = await workspaceApi.files({...params, page: token}, options); combined.push(...result.files); token = result.nextPageToken; if (!token) break;}
            }
            if (!valid()) return;
            const seen = new Map((page ? [...filesRef.current, ...combined] : combined).map(file => [file.id, file]));
            const payload = {files: [...seen.values()], suggested: folders, next: result.nextPageToken || "", pages: page ? pageCount.current + 1 : pages};
            const content = rows => rows.map(({thumbnailLink, viewedByMeTime, ...file}) => file);
            if (cachedContentChanged(cached && {files: content(cached.files), suggested: content(cached.suggested)}, {files: content(payload.files), suggested: content(payload.suggested)})) announceBackgroundUpdate("Drive actualizado: hay archivos nuevos o modificados.");
            pageCount.current = payload.pages; filesRef.current = payload.files;
            setFiles(payload.files); setSuggested(folders); setNext(payload.next);
            await googleCache.put(context, key, payload);
        } catch (problem) {
            if (valid()) {setDisplayReady(true); if ([401, 403, 409].includes(problem.status)) {await googleCache.invalidate(context); if (!valid()) return; setFiles([]); filesRef.current = []; setSuggested([]); setAbout(null); setDrives([]);} setError((filesRef.current.length ? "Mostrando datos guardados. " : "") + problem.message);}
        } finally {if (loadLock.current?.ticket === ticket) loadLock.current = false; if (valid()) {setBusy(false); setRefreshing(false);}}
    }
    useEffect(() => {++scope.current; setSelected([]); setMenu(null); if (restoredFor === cacheNamespace && connection?.services?.drive?.status === "available" && !reconnectView) load(); return () => {++requests.current;};}, [cacheNamespace, restoredFor, connection?.services?.drive?.status, reconnectView, view, parent, query, type, owner, after, order, drive]);
    useEffect(() => {if (!cacheNamespace || restoredFor !== cacheNamespace || reconnectView || connection?.services?.drive?.status !== "available") return; return backgroundRefresh(() => load());}, [cacheNamespace, restoredFor, reconnectView, view, parent, query, type, owner, after, order, drive]);
    useEffect(() => {const clear = () => {++identityTicket.current; ++requests.current; setFiles([]); filesRef.current = []; setSuggested([]); setAbout(null); setDrives([]); setConnection(null); setReconnectView(true);}; globalThis.addEventListener("bold:google-cache-cleared", clear); return () => globalThis.removeEventListener("bold:google-cache-cleared", clear);}, []);
    useEffect(() => {
        if (!shell.drive_folder || !cacheNamespace || restoredFor !== cacheNamespace) return;
        const folder = shell.drive_folder;
        let alive = true;
        workspaceApi.metadata(folder.id).then(file => {
            if (!alive) return;
            setView("my"); setPath([{id: file.id, name: file.name}]); setDrive(file.driveId || "");
            setQuery(""); setSearch(""); setType(""); setOwner(""); setAfter(""); setSelected([]);
            shell.finish_drive_folder(folder.requestId);
        }).catch(problem => {if (alive) {setError(problem.message); shell.finish_drive_folder(folder.requestId);}});
        return () => {alive = false;};
    }, [shell.drive_folder?.requestId, cacheNamespace, restoredFor]);
    useEffect(() => {if (cacheNamespace && restoredFor === cacheNamespace) googleCache.put(cacheNamespace, "drive:navigation", {view, path, drive, query, search, type, owner, after});}, [cacheNamespace, restoredFor, view, path, drive, query, search, type, owner, after]);
    useEffect(() => {let alive = true; if (cacheNamespace) googleCache.get(cacheNamespace, "drive:navigation").then(saved => {if (!alive) return; setRestoredFor(cacheNamespace); if (!saved) return; if (!shell.drive_folder) {setView(saved.view); setPath(saved.path || []);} setDrive(saved.drive || ""); setQuery(saved.query || ""); setSearch(saved.search || ""); setType(saved.type || ""); setOwner(saved.owner || ""); setAfter(saved.after || "");}); return () => {alive = false;};}, [cacheNamespace]);
    useEffect(() => {
        let alive = true; const identity = identityTicket.current;
        if (connection?.services?.drive?.status === "available") {
            (async () => {try {
                const saved = await googleCache.get(cacheNamespace, "drive:aux");
                if (alive && identity === identityTicket.current && saved) {setAbout(saved.about); setDrives(saved.drives);}
                const info = await workspaceApi.about(); let page = "", rows = [];
                do {const result = await workspaceApi.drives(page); if (!alive) return; rows.push(...result.drives); page = result.nextPageToken || "";} while (page);
                if (alive && identity === identityTicket.current) {setAbout(info); setDrives(rows); await googleCache.put(cacheNamespace, "drive:aux", {about: info, drives: rows});}
            } catch (problem) {if (alive) setError(problem.message);}})();
        }
        return () => {alive = false;};
    }, [cacheNamespace]);
    useEffect(() => {
        const close = event => {if (!event.target.closest(".drive_menu_anchor,.drive_context")) {setMenu(null); setNewMenu(false);}};
        const key = event => {if (event.key === "Escape" && !modal) {setMenu(null); setNewMenu(false); setSelected([]);}};
        document.addEventListener("pointerdown", close); document.addEventListener("keydown", key);
        return () => {document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", key);};
    }, [modal]);
    function navigate(id) {setView(id); setPath([]); setDrive(""); setQuery(""); setSearch(""); setType(""); setOwner(""); setOwnerDraft(""); setAfter(""); setNotice("");}
    function folder(file) {setView("my"); setPath(old => [...old, file]); setSearch(""); setQuery(""); setType("");}
    function original(file) {window.open(googleFileUrl(file, connection.email), "_blank", "noopener,noreferrer");}
    function open(file) {if (isDriveFolder(file)) folder(file); else if (kindOf(file)) editInBold(file); else if (officeInBold(file) && connection?.editors_enabled) {
        setNotice("Preparando el archivo para BOLD…");
        const openingScope = scope.current;
        action(async () => {const converted = await workspaceApi.openOffice(file.id); if (mounted.current && openingScope === scope.current) editInBold(converted);});
    } else if (previewable(file)) setModal({kind: "preview", file}); else original(file);}
    function pick(file, event) {setSelected(old => selectDriveFile(old, file.id, {toggle: event.ctrlKey || event.metaKey, range: event.shiftKey, anchor: anchor.current, files})); if (!event.shiftKey) anchor.current = file.id;}
    async function action(operation, message = "Cambios guardados en Google Drive.") {
        if (mutationBusy.current) return; mutationBusy.current = true; const context = scope.current; setWorking(true); setError(""); setMenu(null); setNewMenu(false);
        try {await operation(); await googleCache.invalidate(cacheNamespace, "drive:data:"); if (mounted.current && context === scope.current) {setNotice(message); setSelected([]); setRevision(value => value + 1); await load("", true);}}
        catch (problem) {if (mounted.current && context === scope.current) {await load("", true).catch(() => {}); setError(problem.message);}}
        finally {mutationBusy.current = false; if (mounted.current) setWorking(false);}
    }
    async function create(kind, name, destination = parent) {
        if (mutationBusy.current) return;
        setModal(null);
        await action(async () => {const result = await workspaceApi.create({type: kind, name, parent: destination}); if (kind !== "folder") editInBold(result);});
    }
    async function mutate(rows, body) {await action(async () => {const failures = []; for (const file of rows) {try {await workspaceApi.update(file.id, body);} catch (problem) {failures.push(`${file.name}: ${problem.message}`);}} if (failures.length) throw new Error(failures.join(" · "));});}
    async function moveRows(rows, target) {
        if (mutationBusy.current || !rows.length) return;
        if (rows.some(file => !canMove(file) || file.id === target)) {setError("Este destino o archivo no permite mover la selección."); return;}
        mutationBusy.current = true; const context = scope.current, snapshot = filesRef.current, ids = rows.map(file => file.id);
        ++requests.current; setBusy(false); setWorking(true); setMenu(null); setModal(null); setDragging([]); setDrop(null); setError("");
        setFiles(old => optimisticMove(old, ids, {home, view}));
        const failures = [];
        for (const file of rows) {try {await workspaceApi.move(file.id, target);} catch (problem) {failures.push({file, message: problem.message});}}
        if (!mounted.current) {mutationBusy.current = false; return;}
        if (context === scope.current) {
            if (failures.length) {const failed = new Set(failures.map(value => value.file.id)); setFiles(old => snapshot.filter(file => old.some(row => row.id === file.id) || failed.has(file.id)));}
            await googleCache.invalidate(cacheNamespace, "drive:data:"); await load("", true); setRevision(value => value + 1); setSelected([]); setNotice(failures.length ? "Movimiento completado parcialmente." : "Archivos movidos.");
        }
        if (failures.length) setError(failures.map(({file, message}) => `${file.name}: ${message}`).join(" · "));
        mutationBusy.current = false; setWorking(false);
    }
    function dropInto(event, target) {if (Array.from(event.dataTransfer.types).includes("Files")) return; event.preventDefault(); event.stopPropagation(); const ids = dragging.length ? dragging : []; moveRows(activeFiles.filter(file => ids.includes(file.id)), target);}
    async function download(file, format = "pdf") {
        await action(async () => {const blob = await workspaceApi.download(file.id, format); setPreparedDownload(triggerDownload(blob, file.name + (isDriveFolder(file) ? ".zip" : kindOf(file) ? `.${format}` : "")));}, "Descarga preparada.");
    }
    async function enqueue(items, destination = parent) {
        if (uploads.current || !items.length) return;
        uploads.current = true; const context = scope.current, jobs = items.map((file, index) => ({id: index, name: file.webkitRelativePath || file.name, status: "pendiente"}));
        setQueue(jobs); setNewMenu(false); const controller = new AbortController(); uploadController.current = controller;
        const status = (index, state, message = "") => {if (mounted.current) setQueue(old => old.map(job => job.id === index ? {...job, status: state, message} : job));};
        await uploadDriveFiles(items, destination, {signal: controller.signal, status});
        await googleCache.invalidate(cacheNamespace, "drive:data:").catch(() => {});
        uploads.current = false; uploadController.current = null;
        if (mounted.current && context === scope.current) {setRevision(value => value + 1); await load("", true);}
    }
    function fileMenu(file) {
        const capability = file.capabilities || {}, kind = kindOf(file);
        return <><button onClick={() => {setMenu(null); open(file);}}>Abrir</button><button onClick={() => original(file)}>Abrir en Google <ExternalLink size={15}/></button><button onClick={async () => {try {await navigator.clipboard.writeText(isDriveFolder(file) ? `https://drive.google.com/drive/folders/${encodeURIComponent(file.id)}` : googleFileUrl(file, connection.email)); setNotice("Enlace copiado."); setMenu(null);} catch {setError("El navegador no permitió copiar el enlace.");}}}>Copiar enlace</button>{capability.canRename && <button onClick={() => {setModal({kind: "rename", file}); setMenu(null);}}>Cambiar nombre</button>}<button onClick={() => mutate([file], {starred: !file.starred})}>{file.starred ? "Quitar de destacados" : "Añadir a destacados"}</button>{isDriveFolder(file) && <button onClick={() => {setModal({kind: "color", file}); setMenu(null);}}>Color de carpeta</button>}{canMove(file) && <button onClick={() => {setModal({kind: "move", rows: [file]}); setMenu(null);}}>Mover</button>}{capability.canCopy && !isDriveFolder(file) && <button onClick={() => action(() => workspaceApi.copy(file.id))}>Hacer una copia</button>}<button onClick={() => {setModal({kind: "share", file}); setMenu(null);}}>Compartir y ver permisos</button>{capability.canDownload && <><button onClick={() => download(file)}>{isDriveFolder(file) ? "Descargar como ZIP" : kind ? "Descargar PDF" : "Descargar"}</button>{kind && <button onClick={() => download(file, {docs: "docx", sheets: "xlsx", slides: "pptx"}[kind])}>Descargar Office</button>}</>}<button onClick={() => {setSelected([file.id]); setDetails(true); setMenu(null);}}>Información</button>{!file.trashed && capability.canTrash && <button onClick={() => {setModal({kind: "trash", rows: [file]}); setMenu(null);}}>Mover a papelera</button>}{file.trashed && capability.canUntrash && <button onClick={() => mutate([file], {trashed: false})}>Restaurar</button>}</>;
    }
    const rowEvents = file => ({
        tabIndex: 0, onClick: event => pick(file, event), onDoubleClick: () => open(file),
        onKeyDown: event => {if (event.target !== event.currentTarget) return; if (event.key === "Enter") open(file); if (event.key === " ") {event.preventDefault(); pick(file, event);} if (event.key === "Delete" && file.capabilities?.canTrash) setModal({kind: "trash", rows: selectedRef.current.includes(file.id) ? activeFiles.filter(row => selectedRef.current.includes(row.id)) : [file]});},
        onContextMenu: event => {event.preventDefault(); setSelected([file.id]); setMenu({id: file.id, point: {x: event.clientX, y: event.clientY}});},
        draggable: canMove(file) && !working,
        onDragStart: event => {const rows = selected.includes(file.id) ? chosen : [file]; if (rows.some(row => !canMove(row))) {event.preventDefault(); return;} const ids = rows.map(row => row.id); setDragging(ids); setSelected(ids); event.dataTransfer.setData("application/x-bold-drive", JSON.stringify(ids)); event.dataTransfer.effectAllowed = "move";},
        onDragEnd: () => {setDragging([]); setDrop(null);},
        onDragOver: event => {if (dragging.length && isDriveFolder(file) && file.capabilities?.canAddChildren && !dragging.includes(file.id)) {event.preventDefault(); setDrop(file.id);}},
        onDrop: event => {if (isDriveFolder(file) && file.capabilities?.canAddChildren) dropInto(event, file.id);},
    });
    function renderFiles(rows) {
        if (layout === "grid") return <div className="drive_grid" role="list" aria-label="Archivos">{rows.map(file => <article role="listitem" key={file.id} {...rowEvents(file)} aria-label={file.name} className={`drive_card ${selected.includes(file.id) ? "is_selected" : ""} ${drop === file.id ? "is_drop" : ""} ${dragging.includes(file.id) ? "is_dragging" : ""}`}><div className="drive_card_title"><FileIcon file={file}/>{(kindOf(file) || officeFileKind(file)) ? <button className="drive_native_name" onDoubleClick={event => event.stopPropagation()} onClick={event => {event.stopPropagation(); if (event.ctrlKey || event.metaKey || event.shiftKey) pick(file, event); else open(file);}}>{file.name}</button> : <span>{file.name}</span>}<button aria-label={`Opciones de ${file.name}`} onDoubleClick={event => event.stopPropagation()} onClick={event => {event.stopPropagation(); setMenu({id: file.id, anchor: event.currentTarget});}}><MoreVertical size={19}/></button></div><FileThumbnail file={file} cacheNamespace={cacheNamespace}/><footer><span>{file.owners?.[0]?.displayName || "Unidad compartida"}</span>{file.starred && <Star size={15}/>}</footer></article>)}</div>;
        return <div className="drive_table_wrap"><table className="drive_table" aria-label="Archivos"><thead><tr><th>Nombre</th><th>Propietario</th><th>{view === "recent" ? "Última apertura" : "Última modificación"}</th><th>Tamaño</th><th><span className="drive_sr">Acciones</span></th></tr></thead><tbody>{rows.map(file => <tr key={file.id} {...rowEvents(file)} aria-selected={selected.includes(file.id)} className={`${selected.includes(file.id) ? "is_selected" : ""} ${drop === file.id ? "is_drop" : ""} ${dragging.includes(file.id) ? "is_dragging" : ""}`}><td><div className="drive_file_title"><button className="drive_select" aria-label={`${selected.includes(file.id) ? "Deseleccionar" : "Seleccionar"} ${file.name}`} onClick={event => {event.stopPropagation(); setSelected(old => selectDriveFile(old, file.id, {toggle: true}));}}>{selected.includes(file.id) ? <Check size={16}/> : <FileIcon file={file}/>}</button>{(kindOf(file) || officeFileKind(file)) ? <button className="drive_native_name" onDoubleClick={event => event.stopPropagation()} onClick={event => {event.stopPropagation(); if (event.ctrlKey || event.metaKey || event.shiftKey) pick(file, event); else open(file);}}>{file.name}</button> : <span>{file.name}</span>}{file.starred && <Star size={14}/>}</div></td><td>{file.owners?.[0]?.displayName || "Unidad compartida"}</td><td>{dateLabel(view === "recent" ? file.viewedByMeTime : file.modifiedTime)}</td><td>{isDriveFolder(file) ? "—" : bytesLabel(file.size || file.quotaBytesUsed)}</td><td><button aria-label={`Opciones de ${file.name}`} onClick={event => {event.stopPropagation(); setMenu({id: file.id, anchor: event.currentTarget});}}><MoreVertical size={19}/></button></td></tr>)}</tbody></table></div>;
    }
    const fileDrop = useFileDrop(items => {
        if (connection?.services?.drive?.status !== "available" || reconnectView || uploads.current || modal) {setError("Conecta Google y termina la operación abierta antes de subir archivos."); return;}
        setModal({kind: "upload", items});
    });
    return <section className="drive_module"><BackgroundSyncNotice active={refreshing || busy} label="Actualizando Drive…" />
        {fileDrop && <div className="drive_drop_hint" role="status"><Upload size={28}/><strong>Suelta aquí para subir</strong><span>Word, Excel, PowerPoint y otros archivos · Luego elige la carpeta</span></div>}<header className="drive_top"><div className="drive_brand"><Cloud size={30}/><strong>Drive</strong><span>BOLD</span></div><form className="drive_search" onSubmit={event => {event.preventDefault(); setQuery(search); setPath([]); setDrive("");}}><Search size={21}/><input aria-label="Buscar en Drive" placeholder="Buscar en Drive" value={search} onChange={event => setSearch(event.target.value)}/>{search && <button type="button" aria-label="Borrar búsqueda" onClick={() => {setSearch(""); setQuery("");}}><X size={18}/></button>}<button aria-label="Buscar" type="submit"><Search size={18}/></button></form><a className="drive_icon_button" title="Gemini — abrir en Google" aria-label="Gemini — abrir en Google" href={googleUrl(connection?.email)} target="_blank" rel="noopener noreferrer"><Sparkles size={22}/></a><span className="drive_account_email" title={connection?.email} aria-label="Cuenta Google conectada">{connection?.email || "Sin cuenta Google conectada"}</span></header>
        {!connection || !reconnectView && connection.services?.drive?.status === "available" && (restoredFor !== cacheNamespace || !displayReady) ? <div className="drive_loading" role="status">{error ? <>{error}<button onClick={() => connection ? load() : workspaceApi.connection().then(setConnection).catch(problem => setError(problem.message))}>Reintentar</button></> : "Cargando Drive…"}</div> : connection?.services?.drive?.status !== "available" || reconnectView ? <div className="drive_connect">{error && <p role="alert">{error}</p>}<GoogleConnection onConnected={value => {setConnection(value); shell.sync_workspace_account(value); setReconnectView(false);}}/></div> : <div className="drive_body">
            <aside className="drive_sidebar"><div className="drive_menu_anchor"><button className="drive_new" aria-expanded={!!newMenu} aria-haspopup="menu" onClick={event => {const anchor = event.currentTarget; setNewMenu(value => value ? null : anchor);}}><Plus size={24}/>Nuevo</button>{newMenu && <FloatingMenu anchor={newMenu} close={() => setNewMenu(null)} label="Nuevo"><button onClick={() => {setNewMenu(false); setModal({kind: "create", type: "folder"});}}><Folder size={19}/>Nueva carpeta</button><button onClick={() => uploadInput.current.click()}><Upload size={19}/>Subir archivos</button><button onClick={() => folderInput.current.click()}><Folder size={19}/>Subir carpeta</button><hr/>{Object.entries(types).map(([kind, [label, , Icon, color]]) => <button key={kind} onClick={() => {setNewMenu(false); setModal({kind: "create", type: kind});}}><Icon size={19} style={{color}}/>{label}</button>)}</FloatingMenu>}</div>
                <nav aria-label="Navegación de Drive">{navigation.map(([id, label, Icon]) => <div key={id}><button aria-current={view === id ? "page" : undefined} className={`${view === id ? "is_active" : ""} ${id === "my" && drop === "root" ? "is_drop" : ""}`} onClick={() => navigate(id)} onDragOver={event => {if (id === "my" && dragging.length) {event.preventDefault(); setDrop("root");}}} onDrop={event => {if (id === "my") dropInto(event, "root");}}><Icon size={19}/>{label}</button>{id === "my" && <FolderTree key={connection.email} active={path.at(-1)?.id} disabled={working} onNavigate={rows => {setView("my"); setDrive(""); setPath(rows); setQuery(""); setSearch(""); setType("");}} onDrop={moveRows} selectedFiles={chosen} connection={connection.email} revision={revision}/>}</div>)}</nav>
                <div className="drive_quota"><progress max={Number(about?.storageQuota?.limit) || Number(about?.storageQuota?.usage) || 1} value={Number(about?.storageQuota?.usage) || 0}/><small>{bytesLabel(about?.storageQuota?.usage)} {about?.storageQuota?.limit ? `de ${bytesLabel(about.storageQuota.limit)} en uso` : "en uso"}</small></div>
                <div className="drive_external_nav">{["Actividad", "Proyectos", "Espacios de trabajo", "Spam"].map(label => <a key={label} href={googleUrl(connection.email, {Proyectos: "projects", Spam: "spam"}[label] || "home")} title={`${label}: disponible en Google Drive`} target="_blank" rel="noopener noreferrer">{label}<ExternalLink size={13}/></a>)}<a href={googleUrl(connection.email)} target="_blank" rel="noopener noreferrer">Abrir Drive en Google<ExternalLink size={13}/></a></div>
            </aside>
            <main className="drive_main" aria-busy={busy}>
                <div className="drive_heading"><h1>{query ? `Resultados de «${query}»` : path.at(-1)?.name || (drive ? drives.find(row => row.id === drive)?.name : navigation.find(row => row[0] === view)?.[1]) || "Drive"}</h1><div className="drive_view_buttons"><button aria-label="Actualizar" disabled={busy || working} onClick={() => load()}><RefreshCw size={18}/></button><button aria-label="Vista de lista" aria-pressed={layout === "list"} onClick={() => preference("layout", "list")}><List size={20}/></button><button aria-label="Vista de cuadrícula" aria-pressed={layout === "grid"} onClick={() => preference("layout", "grid")}><LayoutGrid size={20}/></button><button aria-label="Ver detalles" aria-pressed={details} onClick={() => setDetails(value => !value)}><Info size={20}/></button></div></div>
                {path.length > 0 && <nav className="drive_breadcrumbs" aria-label="Ruta"><button onClick={() => setPath([])}>Mi unidad</button>{path.map((file, index) => <span key={file.id}><ChevronRight size={15}/><button onClick={() => setPath(old => old.slice(0, index + 1))} onDragOver={event => {if (dragging.length) event.preventDefault();}} onDrop={event => dropInto(event, file.id)}>{file.name}</button></span>)}</nav>}
                {!home && <div className="drive_filters"><select aria-label="Tipo de archivo" value={type} onChange={event => setType(event.target.value)}><option value="">Tipo</option>{Object.entries(types).map(([id, [label]]) => <option value={id} key={id}>{label}</option>)}<option value="folder">Carpetas</option><option value="pdf">PDF</option><option value="image">Imágenes</option></select><input type="text" aria-label="Propietario" placeholder="Propietario: correo o me" value={ownerDraft} onChange={event => setOwnerDraft(event.target.value)} onBlur={() => setOwner(ownerDraft.trim())} onKeyDown={event => {if (event.key === "Enter") setOwner(ownerDraft.trim());}}/><input type="date" aria-label="Modificado desde" value={after} onChange={event => setAfter(event.target.value)}/><select aria-label="Ordenar archivos" value={order} onChange={event => preference("order", event.target.value)}><option value="">Orden predeterminado</option><option value="folder,name">Nombre A–Z</option><option value="folder,name desc">Nombre Z–A</option><option value="modifiedTime desc">Modificado recientemente</option><option value="quotaBytesUsed desc">Mayor tamaño</option></select>{(type || owner || after) && <button onClick={() => {setType(""); setOwner(""); setOwnerDraft(""); setAfter("");}}>Borrar filtros</button>}</div>}
                {error && <div className="drive_error" role="alert">{error}<button onClick={() => load()}>Reintentar</button><button onClick={() => setReconnectView(true)}>Reconectar Google</button></div>}{notice && <div className="drive_notice" role="status">{notice}<button aria-label="Cerrar aviso" onClick={() => setNotice("")}><X size={16}/></button></div>}
                {preparedDownload && <div className="drive_notice" role="status"><span>Si la descarga no comenzó, <a href={preparedDownload.url} download={preparedDownload.name}>descargar {preparedDownload.name}</a></span><button aria-label="Cerrar descarga preparada" onClick={() => setPreparedDownload(null)}><X size={16}/></button></div>}
                {!!chosen.length && <div className="drive_selection"><button aria-label="Cancelar selección" onClick={() => setSelected([])}><X size={18}/></button><span>{chosen.length} seleccionados</span>{chosen.every(canMove) && <button disabled={working} onClick={() => setModal({kind: "move", rows: chosen})}><Move size={18}/>Mover</button>}<button disabled={working} onClick={() => mutate(chosen, {starred: true})}><Star size={18}/>Destacar</button>{chosen.every(file => file.trashed && file.capabilities?.canUntrash) ? <button disabled={working} onClick={() => mutate(chosen, {trashed: false})}>Restaurar</button> : chosen.every(file => !file.trashed && file.capabilities?.canTrash) && <button disabled={working} onClick={() => setModal({kind: "trash", rows: chosen})}><Trash2 size={18}/>Papelera</button>}{chosen.length === 1 && <button onClick={() => setModal({kind: "share", file: current})}><Users size={18}/>Compartir</button>}</div>}
                {view === "trash" && <p className="drive_hint">Puedes restaurar archivos aquí. <a href={googleUrl(connection.email, "trash")} target="_blank" rel="noopener noreferrer">Eliminar definitivamente o vaciar en Google <ExternalLink size={13}/></a></p>}
                {view === "storage" && <p className="drive_hint">Almacenamiento de la cuenta: {bytesLabel(about?.storageQuota?.usage)}. Drive: {bytesLabel(about?.storageQuota?.usageInDrive)}.</p>}
                {view === "drives" && !drive && !query ? <div className="drive_grid">{drives.map(row => <button className="drive_shared_drive" key={row.id} onClick={() => {setDrive(row.id); setPath([]);}}><Users size={35}/>{row.name}</button>)}{!drives.length && <p>No tienes unidades compartidas disponibles.</p>}</div> : home ? <><h2 className="drive_welcome">Te damos la bienvenida a Drive</h2><button className="drive_section_toggle" aria-expanded={foldersOpen} onClick={() => setFoldersOpen(value => !value)}>{foldersOpen ? <ChevronDown size={18}/> : <ChevronRight size={18}/>}Carpetas sugeridas</button>{foldersOpen && <div className="drive_suggestions">{suggested.map(file => <button key={file.id} {...rowEvents(file)} onClick={() => {setSelected([file.id]);}} className={selected.includes(file.id) ? "is_selected" : ""}><FileIcon file={file}/><span><strong>{file.name}</strong><small>{file.shared ? "Compartida" : "Mi unidad"}</small></span></button>)}{!suggested.length && <p>{busy ? "Cargando carpetas…" : "No hay carpetas disponibles."}</p>}</div>}<button className="drive_section_toggle" aria-expanded={filesOpen} onClick={() => setFilesOpen(value => !value)}>{filesOpen ? <ChevronDown size={18}/> : <ChevronRight size={18}/>}Archivos recientes</button>{filesOpen && renderFiles(files)}</> : renderFiles(files)}
                {!busy && !files.length && !(view === "drives" && !drive) && <div className="drive_empty"><Folder size={48}/><p>{query ? "No se encontraron archivos." : "No hay archivos en esta vista."}</p></div>}{next && <button disabled={busy} className="drive_more" onClick={() => load(next)}>Cargar más archivos</button>}
            </main>
            {details && <aside className="drive_details"><header><h2>Detalles</h2><button aria-label="Cerrar detalles" onClick={() => setDetails(false)}><X size={18}/></button></header>{current ? <><FileIcon file={current} size={48}/><h3>{current.name}</h3><dl><dt>Tipo</dt><dd>{isDriveFolder(current) ? "Carpeta" : types[kindOf(current)]?.[0] || current.mimeType}</dd><dt>Propietario</dt><dd>{current.owners?.map(person => person.displayName || person.emailAddress).join(", ") || "Unidad compartida"}</dd><dt>Creado</dt><dd>{dateLabel(current.createdTime)}</dd><dt>Modificado</dt><dd>{dateLabel(current.modifiedTime)}</dd><dt>Tamaño</dt><dd>{bytesLabel(current.size || current.quotaBytesUsed)}</dd>{current.description && <><dt>Descripción</dt><dd>{current.description}</dd></>}</dl><button onClick={() => setModal({kind: "share", file: current})}>Ver acceso</button></> : <p>Selecciona un archivo para ver su información.</p>}</aside>}
            <aside className="drive_tools" aria-label="Accesos a módulos de BOLD">{[["Calendario", Calendar, "calendar"], ["Tareas", CheckCircle, "tasks"]].map(([label, Icon, module]) => <button type="button" key={module} onClick={() => shell.set_active_module(module)} aria-label={`Abrir ${label} en BOLD`} title={`Abrir ${label} en BOLD`}><Icon size={20}/></button>)}</aside>
        </div>}
        <input ref={uploadInput} hidden type="file" multiple onChange={event => {const items = [...event.target.files]; event.target.value = ""; enqueue(items);}}/><input ref={folderInput} hidden type="file" multiple webkitdirectory="" onChange={event => {const items = [...event.target.files]; event.target.value = ""; enqueue(items);}}/>
        {menu && activeFiles.some(file => file.id === menu.id) && <FloatingMenu anchor={menu.anchor} point={menu.point} close={() => setMenu(null)} label="Acciones de archivo">{fileMenu(activeFiles.find(file => file.id === menu.id))}</FloatingMenu>}
        {!!queue.length && createPortal(<div className="drive_overlay_root"><aside className="drive_upload_queue" aria-label="Progreso de cargas"><header><strong>Cargas ({queue.filter(job => job.status === "listo").length}/{queue.length})</strong><button onClick={() => {if (uploads.current) uploadController.current?.abort(); else setQueue([]);}}>{uploads.current ? "Cancelar" : "Cerrar"}</button></header><progress max={queue.length} value={queue.filter(job => !["pendiente", "subiendo"].includes(job.status)).length}/>{queue.map(job => <div key={job.id}><span>{job.name}</span><small>{job.status}{job.status === "subiendo" && <progress/>}{job.message && `: ${job.message}`}</small></div>)}</aside></div>, document.body)}
        {modal && <Modal title={{create: "Crear archivo o carpeta", rename: "Cambiar nombre", trash: "Mover a papelera", move: "Mover archivos", share: "Compartir", color: "Color de carpeta", preview: modal.file?.name, upload: "Guardar archivos en Drive", destination: "Elegir dónde crear el archivo"}[modal.kind]} wide={modal.kind === "preview"} close={() => setModal(null)}>
            {["create", "rename"].includes(modal.kind) && <NameForm initial={modal.file?.name || (modal.type === "folder" ? "Nueva carpeta" : "Sin título")} submit={name => modal.kind === "create" ? (modal.type === "folder" ? create(modal.type, name) : setModal({kind: "destination", type: modal.type, name})) : (setModal(null), mutate([modal.file], {name}))}/>} 
            {modal.kind === "trash" && <><p>¿Mover {modal.rows.length === 1 ? `«${modal.rows[0].name}»` : `${modal.rows.length} archivos`} a la papelera de Google Drive? Puedes restaurarlos después.</p><button onClick={() => {const rows = modal.rows; setModal(null); mutate(rows, {trashed: true});}}>Mover a papelera</button></>}
            {modal.kind === "destination" && <DriveFolderPicker drives={drives} initialRoot={drive || "root"} initialPath={path} label="Crear aquí" submit={target => create(modal.type, modal.name, target)}/>}
            {modal.kind === "upload" && <><p>{modal.items.length} archivo(s). Elige la carpeta de destino antes de subirlos.</p><DriveFolderPicker drives={drives} initialRoot={drive || "root"} initialPath={path} label="Subir aquí" submit={target => {const items = modal.items; setModal(null); enqueue(items, target);}}/></>}
            {modal.kind === "move" && <DriveFolderPicker rows={modal.rows} drives={drives} submit={target => moveRows(modal.rows, target)}/>}
            {modal.kind === "share" && <SharePermissions file={modal.file} report={setNotice}/>}
            {modal.kind === "color" && <><ColorPicker label="Color de carpeta" value={modal.color || modal.file.folderColorRgb || "#5f6368"} onChange={color => setModal(value => ({...value,color}))}/><button onClick={() => {const file=modal.file, color=modal.color || file.folderColorRgb || "#5f6368";setModal(null);mutate([file],{folderColorRgb:color});}}>Guardar color</button></>}
            {modal.kind === "preview" && <Preview file={modal.file} openGoogle={() => original(modal.file)}/>}
        </Modal>}
    </section>;
}

function NameForm({initial, submit}) {
    const [name, setName] = useState(initial);
    return <form className="drive_form" onSubmit={event => {event.preventDefault(); if (name.trim()) submit(name.trim());}}><label>Nombre<input autoFocus required maxLength={255} value={name} onChange={event => setName(event.target.value)}/></label><button disabled={!name.trim()} type="submit">Guardar</button></form>;
}
function FolderTree({active, disabled, onNavigate, onDrop, selectedFiles, connection, revision}) {
    const [opened, setOpened] = useState(false), [nodes, setNodes] = useState({}), [error, setError] = useState("");
    const alive = useRef(true);
    useEffect(() => {alive.current = true; setNodes({}); setOpened(false); return () => {alive.current = false;};}, [connection]);
    async function expand(id, force = false) {
        if (nodes[id]?.open && !force) {setNodes(old => ({...old, [id]: {...old[id], open: !old[id].open}})); return;}
        setNodes(old => ({...old, [id]: {...old[id], loading: true, open: true}}));
        try {let page = "", rows = []; do {const result = await workspaceApi.files({view: "all", parent: id, type: "folder", page}); rows.push(...result.files); page = result.nextPageToken || "";} while (page); if (alive.current) setNodes(old => ({...old, [id]: {rows, loaded: true, open: true}}));}
        catch (problem) {if (alive.current) {setError(problem.message); setNodes(old => ({...old, [id]: {loaded: false, open: false}}));}}
    }
    useEffect(() => {if (opened) {for (const id of Object.keys(nodes).filter(id => nodes[id].open)) expand(id, true);}}, [revision]);
    function branch(id, path, depth = 0) {if (depth >= 30) return null; return nodes[id]?.open && <div className="drive_tree_branch">{nodes[id].loading && <small>Cargando…</small>}{nodes[id].rows?.filter(file => !path.some(parent => parent.id === file.id)).map(file => <div key={file.id}><div className={`drive_tree_row ${active === file.id ? "is_active" : ""}`}><button aria-label={`Expandir ${file.name}`} aria-expanded={!!nodes[file.id]?.open} onClick={() => expand(file.id)}>{nodes[file.id]?.open ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}</button><button disabled={disabled} onClick={() => onNavigate([...path, file])} onDragOver={event => {if (selectedFiles.length && file.capabilities?.canAddChildren) event.preventDefault();}} onDrop={event => {event.preventDefault(); if (file.capabilities?.canAddChildren) onDrop(selectedFiles, file.id);}}><Folder size={14}/><span>{file.name}</span></button></div>{branch(file.id, [...path, file], depth + 1)}</div>)}</div>;}
    return <div className="drive_tree"><button aria-expanded={opened} onClick={() => {setOpened(value => !value); if (!nodes.root?.loaded) expand("root");}}>{opened ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}Carpetas</button>{opened && branch("root", [])}{error && <small role="alert">{error}<button onClick={() => {setError(""); expand("root");}}>Reintentar</button></small>}</div>;
}
// Selector compartido por creación, cargas y movimiento de archivos.
export function DriveFolderPicker({rows = [], drives, submit, label = "Mover aquí", disabled = false, initialRoot = "root", initialPath = [], foldersOnly = false}) {
    const [path, setPath] = useState(initialPath), [root, setRoot] = useState(initialRoot), [folders, setFolders] = useState([]), [next, setNext] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(true), [search, setSearch] = useState("");
    const [sharedDrives, setSharedDrives] = useState(drives || []);
    const [newFolder, setNewFolder] = useState(null), [creatingFolder, setCreatingFolder] = useState(false);
    const request = useRef(0), target = path.at(-1)?.id || root;
    useEffect(() => {
        if (drives) {setSharedDrives(drives); return;}
        let current = true;
        async function loadDrives() {let page = "", items = []; do {const result = await workspaceApi.drives(page); if (!current) return; items.push(...(result.drives || [])); page = result.nextPageToken || "";} while (page); setSharedDrives(items);}
        loadDrives().catch(() => {});
        return () => {current = false;};
    }, [drives]);
    async function load(page = "") {
        const ticket = ++request.current; setBusy(true); setError("");
        if (!page) {setFolders([]); setNext("");}
        try {const result = await workspaceApi.files({view: "all", type: "folder", parent: target, drive: root === "root" ? "" : root, page}); if (ticket === request.current) {setFolders(old => page ? [...old, ...result.files] : result.files); setNext(result.nextPageToken || "");}}
        catch (problem) {if (ticket === request.current) setError(problem.message);}
        finally {if (ticket === request.current) setBusy(false);}
    }
    useEffect(() => {setSearch(""); load(); return () => {++request.current;};}, [target, root]);
    async function createFolder() {
        if (creatingFolder || disabled || !newFolder?.trim()) return;
        setCreatingFolder(true); setError("");
        const ticket = request.current;
        try {
            const folder = await workspaceApi.create({type: "folder", name: newFolder.trim(), parent: target});
            if (ticket === request.current) {setNewFolder(null); setPath(old => [...old, folder]);}
        } catch (problem) {if (ticket === request.current) setError(problem.message);}
        finally {setCreatingFolder(false);}
    }
    const pickerDisabled = disabled || creatingFolder;
    const displayed = folders.filter(file => file.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
    return <div className="drive_move_picker">
        <div className="drive_destination_heading"><Cloud size={24}/><strong>Drive</strong><select aria-label={foldersOnly ? "Unidad de Drive" : "Unidad de destino"} disabled={pickerDisabled} value={root} onChange={event => {setNewFolder(null); setRoot(event.target.value); setPath([]);}}><option value="root">Mi unidad</option>{sharedDrives.map(drive => <option key={drive.id} value={drive.id}>{drive.name}</option>)}</select></div>
        <nav className="drive_destination_path" aria-label={foldersOnly ? "Ruta de carpeta de Drive" : "Carpeta de destino"}><button type="button" disabled={pickerDisabled} onClick={() => setPath([])}>Raíz</button>{path.map((file, index) => <button type="button" key={file.id} disabled={pickerDisabled} onClick={() => setPath(old => old.slice(0, index + 1))}><ChevronRight size={14}/>{file.name}</button>)}</nav>
        <label className="drive_destination_search"><Search size={17}/><input aria-label="Buscar carpetas en este destino" placeholder="Buscar carpetas" value={search} disabled={pickerDisabled} onChange={event => setSearch(event.target.value)}/></label>
        {error && <p role="alert">{error}<button type="button" onClick={() => load()}>Reintentar</button></p>}
        <div className="drive_destination_folders" aria-busy={busy}>{displayed.map(file => <button type="button" key={file.id} disabled={pickerDisabled || busy || rows.some(row => row.id === file.id)} onClick={() => setPath(old => [...old, file])}><Folder size={20}/><span>{file.name}</span><ChevronRight size={16}/></button>)}{busy ? <p role="status">Cargando carpetas…</p> : !displayed.length && !error && <p>{search ? "No hay carpetas con ese nombre." : "Esta carpeta no tiene subcarpetas."}</p>}{next && <button type="button" disabled={busy || pickerDisabled} onClick={() => load(next)}>Más carpetas</button>}</div>
        {newFolder === null ? <button type="button" disabled={pickerDisabled || busy || path.length > 0 && !path.at(-1)?.capabilities?.canAddChildren} onClick={() => setNewFolder("")}><Plus size={16}/>Crear carpeta</button> : <div className="drive_destination_create">
            <label>Nombre de la carpeta<input autoFocus maxLength={255} value={newFolder} disabled={pickerDisabled} onChange={event => setNewFolder(event.target.value)} onKeyDown={event => {if (event.key === "Enter") {event.preventDefault(); event.stopPropagation(); createFolder();} if (event.key === "Escape") {event.preventDefault(); event.stopPropagation(); if (!creatingFolder) setNewFolder(null);}}}/></label>
            <div><button type="button" disabled={pickerDisabled || !newFolder.trim()} onClick={createFolder}>{creatingFolder ? "Creando…" : "Crear carpeta"}</button><button type="button" disabled={creatingFolder} onClick={() => setNewFolder(null)}>Cancelar</button></div>
        </div>}
        <button type="button" className="drive_primary" disabled={pickerDisabled || busy || !!error || foldersOnly && !path.length || rows.some(row => row.id === target) || !foldersOnly && path.length > 0 && !path.at(-1)?.capabilities?.canAddChildren} onClick={() => submit(target, path.at(-1) || {id: root, name: sharedDrives.find(item => item.id === root)?.name || "Mi unidad"})}>{label}</button>
    </div>;
}
function SharePermissions({file, report}) {
    const [permissions, setPermissions] = useState([]), [email, setEmail] = useState(""), [role, setRole] = useState("reader"), [error, setError] = useState(""), [busy, setBusy] = useState(false);
    const alive = useRef(true), canShare = file.capabilities?.canShare;
    async function load() {let page = "", rows = []; do {const result = await workspaceApi.permissions(file.id, page); rows.push(...result.permissions); page = result.nextPageToken || "";} while (page); if (alive.current) setPermissions(rows);}
    useEffect(() => {alive.current = true; load().catch(problem => {if (alive.current) setError(problem.message);}); return () => {alive.current = false;};}, [file.id]);
    async function change(operation) {setBusy(true); setError(""); try {await operation(); await load(); if (alive.current) {setEmail(""); report("Permisos actualizados en Google.");}} catch (problem) {if (alive.current) setError(problem.message);} finally {if (alive.current) setBusy(false);}}
    return <div className="drive_share"><p>{file.name}</p>{error && <p role="alert">{error}</p>}{permissions.map(person => {const inherited = person.permissionDetails?.some(detail => detail.inherited), editable = canShare && !inherited && !["owner", "organizer", "fileOrganizer"].includes(person.role); return <div className="drive_permission" key={person.id}><span>{person.emailAddress || person.displayName || person.type}{inherited && <small>Heredado</small>}</span>{editable ? <><select aria-label={`Permiso de ${person.emailAddress || person.type}`} disabled={busy} value={person.role} onChange={async event => {const role = event.target.value; if (await confirmBold("¿Cambiar el acceso de este participante?")) change(() => workspaceApi.permission(file.id, person.id, {role}));}}><option value="reader">Lector</option><option value="commenter">Comentador</option><option value="writer">Editor</option></select><button disabled={busy} aria-label={`Retirar acceso de ${person.emailAddress || person.type}`} onClick={async () => {if (await confirmBold("¿Retirar el acceso de este participante?")) change(() => workspaceApi.permission(file.id, person.id));}}><X size={16}/></button></> : <small>{person.role}</small>}</div>;})}{canShare ? <form className="drive_form" onSubmit={event => {event.preventDefault(); change(() => workspaceApi.share(file.id, {email, role}));}}><label>Añadir participante<input type="email" required value={email} onChange={event => setEmail(event.target.value)}/></label><select aria-label="Permiso del nuevo participante" value={role} onChange={event => setRole(event.target.value)}><option value="reader">Lector</option><option value="commenter">Comentador</option><option value="writer">Editor</option></select><button disabled={busy}>Compartir</button></form> : <p>Tu cuenta puede consultar el acceso, pero no cambiarlo.</p>}</div>;
}
function Preview({file, openGoogle}) {
    const [url, setUrl] = useState(""), [error, setError] = useState("");
    useEffect(() => {let alive = true, object = ""; const controller = new AbortController(); workspaceApi.preview(file.id, {signal: controller.signal}).then(blob => {if (alive) {object = URL.createObjectURL(blob); setUrl(object);}}).catch(problem => {if (alive && problem.name !== "AbortError") setError(problem.message);}); return () => {alive = false; controller.abort(); if (object) URL.revokeObjectURL(object);};}, [file.id]);
    return <><button onClick={openGoogle}>Abrir en Google <ExternalLink size={16}/></button>{error ? <p role="alert">{error}</p> : !url ? <p>Cargando vista previa…</p> : file.mimeType === "application/pdf" ? <iframe className="drive_pdf" src={url} title={file.name}/> : <img className="drive_image" src={url} alt={file.name}/>}</>;
}
export function ShareFileDialog({file, close}) {
    const [notice, setNotice] = useState("");
    return <Modal title={`Compartir «${file.name}»`} close={close}>{notice && <p role="status">{notice}</p>}<SharePermissions file={file} report={setNotice}/></Modal>;
}

// Carga desde Docs con el mismo selector y motor de Drive.
export function DriveUploadDialog({items, close, connection}) {
    const [jobs, setJobs] = useState([]), [busy, setBusy] = useState(false);
    const controller = useRef(null), alive = useRef(true);
    useEffect(() => {alive.current = true; return () => {alive.current = false; controller.current?.abort();};}, []);
    async function upload(destination) {
        if (controller.current) return;
        const operation = new AbortController(); controller.current = operation;
        setJobs(items.map((file, id) => ({id, name: file.name, status: "pendiente"}))); setBusy(true);
        await uploadDriveFiles(items, destination, {signal: operation.signal, status: (id, status, message = "") => {if (alive.current) setJobs(old => old.map(job => job.id === id ? {...job, status, message} : job));}});
        await googleCache.invalidate(cacheScope(connection, http.getSession().assignmentId), "drive:data:").catch(() => {});
        if (alive.current) setBusy(false);
    }
    return <Modal title="Subir archivos a Drive" close={() => {if (!busy) close();}}>
        {!jobs.length ? <><p>{items.length} archivo(s). Elige dónde guardarlos.</p><DriveFolderPicker label="Subir aquí" submit={upload}/><button onClick={close}>Cancelar</button></> : <div className="drive_form" aria-live="polite">{jobs.map(job => <p key={job.id}>{job.name}: {job.status}{job.message && ` · ${job.message}`}</p>)}{busy ? <><progress/><button onClick={() => controller.current?.abort()}>Cancelar carga</button></> : <button onClick={close}>Cerrar</button>}</div>}
    </Modal>;
}
