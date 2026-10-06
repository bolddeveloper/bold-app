export const shortcutActions = [
    ["home", "Inicio", "Ctrl+Shift+1"], ["tasks", "Tareas", "Ctrl+Shift+2"],
    ["projects", "Proyectos", "Ctrl+Shift+3"], ["workspaces", "Workspaces", "Ctrl+Shift+4"],
    ["calendar", "Calendario", "Ctrl+Shift+5"], ["drive", "Drive", "Ctrl+Shift+6"],
    ["docs", "Docs", "Ctrl+Shift+7"], ["inbox", "Bandeja de entrada", "Ctrl+Shift+8"],
    ["profile", "Perfil", "Ctrl+Shift+9"], ["suggestions", "Sugerencias", "Ctrl+Shift+0"],
    ["reports", "Informes", "Ctrl+Alt+I"], ["permissions", "Permisos", "Ctrl+Alt+P"],
    ["administration", "Administración", "Ctrl+Alt+A"], ["search", "Buscar en BOLD", "Ctrl+K"],
    ["notifications", "Abrir/cerrar notificaciones", "Ctrl+Alt+N"], ["theme", "Cambiar tema", "Ctrl+Alt+T"],
];
export const defaultShortcuts = Object.fromEntries(shortcutActions.map(([id, , key]) => [id, key]));
export const shortcutsEndpoint = "/api/v2/auth/shortcut-settings/";

export function shortcutFromEvent(event) {
    if (event.isComposing || event.getModifierState?.("AltGraph") || event.ctrlKey && event.metaKey || !event.ctrlKey && !event.metaKey) return "";
    // event.code mantiene los números aunque Shift cambie el carácter a !, @, etc.
    const key = /^(Key[A-Z]|Digit[0-9])$/.test(event.code || "") ? event.code.replace(/^(Key|Digit)/, "") : String(event.key || "").toUpperCase();
    if (!/^[A-Z0-9]$/.test(key)) return "";
    return `${event.metaKey ? "Meta" : "Ctrl"}+${event.altKey ? "Alt+" : ""}${event.shiftKey ? "Shift+" : ""}${key}`;
}

export function shortcutError(value, settings, action) {
    if (!/^(Ctrl|Meta)\+(Alt\+)?(Shift\+)?[A-Z0-9]$/.test(value)) return "Usa Ctrl o Meta y una letra o número.";
    if (!value.includes("Alt+") && !/[0-9]$/.test(value) && !value.endsWith("+K")) return "Combinación reservada. Añade Alt o elige un número.";
    if (Object.entries(settings).some(([id, binding]) => id !== action && binding === value)) return "Ese atajo ya está asignado a otra acción.";
    return "";
}

export function canRunShortcut(event, modalOpen) {
    return !event.defaultPrevented && !event.repeat && !event.isComposing && !modalOpen
        && !event.target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]');
}
