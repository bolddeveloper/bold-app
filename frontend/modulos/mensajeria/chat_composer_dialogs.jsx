import {useEffect, useRef, useState} from 'react';
import {BriefcaseBusiness, Clock, Hand, PartyPopper, Search, Smile, X} from 'lucide-react';
import {useDialog} from '../core/shared/use_dialog.js';
import {useAnchoredPopover} from '../core/shared/use_anchored_popover.js';
import MessagingPreferences from '../perfil/messaging_preferences.jsx';

const emojiGroups = [
    ['Expresiones', [['😀','Sonrisa'],['😃','Alegría'],['😄','Feliz'],['😁','Sonriendo'],['😆','Risa'],['😂','Risas'],['🤣','Carcajada'],['😊','Sonrojo'],['🙂','Bien'],['😉','Guiño'],['😍','Encanta'],['🥰','Cariño'],['😎','Genial'],['🤔','Pensando'],['🧐','Revisando'],['😅','Alivio'],['😮','Sorpresa'],['😢','Triste'],['😭','Llorando'],['😴','Sueño'],['🥳','Fiesta'],['🤗','Abrazo'],['🤩','Increíble'],['😇','Ángel']]],
    ['Gestos', [['👍','Pulgar arriba'],['👎','Pulgar abajo'],['👏','Aplausos'],['🙌','Celebrar'],['🙏','Gracias'],['🤝','Acuerdo'],['💪','Fuerza'],['👋','Saludo'],['👌','Perfecto'],['✌️','Paz'],['🤞','Suerte'],['🫶','Apoyo'],['👀','Ojos'],['🧠','Ideas'],['✍️','Escribiendo'],['👂','Escuchando']]],
    ['Trabajo', [['✅','Listo'],['☑️','Completado'],['📌','Importante'],['📅','Calendario'],['⏰','Hora'],['📁','Carpeta'],['📎','Adjunto'],['📝','Nota'],['💡','Idea'],['🎯','Objetivo'],['🚀','Cohete'],['📈','Crecimiento'],['💻','Computadora'],['🎨','Diseño'],['🎬','Producción'],['📣','Marketing'],['🔍','Buscar'],['⚡','Rápido'],['🔔','Aviso'],['☕','Café']]],
    ['Celebración', [['❤️','Corazón'],['🧡','Corazón naranja'],['💛','Corazón amarillo'],['💚','Corazón verde'],['💙','Corazón azul'],['💜','Corazón morado'],['🔥','Fuego'],['✨','Brillo'],['⭐','Estrella'],['🎉','Celebración'],['🎊','Confeti'],['🏆','Logro'],['🥇','Primer lugar'],['🎁','Regalo'],['🎂','Cumpleaños'],['🌟','Excelente']]],
];
const normalized = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();

const categoryIcons = [Smile,Hand,BriefcaseBusiness,PartyPopper];

export function ChatEmojiPicker({anchorRef,recent=[],onSelect,onClose}) {
    const [query,setQuery]=useState(''),[group,setGroup]=useState(recent.length ? -1:0),field=useRef(null),panel=useRef(null);
    useAnchoredPopover(true,anchorRef,panel,{minWidth:360,maxWidth:420,maxHeight:440});
    useEffect(()=>{field.current?.focus();},[]);
    useEffect(()=>{
        const outside=event=>{if(!panel.current?.contains(event.target) && !anchorRef.current?.contains(event.target))onClose();};
        const escape=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose();anchorRef.current?.focus();}};
        document.addEventListener('pointerdown',outside);
        document.addEventListener('keydown',escape,true);
        return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape,true);};
    },[anchorRef,onClose]);
    const all=emojiGroups.flatMap(([,items])=>items);
    const rows=(query.trim() ? all : group===-1 ? recent.map(emoji=>all.find(item=>item[0]===emoji)).filter(Boolean) : emojiGroups[group][1]).filter(([emoji,name])=>normalized(name).includes(normalized(query.trim())) || emoji.includes(query.trim()));
    return <section ref={panel} popover="manual" className="messaging_emoji_dialog messaging_compact_dialog" role="dialog" aria-labelledby="messaging_emoji_title" onBlur={event=>{if(event.relatedTarget && !event.currentTarget.contains(event.relatedTarget) && !anchorRef.current?.contains(event.relatedTarget))onClose();}}>
        <header><h2 id="messaging_emoji_title">Emojis</h2><button type="button" aria-label="Cerrar emojis" onClick={()=>{onClose();anchorRef.current?.focus();}}><X size={18} aria-hidden="true"/></button></header>
        <div className="messaging_emoji_categories" role="group" aria-label="Categorías de emojis"><button type="button" aria-label="Recientes" title="Recientes" aria-pressed={!query && group===-1} onClick={()=>{setQuery('');setGroup(-1);}}><Clock size={19} aria-hidden="true"/></button>{emojiGroups.map(([name],index)=>{const Icon=categoryIcons[index];return <button key={name} type="button" aria-label={name} title={name} aria-pressed={!query && group===index} onClick={()=>{setQuery('');setGroup(index);}}><Icon size={19} aria-hidden="true"/></button>;})}</div>
        <label className="messaging_emoji_search"><Search size={16} aria-hidden="true"/><input ref={field} type="search" aria-label="Buscar emoji" placeholder="Buscar emoji" value={query} onChange={event=>setQuery(event.target.value)}/></label>
        <h3 className="messaging_emoji_group_title">{query.trim() ? 'Resultados' : group===-1 ? 'Recientes':emojiGroups[group][0]}</h3>
        <div className="messaging_emoji_grid" role="group" aria-label="Insertar emoji">{rows.map(([emoji,name])=><button key={emoji} type="button" aria-label={name} title={name} onClick={()=>onSelect(emoji)}>{emoji}</button>)}</div>
        {!rows.length && <p role="status">{group===-1 && !query.trim() ? 'Aquí aparecerán los emojis que uses durante esta sesión.':'No hay coincidencias. Prueba otra palabra.'}</p>}
    </section>;
}

export function ChatEnterPreferences({onClose}) {
    useDialog(true,'.messaging_preferences_dialog',onClose);
    return <div className="messaging_dialog_scrim"><section className="messaging_preferences_dialog messaging_compact_dialog" role="dialog" aria-modal="true" aria-labelledby="messaging_preferences_title"><header><h2 id="messaging_preferences_title">Preferencia de Enter</h2><button type="button" aria-label="Cerrar preferencia de Enter" onClick={onClose}><X size={18} aria-hidden="true"/></button></header><MessagingPreferences/></section></div>;
}
