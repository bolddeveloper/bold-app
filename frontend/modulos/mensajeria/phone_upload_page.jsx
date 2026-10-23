import {useEffect, useLayoutEffect, useRef, useState} from "react";
import {Camera, ImagePlus, Smartphone, Trash2} from "lucide-react";
import {phoneRequest, phoneSecret} from "./phone_transfer_api.js";
import {imageFileError} from "./media_helpers.js";
import "./phone_transfer.css";

export default function PhoneUploadPage({link}) {
    const device = useRef(phoneSecret()), [code, setCode] = useState(""), [approved, setApproved] = useState(false);
    const [files, setFiles] = useState([]), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
    const [ended, setEnded] = useState(false), [expires, setExpires] = useState(null);
    const [capacity, setCapacity] = useState(10);
    const active = useRef(false), operation = useRef(false), picker = useRef(null), camera = useRef(null), controller = useRef(null);
    useLayoutEffect(() => {
        active.current = true; controller.current = new AbortController();
        return () => {active.current = false; controller.current.abort();};
    }, []);
    useEffect(() => {
        if (!expires) return;
        const timer = setTimeout(() => {setEnded(true); setError("El vínculo caducó. Conserva tus imágenes y genera otro QR en el ordenador.");}, Math.max(0, Date.parse(expires) - Date.now()));
        return () => clearTimeout(timer);
    }, [expires]);
    // Claim only after an explicit tap: preview bots never consume a QR.
    async function connect() {
        if (operation.current) return;
        operation.current = true; setBusy(true); setError("");
        try {
            const result = await phoneRequest(link.id, link.token, "claim", {deviceToken: device.current, signal: controller.current.signal});
            if (active.current) {setCode(result.pairing_code); setExpires(result.expires_at); setCapacity(result.max_images || 10);}
        } catch (err) {if (active.current) setError(err.message);}
        finally {operation.current = false; if (active.current) setBusy(false);}
    }
    useEffect(() => {
        if (!code || approved || ended) return;
        let stopped = false, timer;
        async function check() {
            if (stopped) return;
            if (Date.now() >= Date.parse(expires)) {setEnded(true); setError("El vínculo caducó. Genera otro QR en BOLD."); return;}
            try {
                if (document.visibilityState !== "hidden") {
                    const result = await phoneRequest(link.id, device.current, "mobile", {signal: controller.current.signal});
                    if (!stopped && result.approved) {setApproved(true); return;}
                }
                if (!stopped) timer = setTimeout(check, 5000);
            } catch (err) {if (!stopped && active.current && err.name !== "AbortError") {setError(err.message); setEnded(true);}}
        }
        check();
        return () => {stopped = true; clearTimeout(timer);};
    }, [code, approved, ended, expires, link.id]);
    function add(incoming) {
        try {
            const selected = Array.from(incoming);
            if (selected.length + files.length > capacity) throw Error(`Este borrador tiene espacio para ${capacity} imágenes del teléfono.`);
            for (const file of selected) {const problem = imageFileError(file); if (problem) throw Error(problem);}
            setFiles(current => [...current, ...selected.map(file => ({id: crypto.randomUUID(), file, sent: false}))]); setError("");
        } catch (err) {setError(err.message);}
    }
    async function upload() {
        if (operation.current) return;
        operation.current = true; setBusy(true); setError("");
        try {
            for (const item of files.filter(row => !row.sent)) {
                if (Date.now() >= Date.parse(expires)) throw Error("El vínculo caducó. Conserva tus imágenes y genera otro QR.");
                if (active.current) setNotice(`Transfiriendo ${item.file.name}…`);
                await phoneRequest(link.id, device.current, "mobile", {file: item.file, clientId: item.id, signal: controller.current.signal});
                if (!active.current) return;
                setFiles(current => current.map(row => row.id === item.id ? {...row, sent: true} : row));
            }
            if (active.current) setNotice("Imágenes transferidas. Vuelve al ordenador y pulsa Añadir al borrador; todavía no se enviaron al chat.");
        } catch (err) {if (active.current && err.name !== "AbortError") {setError(err.message); if ([403,404,409].includes(err.status)) setEnded(true);}}
        finally {operation.current = false; if (active.current) setBusy(false);}
    }
    return <main className="phone_upload_page"><section className="phone_transfer_card" aria-busy={busy}>
        <span className="phone_transfer_brand">bold<span aria-hidden="true">°</span></span>
        <h1><Smartphone size={25} aria-hidden="true"/> Imágenes para tu borrador</h1>
        <p>Este vínculo solo permite aportar imágenes. No da acceso a tus conversaciones ni envía mensajes.</p>
        {!code && <button type="button" onClick={connect} disabled={busy || !link}>{busy ? "Conectando…" : "Solicitar vinculación"}</button>}
        {code && !approved && <div className="phone_transfer_pair"><span>Código de vinculación</span><strong>{code}</strong><p>Comprueba que coincida y aprueba este teléfono desde el ordenador.</p></div>}
        {approved && <><p>Vínculo aprobado · hasta {capacity} imágenes PNG, JPEG o WebP, 10 MB por original. Se comprimen y eliminan sus metadatos.</p>
            <div className="phone_transfer_actions"><button type="button" disabled={busy || ended || files.length >= capacity} onClick={() => camera.current.click()}><Camera aria-hidden="true" size={21}/> Tomar foto</button><button type="button" disabled={busy || ended || files.length >= capacity} onClick={() => picker.current.click()}><ImagePlus aria-hidden="true" size={21}/> Galería</button></div>
            <input ref={camera} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden onChange={event => {add(event.target.files); event.target.value = "";}}/>
            <input ref={picker} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={event => {add(event.target.files); event.target.value = "";}}/>
            <ul className="phone_transfer_files">{files.map(item => <li key={item.id}><span>{item.file.name}<small>{item.sent ? "Transferida al ordenador" : "Pendiente"}</small></span>{!item.sent && <button type="button" aria-label={`Quitar ${item.file.name}`} disabled={busy} onClick={() => setFiles(current => current.filter(row => row.id !== item.id))}><Trash2 aria-hidden="true" size={19}/></button>}</li>)}</ul>
            <button type="button" disabled={busy || ended || !files.some(item => !item.sent)} onClick={upload}>{busy ? "Transfiriendo…" : "Transferir imágenes al ordenador"}</button></>}
        {notice && <p role="status" aria-live="polite">{notice}</p>}{error && <p role="alert">{error}</p>}
        {error && code && !approved && Date.now() < Date.parse(expires) && <button type="button" disabled={busy} onClick={() => {setError(""); setEnded(false);}}>Volver a comprobar aprobación</button>}
        <small>Vínculo de hasta diez minutos. Las copias temporales se eliminan al finalizar o tras caducar; no se publican en Drive.</small>
    </section></main>;
}
