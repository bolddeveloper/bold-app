import { FileText, Sheet, Presentation, Plus, X } from "lucide-react";

const icons = { "application/vnd.google-apps.document": FileText, "application/vnd.google-apps.spreadsheet": Sheet, "application/vnd.google-apps.presentation": Presentation };
export default function InternalTabs({ tabs, active, select, close, create }) {
    function navigate(event) {
        const buttons = [...event.currentTarget.querySelectorAll('[role="tab"]')];
        const index = buttons.indexOf(document.activeElement);
        const next = event.key === "ArrowRight" ? (index + 1) % buttons.length : event.key === "ArrowLeft" ? (index - 1 + buttons.length) % buttons.length : event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : -1;
        if (next >= 0) { event.preventDefault(); buttons[next].focus(); buttons[next].click(); }
    }
    return <nav className="google_internal_tabs" aria-label="Pestañas Docs">
        <div role="tablist" onKeyDown={navigate}>
            <button id="docs-tab-home" role="tab" aria-selected={active === null} aria-controls="docs-tab-panel" tabIndex={active === null ? 0 : -1} onClick={() => select(null)}>Vista Docs</button>
            {tabs.map(file => { const Icon = icons[file.mimeType] || FileText; return <div className="google_file_tab" key={file.id}>
                <button id={`docs-tab-${file.id}`} role="tab" aria-selected={active === file.id} aria-controls="docs-tab-panel" tabIndex={active === file.id ? 0 : -1} onClick={() => select(file.id)} title={file.name}><Icon size={17}/><span>{file.name}</span></button>
                <button aria-label={`Cerrar ${file.name}`} onClick={() => { close(file.id); requestAnimationFrame(() => document.querySelector('.google_internal_tabs [aria-selected="true"]')?.focus()); }}><X size={15}/></button>
            </div>; })}
        </div>
        <button aria-label="Crear archivo Google" onClick={create}><Plus size={20}/></button>
    </nav>;
}
