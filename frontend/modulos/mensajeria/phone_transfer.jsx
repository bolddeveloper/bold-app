import {useEffect, useLayoutEffect, useRef, useState} from "react";
import {Smartphone, X} from "lucide-react";
import QRCode from "qrcode";
import {useDialog} from "../core/shared/use_dialog.js";
import {phoneApi, phoneLink} from "./phone_transfer_api.js";
import "./phone_transfer.css";

export default function PhoneTransfer({target, onFiles, onClose}) {
    const [row, setRow] = useState(null), [qr, setQr] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
    const active = useRef(false), transfer = useRef(null), operation = useRef(false), controller = useRef(null);
    const link = useRef("");
    const [copied, setCopied] = useState(false);
    useDialog(true, ".phone_transfer_dialog", () => {if (!operation.current) onClose();});
    useLayoutEffect(() => {
        active.current = true; controller.current = new AbortController();
        return () => {active.current = false; controller.current.abort(); if (transfer.current) phoneApi.cancel(transfer.current).catch(() => {});};
    }, []);
    useEffect(() => {
        if (!row?.id) return;
        let timer, stopped = false;
        async function refresh() {
            if (stopped || !active.current) return;
            if (Date.now() >= Date.parse(row.expires_at)) {setError("El QR caducó. Cierra este diálogo y genera uno nuevo."); return;}
            try {
                if (document.visibilityState !== "hidden" && !operation.current) {
                    const result = await phoneApi.status(row.id, {signal: controller.current.signal});
                    if (!stopped && active.current) setRow(result);
                }
                if (!stopped) timer = setTimeout(refresh, 5000);
            } catch (err) {if (!stopped && active.current && err.name !== "AbortError") setError(err.message);}
        }
        timer = setTimeout(refresh, 5000);
        return () => {stopped = true; clearTimeout(timer);};
    }, [row?.id]);
    async function run(action) {
        if (operation.current) return;
        operation.current = true; setBusy(true); setError("");
        try {await action();} catch (err) {if (active.current && err.name !== "AbortError") setError(err.message);}
        finally {operation.current = false; if (active.current) setBusy(false);}
    }
    function start() {return run(async () => {
        const result = await phoneApi.create(target, {signal: controller.current.signal});
        transfer.current = result.id;
        if (!active.current) {phoneApi.cancel(result.id).catch(() => {}); return;}
        setRow(result);
        link.current = phoneLink(result.id, result.claim_token);
        const encoded = await QRCode.toDataURL(link.current, {errorCorrectionLevel: "M", margin: 4, width: 300, color: {dark: "#921c3b", light: "#ffffff"}});
        if (active.current) setQr(encoded);
    });}
    function receive() {return run(async () => {
        const latest = await phoneApi.seal(row.id, {signal: controller.current.signal});
        if (!latest.images.length) throw Error("Todavía no hay imágenes para recibir.");
        const files = [];
        for (const image of latest.images) {
            const blob = await phoneApi.image(row.id, image.id, {signal: controller.current.signal});
            files.push(new File([blob], `telefono-${image.id}.webp`, {type: "image/webp"}));
        }
        if (!active.current) return;
        if (onFiles(files) !== true) throw Error("No se pudieron añadir todas las imágenes. Comprueba el espacio de la cola y vuelve a intentarlo.");
        // Local queue owns the pixels now. Failure to delete cannot duplicate import.
        phoneApi.cancel(row.id).catch(() => {}); transfer.current = null; onClose();
    });}
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
    return <div className="phone_transfer_scrim"><section className="phone_transfer_dialog" role="dialog" aria-modal="true" aria-labelledby="phone_transfer_title" aria-busy={busy}>
        <header><h2 id="phone_transfer_title"><Smartphone size={22} aria-hidden="true"/> Añadir desde el teléfono</h2><button type="button" aria-label="Cerrar transferencia" onClick={onClose} disabled={busy}><X aria-hidden="true"/></button></header>
        <p>1. Escanea · 2. Confirma el código · 3. Recibe tus imágenes</p>
        {local && <p role="note">Esta dirección local no se puede abrir desde otro teléfono. Para probar con un móvil utiliza una dirección HTTPS de pruebas accesible desde ambos dispositivos.</p>}
        {!row && <button type="button" onClick={start} disabled={busy}>{busy ? "Generando…" : "Generar QR temporal"}</button>}
        {qr && !row?.paired && <img className="phone_transfer_qr" src={qr} alt="Escanea este QR con la cámara del teléfono para solicitar la vinculación" width="300" height="300"/>}
        {qr && !row?.paired && <button type="button" onClick={() => run(async () => {if (!navigator.clipboard?.writeText) throw Error("El navegador no permite copiar. Escanea el QR."); await navigator.clipboard.writeText(link.current); setCopied(true);})}>{copied ? "Enlace copiado" : "Copiar enlace temporal"}</button>}
        {row?.paired && <div className="phone_transfer_pair"><span>Código de vinculación</span><strong>{row.pairing_code}</strong><p>Aprueba solo si este mismo código aparece en tu teléfono.</p>{!row.approved && <button type="button" disabled={busy} onClick={() => run(async () => {const result = await phoneApi.approve(row.id, row.pairing_code, {signal: controller.current.signal}); if (active.current) setRow(result);})}>Aprobar este teléfono</button>}</div>}
        {row && <p role="status" aria-live="polite">{row.approved ? `${row.images.length} imágenes recibidas. Cuando termines en el teléfono, añádelas al borrador.` : row.paired ? "Esperando tu aprobación." : "Esperando que escanees el QR…"} Válido hasta {new Date(row.expires_at).toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"})}.</p>}
        {row?.approved && <button type="button" disabled={busy || !row.images.length} onClick={receive}>{busy ? "Preparando imágenes…" : `Añadir ${row.images.length} al borrador y finalizar`}</button>}
        {error && <p role="alert">{error}</p>}
        {row && error && <button type="button" disabled={busy} onClick={() => run(async () => {const result = await phoneApi.status(row.id, {signal: controller.current.signal}); if (active.current) setRow(result);})}>Actualizar transferencia</button>}
        <small>Hasta 10 imágenes. Nada se publica sin pulsar Enviar en BOLD. Cerrar cancela el vínculo y elimina las copias temporales.</small>
    </section></div>;
}
