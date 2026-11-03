import {useEffect, useRef} from "react";
import {ArrowRight, Bell, Keyboard, Layers, Newspaper, UserRound, X} from "lucide-react";
import {releaseNotes} from "../perfil/release_notes.js";
import {useDialog} from "./shared/use_dialog.js";
import "./header_news.css";

const icons = {keyboard:Keyboard, bell:Bell, profile:UserRound, update:Layers};

export function HeaderNewsPanel({anchor, onClose, onViewAll, onSelect}) {
    const panel = useRef(null);
    useDialog(true, ".header_news_panel", onClose);
    useEffect(() => {
        const outside = event => {if (!panel.current?.contains(event.target) && !anchor?.contains(event.target)) onClose();};
        document.addEventListener("pointerdown", outside);
        return () => document.removeEventListener("pointerdown", outside);
    }, [anchor, onClose]);
    return <section ref={panel} className="task_tool_panel header_news_panel" role="dialog" aria-labelledby="header_news_title" id="header_news_panel">
        <header><h3 id="header_news_title">Novedades</h3><button className="header_news_all" type="button" onClick={onViewAll}>Ver todo<ArrowRight size={14}/></button><button className="header_news_close" type="button" aria-label="Cerrar novedades" onClick={onClose}><X size={18}/></button></header>
        <p className="header_news_intro">Los últimos parches de BOLD.</p>
        <div className="header_news_list">{releaseNotes.slice(0,3).map((note,index) => {
            const Icon = icons[note.icon] || Newspaper;
            return <button type="button" className="header_news_card" key={note.id} aria-label={`Leer notas de parche: ${note.title}`} onClick={() => onSelect(index)}>
                <span className="header_news_icon" aria-hidden="true"><Icon size={19}/></span>
                <span className="header_news_copy"><span className="header_news_meta"><span>{note.category}</span><time dateTime={note.date}>{new Date(`${note.date}T12:00:00`).toLocaleDateString("es",{day:"numeric",month:"short"})}</time></span><strong>{note.title}</strong><span className="header_news_summary">{note.summary}</span></span>
                <ArrowRight size={14} className="header_news_arrow" aria-hidden="true"/>
            </button>;
        })}</div>
    </section>;
}
