import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { filterSelectOptions } from "./bold_select_options.js";

export function BoldSelect({ defaultValue, label, menuFooter, name, onValueChange, options, required = false, searchable = false, searchPlaceholder = "Buscar…", value }) {
    const controlled = value !== undefined;
    const [internalValue, setInternalValue] = useState(defaultValue ?? options[0]?.value ?? "");
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const rootRef = useRef(null);
    const triggerRef = useRef(null);
    const currentValue = controlled ? value : internalValue;
    const selected = options.find(option => String(option.value) === String(currentValue)) || options[0];
    const visibleOptions = filterSelectOptions(options, query, searchable);

    useEffect(() => {
        if (!open) return undefined;
        const closeOutside = event => { if (!rootRef.current?.contains(event.target)) setOpen(false); };
        const closeEscape = event => { if (event.key === "Escape") { setOpen(false); triggerRef.current?.focus(); } };
        document.addEventListener("pointerdown", closeOutside);
        document.addEventListener("keydown", closeEscape);
        return () => { document.removeEventListener("pointerdown", closeOutside); document.removeEventListener("keydown", closeEscape); };
    }, [open]);
    useEffect(() => { if (!open && query) setQuery(""); }, [open]);

    useEffect(() => {
        if (controlled) return undefined;
        const form = rootRef.current?.closest("form");
        const reset = () => { setInternalValue(defaultValue ?? options[0]?.value ?? ""); setOpen(false); };
        form?.addEventListener("reset", reset);
        return () => form?.removeEventListener("reset", reset);
    }, [controlled, defaultValue]);

    function select(nextValue) {
        if (!controlled) setInternalValue(nextValue);
        onValueChange?.(nextValue);
        setOpen(false);
        setQuery("");
        triggerRef.current?.focus();
    }

    function moveSelection(direction) {
        if (!visibleOptions.length) return;
        const currentIndex = Math.max(0, visibleOptions.findIndex(option => String(option.value) === String(currentValue)));
        select(visibleOptions[(currentIndex + direction + visibleOptions.length) % visibleOptions.length].value);
    }

    return <div className={`admin_select ${open ? "is_open" : ""}`} ref={rootRef} onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
        {(name || required) && <select className="admin_select_native" name={name} value={currentValue} required={required} tabIndex={-1} aria-hidden="true" onChange={() => {}} onInvalid={event => { event.preventDefault(); triggerRef.current?.focus(); }}>
            {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>}
        <button ref={triggerRef} className="admin_select_trigger" type="button" aria-label={label} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(current => !current)} onKeyDown={event => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); open ? moveSelection(event.key === "ArrowDown" ? 1 : -1) : setOpen(true); }
        }}>
            <span>{selected?.label || "Seleccionar"}</span><ChevronDown size={16} />
        </button>
        {open && <div className="admin_select_menu">
            {searchable && <label className="admin_select_search"><Search size={15} /><input autoFocus type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={searchPlaceholder} aria-label={searchPlaceholder} />{query && <button type="button" aria-label="Limpiar búsqueda" onClick={() => setQuery("")}><X size={14} /></button>}</label>}
            <div className="admin_select_options" role="listbox" aria-label={label}>{visibleOptions.map(option => <button className={String(option.value) === String(currentValue) ? "is_selected" : ""} type="button" role="option" aria-selected={String(option.value) === String(currentValue)} key={option.value} onClick={() => select(option.value)}><span>{option.label}</span>{String(option.value) === String(currentValue) && <Check size={15} />}</button>)}
                {!visibleOptions.length && <p className="admin_select_empty">No se encontraron resultados.</p>}
            </div>
            {menuFooter}
        </div>}
    </div>;
}
