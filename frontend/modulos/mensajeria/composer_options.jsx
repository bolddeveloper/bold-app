import {useEffect,useRef,useState} from "react";
import {Paperclip} from "lucide-react";
import {useAnchoredPopover} from "../core/shared/use_anchored_popover.js";
import "./message_actions.css";

export default function ComposerOptions({children, disabled}) {
    const [open, setOpen] = useState(false), anchor = useRef(null), panel = useRef(null);
    useAnchoredPopover(open, anchor, panel, {minWidth:220, maxWidth:260, maxHeight:340});
    const close = () => {panel.current?.hidePopover?.(); setOpen(false);};
    useEffect(() => {if (disabled) close();}, [disabled]);
    return <>
        <button ref={anchor} type="button" aria-label="Opciones del mensaje" title="Adjuntos, menciones y opciones" aria-expanded={open} disabled={disabled} onClick={() => open ? close() : setOpen(true)}><Paperclip size={20} aria-hidden="true"/></button>
        <div ref={panel} popover="auto" className="messaging_composer_options" role="group" aria-label="Opciones del mensaje" onToggle={event => {if (event.newState === "closed") setOpen(false);}} onKeyDown={event => {if (event.key === "Escape") {event.preventDefault(); close(); anchor.current?.focus();}}} onClick={event => {if (event.target.closest("button")) {close(); anchor.current?.focus();}}}>{children}</div>
    </>;
}

