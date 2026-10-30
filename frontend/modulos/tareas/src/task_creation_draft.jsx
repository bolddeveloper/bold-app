import {useCallback, useEffect, useRef, useState} from "react";
import {createTaskDraftController, openTaskCreationDraft} from "./task_drafts.js";
import {registerPrivateWork} from "../../core/shared/private_work.js";
import {confirmBold} from "../../core/shared/bold_dialog.js";

export function TaskCreationDraft({assignmentId, legacyKey, onClose, children, renderNotice = content => content}) {
    const controller = useRef(null), read = useRef(null), alive = useRef(false);
    const [initial, setInitial] = useState(undefined), [status, setStatus] = useState("opening"), [error, setError] = useState("");
    const [retry, setRetry] = useState(0);
    const capture = useCallback(value => controller.current?.update(value), []);
    const flush = useCallback(async override => {
        const snapshot = override || read.current?.();
        if (snapshot) controller.current?.update(snapshot);
        return await controller.current?.flush() === true;
    }, []);
    useEffect(() => {
        alive.current = true; setStatus("opening"); setError(""); setInitial(undefined);
        const value = createTaskDraftController({open: () => openTaskCreationDraft(assignmentId), onStatus: (next, problem) => {
            if (alive.current && controller.current === value) {setStatus(next); setError(problem?.message || "");}
            if (next === "protected") {try {sessionStorage.removeItem(legacyKey);} catch { /* Encrypted copy is authoritative. */ }}
        }});
        controller.current = value;
        value.ready.then(saved => {if (alive.current && controller.current === value) setInitial(saved || null);}).catch(() => {});
        let closing = null;
        const protect = registerPrivateWork(() => {
            if (closing) return closing;
            const snapshot = read.current?.(); if (snapshot) value.update(snapshot);
            return value.flush();
        });
        const pagehide = () => {void flush();};
        const leave = event => {
            const snapshot = read.current?.(); if (snapshot) value.update(snapshot);
            if (snapshot && !value.isProtected()) {event.preventDefault(); event.returnValue = "";}
        };
        window.addEventListener("pagehide", pagehide); window.addEventListener("beforeunload", leave);
        return () => {
            alive.current = false;
            window.removeEventListener("pagehide", pagehide); window.removeEventListener("beforeunload", leave);
            const snapshot = read.current?.(); if (snapshot) value.update(snapshot);
            closing = value.close();
            void closing.finally(protect);
        };
    }, [assignmentId, legacyKey, retry]);
    async function discard() {
        if (!await confirmBold("¿Descartar el borrador de esta tarea conservado en este dispositivo?")) return;
        try {
            await controller.current.discard();
            try {sessionStorage.removeItem(legacyKey);} catch { /* Optional legacy storage. */ }
            onClose();
        } catch (problem) {if (alive.current) setError(problem.message);}
    }
    if (initial === undefined) return renderNotice(<div className="task_failed_drafts" role={error ? "alert" : "status"}>
        <strong>{error ? "No se pudo abrir el borrador" : "Comprobando borrador de tarea…"}</strong>
        {error && <><p>{error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>Reintentar</button></>}
        <button type="button" onClick={onClose}>Cerrar</button>
    </div>);
    if (initial?._submitted) return renderNotice(<div className="task_failed_drafts" role="alert">
        <strong>Esta tarea tuvo un intento de envío</strong>
        <p>Comprueba si ya aparece en tus tareas antes de volver a enviarla. No repetimos el envío automáticamente.</p>
        <button type="button" onClick={onClose}>Comprobar mis tareas</button>
        <button type="button" onClick={() => setInitial({...initial, _submitted: false, _draft_id: crypto.randomUUID()})}>Continuar revisando el borrador</button>
        <button type="button" onClick={discard}>Descartar borrador</button>
    </div>);
    const notice = <div className="task_draft_status" role={error ? "alert" : "status"}>
        <small>{error || ({protected: "Borrador cifrado guardado en este dispositivo · hasta 7 días", saving: "Guardando borrador…", recovered: "Borrador recuperado de este dispositivo", ready: "El borrador se conservará en este dispositivo"})[status] || "Preparando borrador…"}</small>
        {error && <button type="button" onClick={() => flush()}>Reintentar guardado</button>}
        <button type="button" onClick={discard}>Descartar borrador</button>
    </div>;
    return children({initial, read, capture, flush, notice});
}
