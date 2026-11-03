import {useEffect, useRef, useState} from "react";
import {Keyboard, Pencil} from "lucide-react";
import {useCore} from "../core/core_provider.jsx";
import {moduleCache, moduleScope} from "../core/module_cache.js";
import {BackgroundSyncNotice} from "../core/shared/background_sync_notice.jsx";
import {http} from "../core/http_client.js";
import {shortcutActions, defaultShortcuts, shortcutsEndpoint, shortcutFromEvent, shortcutError} from "../core/keyboard_shortcuts.js";
import "./shortcut_preferences.css";

export default function ShortcutPreferences() {
    const cacheScope = moduleScope(useCore());
    const [settings, setSettings] = useState(() => moduleCache.read(cacheScope, "shortcut-settings")), [recording, setRecording] = useState(null);
    const [saved, setSaved] = useState(settings), [captureError, setCaptureError] = useState("");
    const [refreshing, setRefreshing] = useState(false), settingsRef = useRef(settings); settingsRef.current = settings;
    const [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false);
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        const controller = new AbortController(), previous = settingsRef.current, cacheGeneration = moduleCache.generation; setRefreshing(true);
        http.request(shortcutsEndpoint, {signal: controller.signal}).then(value => {if (settingsRef.current === previous) {setSettings(value); setSaved(value); moduleCache.write(cacheScope, "shortcut-settings", value, cacheGeneration);}}).catch(problem => {if (!controller.signal.aborted) setError(problem.message);}).finally(() => {if (!controller.signal.aborted) setRefreshing(false);});
        return () => controller.abort();
    }, [attempt]);
    async function save() {
        setBusy(true); setError(""); setNotice("");
        try {
            const value = await http.request(shortcutsEndpoint, {method: "PUT", body: settings});
            setSettings(value);
            setSaved(value);
            moduleCache.write(cacheScope, "shortcut-settings", value);
            window.dispatchEvent(new CustomEvent("bold:shortcuts-changed", {detail: value}));
            setNotice("Atajos guardados para tu cuenta.");
        } catch (problem) {setError(problem.message);}
        finally {setBusy(false);}
    }
    const dirty = settings && shortcutActions.some(([id]) => settings[id] !== saved?.[id]);
    function capture(event, id) {
        if (event.key === "Tab") return;
        event.preventDefault(); event.stopPropagation();
        const finish = () => {
            event.currentTarget.closest(".bold_shortcut_row").querySelector(".bold_shortcut_edit").focus();
            setRecording(null);
        };
        if (event.key === "Escape") {finish(); return;}
        if (["Control", "Meta", "Alt", "Shift"].includes(event.key)) return;
        const value = shortcutFromEvent(event);
        const problem = shortcutError(value, settings, id);
        if (problem) {setCaptureError(problem); return;}
        setSettings(current => ({...current, [id]: value}));
        finish();
    }
    return <section className="bold_shortcut_preferences"><BackgroundSyncNotice active={refreshing} label="Actualizando atajos…" /><h2>Atajos de teclado</h2>
        <p>Elige Cambiar y pulsa Ctrl o ⌘ con una letra o número. Puedes añadir Alt o Mayús. Después guarda los cambios.</p>
        {error && <p role="alert" className="bold_profile_error">{error}</p>}{notice && <p role="status">{notice}</p>}
        {!settings ? error ? <button onClick={() => {setError(""); setAttempt(value => value + 1);}}>Reintentar carga</button> : <div aria-busy="true" /> : <>
            <div className="bold_shortcut_list">{shortcutActions.map(([id, label]) => <div className="bold_shortcut_row" key={id} data-recording={recording === id || undefined}>
                <strong>{label}</strong>{recording === id ? <div className="bold_shortcut_capture">
                    <input autoFocus readOnly aria-label={`Nuevo atajo para ${label}`} aria-describedby="bold_shortcut_capture_hint" aria-invalid={Boolean(captureError)} placeholder="Pulsa la combinación…" onBlur={() => setRecording(null)} onKeyDown={event => capture(event, id)}/>
                    <small id="bold_shortcut_capture_hint" role={captureError ? "alert" : undefined}>{captureError || "Escape para cancelar."}</small>
                </div> : <span className="bold_shortcut_keys">{settings[id] ? settings[id].split("+").map(key => <kbd key={key}>{key === "Meta" ? "⌘" : key === "Shift" ? "Mayús" : key}</kbd>) : <small>Desactivado</small>}</span>}
                <div className="bold_shortcut_actions"><button className="bold_shortcut_edit" disabled={busy} onClick={() => {setRecording(id); setCaptureError(""); setError(""); setNotice("");}}><Pencil size={14} aria-hidden="true"/>Cambiar</button><button className="bold_profile_quiet" disabled={busy || !settings[id]} onClick={() => {setSettings(current => ({...current, [id]: ""})); setRecording(null); setNotice("");}}>Desactivar</button></div>
            </div>)}</div>
            <div className="bold_profile_buttons bold_shortcut_footer"><button className="bold_profile_primary" disabled={busy || !!recording || !dirty} onClick={save}>{busy ? "Guardando…" : "Guardar atajos"}</button><button className="bold_profile_quiet" disabled={busy} onClick={() => {setSettings({...defaultShortcuts}); setRecording(null); setError(""); setNotice("");}}>Restaurar predeterminados</button><small role="status">{dirty ? "Cambios por guardar" : "Sin cambios pendientes"}</small></div>
        </>}
        <details className="bold_shortcut_reference"><summary><Keyboard size={16} aria-hidden="true"/>Atajos de edición y navegación</summary><p>Estos pertenecen al editor o al navegador y conservan su combinación original.</p>
        <dl className="bold_shortcut_existing"><div><dt>Guardar documento en el editor BOLD</dt><dd><kbd>Ctrl + S / Meta + S</kbd></dd></div><div><dt>Negrita / cursiva / subrayado en texto editable</dt><dd><kbd>Ctrl + B / I / U</kbd></dd></div><div><dt>Copiar / cortar / pegar / deshacer</dt><dd><kbd>Ctrl + C / X / V / Z</kbd></dd></div><div><dt>Drive: abrir / seleccionar archivo con foco</dt><dd><kbd>Enter / Espacio</kbd></dd></div><div><dt>Drive: solicitar envío a la papelera</dt><dd><kbd>Supr</kbd></dd></div><div><dt>Drive: selección múltiple / rango</dt><dd><kbd>Ctrl + clic / Shift + clic</kbd></dd></div><div><dt>Presentación: siguiente / anterior diapositiva</dt><dd><kbd>→ o Espacio / ←</kbd></dd></div><div><dt>Calendario: elegir un invitado sugerido</dt><dd><kbd>↑ / ↓ / Enter</kbd></dd></div><div><dt>Cerrar ventanas o menús</dt><dd><kbd>Escape</kbd></dd></div><div><dt>Mover foco entre controles</dt><dd><kbd>Tab / Shift + Tab</kbd></dd></div><div><dt>Atrás / adelante</dt><dd><kbd>Alt + ← / Alt + →</kbd></dd></div></dl>
        </details>
    </section>;
}
