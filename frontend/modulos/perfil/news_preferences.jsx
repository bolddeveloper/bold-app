import {useEffect, useRef, useState} from "react";
import {createPortal} from "react-dom";
import {ArrowRight, Bell, ChevronLeft, ChevronRight, Keyboard, Layers, Newspaper, UserRound, X} from "lucide-react";
import {useDialog} from "../core/shared/use_dialog.js";
import {releaseNotes} from "./release_notes.js";
import "./news.css";

const icons = {keyboard: Keyboard, bell: Bell, profile: UserRound, update: Layers};
const dateLabel = date => new Date(`${date}T12:00:00`).toLocaleDateString("es", {day: "numeric", month: "long", year: "numeric"});

function NoteViewer({index, select, close}) {
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

export default function NewsPreferences() {
    const [selected, setSelected] = useState(null);
    return <section className="bold_news"><div inert={selected !== null ? true : undefined}>
        <header className="bold_news_heading"><div><h2>Novedades de BOLD</h2><p>Funciones nuevas, mejoras y correcciones de la demo.</p></div><span className="bold_news_badge">Notas de parche</span></header>
        {[...new Set(releaseNotes.map(note => note.date))].map(date => <section className="bold_news_group" key={date}><h3><time dateTime={date}>{dateLabel(date)}</time></h3><div className="bold_news_cards">{releaseNotes.filter(note => note.date === date).map(note => {
            const Icon = icons[note.icon] || Newspaper;
            return <button type="button" className="bold_news_card" key={note.id} onClick={() => setSelected(releaseNotes.indexOf(note))} aria-label={`Leer notas de parche: ${note.title}`}>
                <span className={`bold_news_thumbnail is_${note.icon}`} aria-hidden="true"><span>BOLD</span><Icon size={52}/></span><span className="bold_news_card_text"><span className="bold_news_category">{note.category}</span><strong>{note.title}</strong><span>{note.summary}</span><span className="bold_news_read">Leer notas de parche<ArrowRight size={16}/></span></span>
            </button>;
        })}</div></section>)}
    </div>{selected !== null && <NoteViewer index={selected} select={setSelected} close={() => setSelected(null)}/>}</section>;
}
