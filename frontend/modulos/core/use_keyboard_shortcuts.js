import {useEffect, useState} from "react";
import {http} from "./http_client.js";
import {defaultShortcuts, shortcutsEndpoint, shortcutFromEvent, canRunShortcut} from "./keyboard_shortcuts.js";
import {isShellModuleAllowed} from "./shell_navigation_state.js";

export function useKeyboardShortcuts(contextId, shell, handlers) {
    const [settings, setSettings] = useState(null);
    useEffect(() => {
        setSettings(null);
        const controller = new AbortController();
        http.request(shortcutsEndpoint, {signal: controller.signal}).then(value => {if (!controller.signal.aborted) setSettings(value);})
            .catch(() => {if (!controller.signal.aborted) setSettings(defaultShortcuts);});
        const changed = event => setSettings(event.detail);
        window.addEventListener("bold:shortcuts-changed", changed);
        return () => {controller.abort(); window.removeEventListener("bold:shortcuts-changed", changed);};
    }, [contextId]);
    useEffect(() => {
        if (!settings) return;
        const keydown = event => {
            if (!canRunShortcut(event, document.querySelector('[role="dialog"], [role="alertdialog"], .swal2-container'))) return;
            const binding = shortcutFromEvent(event);
            const action = Object.keys(settings).find(id => settings[id] && settings[id] === binding);
            if (!action) return;
            if (action === "search") {
                const input = document.getElementById("task_search");
                if (!input?.getClientRects().length) return;
                event.preventDefault(); input.focus(); return;
            }
            if (action === "notifications") {event.preventDefault(); handlers.handle_toggle_notifications(); return;}
            if (action === "theme") {event.preventDefault(); shell.set_is_dark_mode(value => !value); return;}
            if (!isShellModuleAllowed(action, shell.navigation_items)) return;
            event.preventDefault(); shell.set_active_module(action);
        };
        document.addEventListener("keydown", keydown);
        return () => document.removeEventListener("keydown", keydown);
    }, [settings, shell, handlers]);
}
