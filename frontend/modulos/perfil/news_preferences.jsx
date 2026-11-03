import {useEffect, useRef, useState} from "react";
import {createPortal} from "react-dom";
import {ArrowRight, Bell, ChevronLeft, ChevronRight, Keyboard, Layers, Newspaper, UserRound, X} from "lucide-react";
import {useDialog} from "../core/shared/use_dialog.js";
import {getReleaseNotes, releaseNotes as publicNotes} from "./release_notes.js";
import {useCore} from "../core/core_provider.jsx";
import "./news.css";

const icons = {keyboard: Keyboard, bell: Bell, profile: UserRound, update: Layers};
const dateLabel = date => new Date(`${date}T12:00:00`).toLocaleDateString("es", {day: "numeric", month: "long", year: "numeric"});
const notesPerPage = 6;

export function NoteViewer({index, select, close, releaseNotes = publicNotes}) {
    const note = releaseNotes[index], body = useRef(null), Icon = icons[note.icon] || Newspaper;
    useDialog(true, ".bold_news_dialog", close);
    useEffect(() => {body.current.scrollTop = 0;}, [note.id]);
    return createPortal(<div className={`bold_news_overlay ${document.documentElement.dataset.boldTheme === "dark" ? "theme_dark" : ""}`} onMouseDown={event => {if (event.target === event.currentTarget) close();}}>
        <section className="bold_news_dialog" role="dialog" aria-modal="true" aria-labelledby="bold_news_title">
            <header><div><span className="bold_news_category">{note.category}</span><time dateTime={note.date}>{dateLabel(note.date)}</time><h2 id="bold_news_title">{note.title}</h2></div><button type="button" aria-label="Cerrar notas de parche" onClick={close}><X size={23}/></button></header>
            <article ref={body} className="bold_news_body"><div className={`bold_news_cover is_${note.icon}`} aria-hidden="true"><span>BOLD</span><Icon size={76}/></div><p className="bold_news_intro">{note.summary}</p>{note.sections.map(section => <section key={section.title}><h3>{section.title}</h3><ul>{section.items.map(item => <li key={item}>{item}</li>)}</ul></section>)}</article>
            <footer><button disabled={index === 0} onClick={() => select(index - 1)}><ChevronLeft size={17}/>Anterior</button><span>{index + 1} de {releaseNotes.length}</span><button disabled={index === releaseNotes.length - 1} onClick={() => select(index + 1)}>Siguiente<ChevronRight size={17}/></button></footer>
        </section>
    </div>, document.body);
}

function NewsContent({releaseNotes}) {
    const [selected, setSelected] = useState(null);
    const [page, setPage] = useState(0);
    const heading = useRef(null);
    const start = page * notesPerPage;
    const pages = Math.ceil(releaseNotes.length / notesPerPage);
    function changePage(next) {
        setPage(next);
        heading.current.focus();
    }
    return <section className="bold_news"><div inert={selected !== null ? true : undefined}>
        <header className="bold_news_heading"><div><h2 ref={heading} tabIndex={-1}>Novedades de BOLD</h2><p>Funciones nuevas, mejoras y correcciones de la demo.</p></div><span className="bold_news_badge">{releaseNotes.length} notas</span></header>
        <div className="bold_news_cards" key={page}>{releaseNotes.slice(start, start + notesPerPage).map((note, offset) => {
            const Icon = icons[note.icon] || Newspaper;
            return <button type="button" className="bold_news_card" key={note.id} onClick={() => setSelected(start + offset)} aria-label={`Leer notas de parche: ${note.title}`}>
                <span className={`bold_news_thumbnail is_${note.icon}`} aria-hidden="true"><Icon size={22}/></span><span className="bold_news_card_text"><span className="bold_news_meta"><span className="bold_news_category">{note.category}</span><time dateTime={note.date}>{dateLabel(note.date)}</time></span><strong>{note.title}</strong><span className="bold_news_summary">{note.summary}</span><span className="bold_news_read">Leer nota<ArrowRight size={16}/></span></span>
            </button>;
        })}</div>
        {pages > 1 && <nav className="bold_news_pagination" aria-label="Páginas de novedades">
            <button type="button" disabled={page === 0} onClick={() => changePage(page - 1)}><ChevronLeft size={16}/>Anterior</button>
            <span role="status">Página {page + 1} de {pages}</span>
            <button type="button" disabled={page === pages - 1} onClick={() => changePage(page + 1)}>Siguiente<ChevronRight size={16}/></button>
        </nav>}
    </div>{selected !== null && <NoteViewer releaseNotes={releaseNotes} index={selected} select={setSelected} close={() => setSelected(null)}/>}</section>;
}

export default function NewsPreferences() {
    const {activeAssignment} = useCore();
    return <NewsContent key={`${activeAssignment?.id || "none"}:${activeAssignment?.chat_enabled === true}`} releaseNotes={getReleaseNotes(activeAssignment)}/>;
}
