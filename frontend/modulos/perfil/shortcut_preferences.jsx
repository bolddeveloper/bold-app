import {useEffect, useRef, useState} from "react";
import {useCore} from "../core/core_provider.jsx";
import {moduleCache, moduleScope} from "../core/module_cache.js";
import {BackgroundSyncNotice} from "../core/shared/background_sync_notice.jsx";
import {http} from "../core/http_client.js";
import {shortcutActions, defaultShortcuts, shortcutsEndpoint, shortcutFromEvent, shortcutError} from "../core/keyboard_shortcuts.js";
import "./shortcut_preferences.css";

export default function ShortcutPreferences() {
    const cacheScope = moduleScope(useCore());
    const [settings, setSettings] = useState(() => moduleCache.read(cacheScope, "shortcut-settings")), [recording, setRecording] = useState(null);
    const [refreshing, setRefreshing] = useState(false), settingsRef = useRef(settings); settingsRef.current = settings;
    const [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false);
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        const controller = new AbortController(), previous = settingsRef.current, cacheGeneration = moduleCache.generation; setRefreshing(true);
        http.request(shortcutsEndpoint, {signal: controller.signal}).then(value => {if (settingsRef.current === previous) {setSettings(value); moduleCache.write(cacheScope, "shortcut-settings", value, cacheGeneration);}}).catch(problem => {if (!controller.signal.aborted) setError(problem.message);}).finally(() => {if (!controller.signal.aborted) setRefreshing(false);});
        return () => controller.abort();
    }, [attempt]);
    async function save() {
        setBusy(true); setError(""); setNotice("");
        try {
            const value = await http.request(shortcutsEndpoint, {method: "PUT", body: settings});
            setSettings(value);
            moduleCache.write(cacheScope, "shortcut-settings", value);
            window.dispatchEvent(new CustomEvent("bold:shortcuts-changed", {detail: value}));
            setNotice("Atajos guardados para tu cuenta.");
        } catch (problem) {setError(problem.message);}
        finally {setBusy(false);}
    }
    return <section className="bold_shortcut_preferences"><BackgroundSyncNotice active={refreshing} label="Actualizando atajos…" /><h2>Atajos de teclado</h2>
        <p>Selecciona Cambiar y presiona la combinación. Usa Ctrl (Windows) o Meta (Mac), con Alt o Shift opcionales. Escape cancela.</p>
        <p>Los atajos de navegación no se ejecutan mientras escribes o hay una ventana abierta. Cada módulo conserva sus permisos.</p>
        {error && <p role="alert" className="bold_profile_error">{error}</p>}{notice && <p role="status">{notice}</p>}
        {!settings ? error ? <button onClick={() => {setError(""); setAttempt(value => value + 1);}}>Reintentar carga</button> : <div aria-busy="true" /> : <>
            <div className="bold_shortcut_list">{shortcutActions.map(([id, label]) => <div className="bold_shortcut_row" key={id}>
                <strong>{label}</strong>{recording === id ? <input autoFocus readOnly aria-label={`Nuevo atajo para ${label}`} placeholder="Presiona las teclas…" onBlur={() => setRecording(null)} onKeyDown={event => {
                    if (event.key === "Tab") {setRecording(null); return;}
                    event.preventDefault(); event.stopPropagation();
                    if (event.key === "Escape") {setRecording(null); return;}
                    const value = shortcutFromEvent(event); if (!value) return;
                    const problem = shortcutError(value, settings, id);
                    if (problem) {setError(problem); return;}
                    setSettings(current => ({...current, [id]: value})); setRecording(null); setError(""); setNotice("Guarda los cambios para aplicar el atajo.");
                }}/> : <kbd>{settings[id] || "Desactivado"}</kbd>}
                <div><button disabled={busy} onClick={() => {setRecording(id); setError("");}}>Cambiar</button><button disabled={busy || !settings[id]} onClick={() => {setSettings(current => ({...current, [id]: ""})); setRecording(null);}}>Desactivar</button></div>
            </div>)}</div>
            <div className="bold_profile_buttons"><button className="bold_profile_primary" disabled={busy || !!recording} onClick={save}>{busy ? "Guardando…" : "Guardar atajos"}</button><button disabled={busy} onClick={() => {setSettings({...defaultShortcuts}); setRecording(null); setError(""); setNotice("Valores restaurados. Guarda para aplicarlos.");}}>Restaurar predeterminados</button></div>
        </>}
        <h3>Atajos de edición y navegación</h3><p>Estos pertenecen al editor o al navegador y conservan su combinación original.</p>
        <dl className="bold_shortcut_existing"><div><dt>Guardar documento en el editor BOLD</dt><dd><kbd>Ctrl + S / Meta + S</kbd></dd></div><div><dt>Negrita / cursiva / subrayado en texto editable</dt><dd><kbd>Ctrl + B / I / U</kbd></dd></div><div><dt>Copiar / cortar / pegar / deshacer</dt><dd><kbd>Ctrl + C / X / V / Z</kbd></dd></div><div><dt>Drive: abrir / seleccionar archivo con foco</dt><dd><kbd>Enter / Espacio</kbd></dd></div><div><dt>Drive: solicitar envío a la papelera</dt><dd><kbd>Supr</kbd></dd></div><div><dt>Drive: selección múltiple / rango</dt><dd><kbd>Ctrl + clic / Shift + clic</kbd></dd></div><div><dt>Presentación: siguiente / anterior diapositiva</dt><dd><kbd>→ o Espacio / ←</kbd></dd></div><div><dt>Calendario: elegir un invitado sugerido</dt><dd><kbd>↑ / ↓ / Enter</kbd></dd></div><div><dt>Cerrar ventanas o menús</dt><dd><kbd>Escape</kbd></dd></div><div><dt>Mover foco entre controles</dt><dd><kbd>Tab / Shift + Tab</kbd></dd></div><div><dt>Atrás / adelante</dt><dd><kbd>Alt + ← / Alt + →</kbd></dd></div></dl>
    </section>;
}
