import { useEffect, useRef, useState } from "react";
import { http } from "../../core/http_client.js";
import { Bold, Italic, Underline, Strikethrough, Undo2, Redo2, List, ListOrdered, IndentIncrease, Link, Plus, LockKeyhole } from "lucide-react";

const formats = [["Deshacer", "undo", Undo2], ["Rehacer", "redo", Redo2], ["Negrita", "bold", Bold], ["Cursiva", "italic", Italic], ["Subrayado", "underline", Underline], ["Tachado", "strikeThrough", Strikethrough], ["Lista", "insertUnorderedList", List], ["Lista numerada", "insertOrderedList", ListOrdered], ["Sangría", "indent", IndentIncrease]];
function cleanHTML(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    for (const node of [...doc.body.querySelectorAll("*")]) {
        if (!["P", "DIV", "BR", "HR", "B", "STRONG", "I", "EM", "U", "S", "STRIKE", "UL", "OL", "LI", "BLOCKQUOTE", "PRE", "CODE", "A", "TABLE", "TBODY", "TR", "TD", "TH", "IMG"].includes(node.tagName)) { node.replaceWith(...node.childNodes); continue; }
        for (const attribute of [...node.attributes]) {
            const safe = node.tagName === "A" && attribute.name === "href" && /^https?:\/\//i.test(attribute.value)
                || node.tagName === "IMG" && attribute.name === "src" && /^data:image\/(png|jpeg|gif|webp);base64,/i.test(attribute.value);
            if (!safe) node.removeAttribute(attribute.name);
        }
    }
    return doc.body.innerHTML;
}

export default function PrivateNotes({ storageKey, preview = false, heading }) {
    const editor = useRef(null), file = useRef(null), range = useRef(null);
    const sync = useRef({ version: 0, ready: false, pending: null, saving: false, timer: null, active: true, conflict: false });
    const [status, setStatus] = useState("Cargando notas…"), [error, setError] = useState("");
    const [ready, setReady] = useState(preview);
    const flush = async () => {
        const state = sync.current;
        if (!state.ready || state.saving || state.pending === null || state.conflict) return;
        const content = state.pending;
        state.pending = null; state.saving = true;
        try {
            const result = await http.request("/api/v2/auth/private-note/", { method: "PUT", body: { content, version: state.version } });
            state.version = result.version;
            if (state.active) setStatus(state.pending === null ? "Guardado en tu cuenta" : "Guardando…");
        } catch (failure) {
            if (state.pending === null) state.pending = content;
            if (failure.status === 409) state.conflict = true;
            if (state.active) setStatus(failure.status === 409 ? "Cambió en otro dispositivo. Copia tus notas y recarga antes de guardar." : "No se pudo sincronizar. Tus cambios siguen aquí. Reintenta antes de cerrar.");
            state.saving = false;
            return;
        }
        state.saving = false;
        if (state.pending !== null) flush();
    };
    useEffect(() => {
        if (preview) { editor.current.textContent = "Escribe tus ideas y recordatorios…"; return; }
        const state = sync.current;
        let active = true;
        state.active = true;
        const load = async () => {
            if (state.pending !== null || state.saving) return;
            try {
                const note = await http.request("/api/v2/auth/private-note/");
                if (!active || state.pending !== null || state.saving) return;
                editor.current.innerHTML = cleanHTML(note.content);
                range.current = null; state.version = note.version; state.ready = true;
                setReady(true); setError(""); setStatus("Guardado en tu cuenta");
            } catch { if (active && !state.ready) setError("No se pudieron cargar tus notas. Recarga para reintentar."); }
        };
        const preventLoss = event => { if (state.pending !== null || state.saving) { event.preventDefault(); event.returnValue = ""; } };
        load();
        window.addEventListener("focus", load);
        window.addEventListener("beforeunload", preventLoss);
        return () => {
            active = false; state.active = false;
            clearTimeout(state.timer); flush();
            window.removeEventListener("focus", load);
            window.removeEventListener("beforeunload", preventLoss);
        };
    }, [storageKey, preview]);
    const save = () => {
        if (preview || error || !sync.current.ready) return;
        sync.current.pending = cleanHTML(editor.current.innerHTML);
        if (sync.current.conflict) return;
        setStatus("Guardando…");
        clearTimeout(sync.current.timer);
        sync.current.timer = setTimeout(flush, 600);
    };
    const remember = () => { const selection = window.getSelection(); if (selection.rangeCount && editor.current.contains(selection.anchorNode)) range.current = selection.getRangeAt(0).cloneRange(); };
    const command = (name, value) => {
        if (preview || error || !sync.current.ready || !editor.current) return;
        editor.current.focus();
        if (range.current) { const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range.current); }
        document.execCommand(name, false, value);
        remember(); save();
    };
    const link = () => {
        const url = window.prompt("Enlace HTTPS", "https://");
        if (!url) return;
        if (!/^https?:\/\//i.test(url)) { setStatus("Usa un enlace que empiece con https:// o http://."); return; }
        command("createLink", url);
    };
    return <>{heading || <header className="home_widget_heading"><div><h2>Bloc de notas privado <LockKeyhole size={13} aria-label="Privado" /></h2></div></header>}
        <div className="private_notes">
            <div ref={editor} className="private_notes_editor" contentEditable={!preview && !error && ready} suppressContentEditableWarning role="textbox" aria-label="Bloc de notas privado" aria-multiline="true" spellCheck data-placeholder="Escribe tus notas…" onInput={save} onKeyUp={remember} onMouseUp={remember} onPaste={event => { event.preventDefault(); command("insertText", event.clipboardData.getData("text/plain")); }} />
            <div className="private_notes_toolbar" role="toolbar" aria-label="Formato de notas" onMouseDown={event => { if (!event.target.closest("summary")) event.preventDefault(); remember(); }}>
                <details><summary aria-label="Insertar" title="Insertar"><Plus size={16} /></summary><div className="private_notes_insert"><button type="button" onClick={() => command("insertHorizontalRule")}>Separador</button><button type="button" onClick={() => command("insertHTML", "<table><tbody><tr><td>Celda</td><td>Celda</td></tr><tr><td>Celda</td><td>Celda</td></tr></tbody></table><p><br></p>")}>Tabla 2 × 2</button><button type="button" onClick={() => file.current.click()}>Imagen</button></div></details>
                {formats.map(([label, name, Icon]) => <button key={name} type="button" aria-label={label} title={label} onClick={() => command(name)}><Icon size={15} /></button>)}
                <button type="button" aria-label="Insertar enlace" title="Insertar enlace" onClick={link}><Link size={15} /></button>
            </div>
            <input ref={file} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={event => {
                const image = event.target.files[0]; event.target.value = "";
                if (!image) return;
                if (image.size > 1024 * 1024 || !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(image.type)) { setStatus("Elige una imagen PNG, JPG, GIF o WebP de hasta 1 MB."); return; }
                const reader = new FileReader(); reader.onload = () => command("insertImage", reader.result); reader.readAsDataURL(image);
            }} />
            {!preview && <small role={error ? "alert" : "status"}>{error || status}</small>}
            {!preview && status.startsWith("No se pudo sincronizar") && <button type="button" onClick={flush}>Reintentar guardado</button>}
        </div>
    </>;
}
