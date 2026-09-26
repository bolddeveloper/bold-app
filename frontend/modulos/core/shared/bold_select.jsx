import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export function BoldSelect({ defaultValue, label, menuFooter, name, onValueChange, options, required = false, value }) {
    const controlled = value !== undefined;
    const [internalValue, setInternalValue] = useState(defaultValue ?? options[0]?.value ?? "");
    const [open, setOpen] = useState(false);
    const rootRef = useRef(null);
    const triggerRef = useRef(null);
    const currentValue = controlled ? value : internalValue;
    const selected = options.find(option => String(option.value) === String(currentValue)) || options[0];

    useEffect(() => {
        if (!open) return undefined;
        const closeOutside = event => { if (!rootRef.current?.contains(event.target)) setOpen(false); };
        const closeEscape = event => { if (event.key === "Escape") { setOpen(false); triggerRef.current?.focus(); } };
        document.addEventListener("pointerdown", closeOutside);
        document.addEventListener("keydown", closeEscape);
        return () => { document.removeEventListener("pointerdown", closeOutside); document.removeEventListener("keydown", closeEscape); };
    }, [open]);

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
        triggerRef.current?.focus();
    }

    function moveSelection(direction) {
        if (!options.length) return;
        const currentIndex = Math.max(0, options.findIndex(option => String(option.value) === String(currentValue)));
        select(options[(currentIndex + direction + options.length) % options.length].value);
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
        {open && <div className="admin_select_menu" role="listbox" aria-label={label}>
            {options.map(option => <button className={String(option.value) === String(currentValue) ? "is_selected" : ""} type="button" role="option" aria-selected={String(option.value) === String(currentValue)} key={option.value} onClick={() => select(option.value)}><span>{option.label}</span>{String(option.value) === String(currentValue) && <Check size={15} />}</button>)}
            {menuFooter}
        </div>}
    </div>;
}
