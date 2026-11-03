import {pickerDate,pickerDay,shiftPickerDay} from "./date_picker_data.js";
import {useEffect, useId, useLayoutEffect, useRef, useState} from "react";
import {CalendarDays, ChevronLeft, ChevronRight, X} from "lucide-react";
import {useAnchoredPopover} from "./use_anchored_popover.js";
import "./date_picker.css";

const months = Array.from({length:12}, (_, month) => new Date(2026, month, 1).toLocaleDateString("es", {month:"long"}));
const shortDate = value => pickerDate(value)?.toLocaleDateString("es", {day:"numeric", month:"short"}) || "Añadir fecha";
const distance = (start, end) => {
    if (!pickerDate(start) || !pickerDate(end)) return 0;
    return Math.round((Date.UTC(...end.split("-").map((n,i)=>Number(n)-(i===1?1:0))) - Date.UTC(...start.split("-").map((n,i)=>Number(n)-(i===1?1:0)))) / 86400000);
};

export function DatePicker({value="", start="", end="", range=false, allowPartial=false, initialField="start", onApply, onClear, onClose, title}) {
    const panel = useRef(null), anchor = useRef(null), id = useId();
    const today = pickerDay(new Date()), initial = pickerDate((range ? (initialField === "end" ? end || start : start || end) : value)) || pickerDate(today);
    const [view, setView] = useState({year:initial.getFullYear(), month:initial.getMonth()});
    const [draft, setDraft] = useState({start:range ? start : value, end:range ? end : ""});
    const [field, setField] = useState(initialField), [hover, setHover] = useState(""), [shortcut,setShortcut] = useState(null);
    const [focusDay, setFocusDay] = useState(pickerDay(initial));
    useLayoutEffect(() => {anchor.current = panel.current?.parentElement.querySelector("button");}, []);
    useAnchoredPopover(true, anchor, panel, {minWidth:336, maxWidth:336, maxHeight:560, overlapAnchor:true});
    const close = () => {onClose?.(); anchor.current?.focus({preventScroll:true});};
    const complete = pickerDate(draft.start) && pickerDate(draft.end) && draft.end >= draft.start;
    const valid = range ? (complete || (allowPartial && Boolean(pickerDate(draft.start) || pickerDate(draft.end)) && !(draft.start && draft.end))) : pickerDate(draft.start);
    const apply = () => {if (valid) onApply?.(range ? draft : draft.start); else close();};
    useEffect(() => {
        panel.current?.querySelector("[data-day][tabindex='0']")?.focus({preventScroll:true});
        return () => {anchor.current?.focus({preventScroll:true});};
    }, []);
    useEffect(() => {
        const outside = event => {if (!panel.current?.parentElement.contains(event.target)) apply();};
        const escape = event => {if (event.key === "Escape" && panel.current?.contains(event.target)) {event.preventDefault(); event.stopImmediatePropagation(); close();}};
        document.addEventListener("pointerdown", outside);
        document.addEventListener("keydown", escape, true);
        return () => {document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape, true);};
    }, [draft, onApply, onClose]);
    function showDate(day) {
        const date = pickerDate(day); if (!date) return;
        setView({year:date.getFullYear(), month:date.getMonth()}); setFocusDay(day);
    }
    function pick(day) {
        setHover(""); setFocusDay(day); setShortcut(null);
        if (!range) {setDraft({start:day, end:""}); return;}
        if (field === "end" && !draft.start && allowPartial) {setDraft({...draft,end:day});setField("start");return;}
        if (field === "start" || !draft.start) {
            setDraft({start:day, end:draft.end && draft.end >= day ? draft.end : ""}); setField("end");
        } else {
            setDraft(day < draft.start ? {start:day, end:draft.start} : {...draft, end:day}); setField("start");
        }
    }
    function keyboard(event, day) {
        const date = pickerDate(day), offset = (date.getDay()+6)%7;
        const step = {ArrowLeft:-1, ArrowRight:1, ArrowUp:-7, ArrowDown:7, Home:-offset, End:6-offset}[event.key];
        let next;
        if (step !== undefined) next = shiftPickerDay(day, step);
        else if (["PageUp","PageDown"].includes(event.key)) {
            const month = date.getMonth() + (event.key === "PageUp" ? -1 : 1), last = new Date(date.getFullYear(), month+1, 0).getDate();
            next = pickerDay(new Date(date.getFullYear(), month, Math.min(date.getDate(), last), 12));
        } else return;
        event.preventDefault(); showDate(next);
        requestAnimationFrame(() => panel.current?.querySelector(`[data-day="${next}"]`)?.focus({preventScroll:true}));
    }
    function moveMonth(amount) {
        const next = new Date(view.year, view.month+amount, 1, 12);
        setView({year:next.getFullYear(), month:next.getMonth()}); setHover(""); setFocusDay(pickerDay(next));
    }
    function preset(kind) {
        const base = draft.start || today;
        let first = base, last;
        if (kind === "weekend") {
            const weekday = pickerDate(base).getDay(); first = shiftPickerDay(base, (6-weekday+7)%7); last = shiftPickerDay(first,1);
        } else if (range) last = shiftPickerDay(base, Number(kind));
        else first = shiftPickerDay(today, Number(kind));
        setDraft({start:first, end:range ? last : ""}); setShortcut(kind); setField("start"); setHover(""); showDate(first);
    }
    const firstOffset = (new Date(view.year, view.month, 1).getDay()+6)%7;
    const total = new Date(view.year, view.month+1, 0).getDate(), rows = Math.ceil((firstOffset+total)/7);
    const monthStart = pickerDay(new Date(view.year, view.month, 1,12)), monthEnd = pickerDay(new Date(view.year, view.month,total,12));
    const preview = range && field === "end" && draft.start && hover ? (hover < draft.start ? {start:hover,end:draft.start} : {...draft,end:hover}) : draft;
    const hasRange = range && preview.start && preview.end;
    const index = day => firstOffset + Number(day.slice(8))-1;
    const inMonth = day => day && day >= monthStart && day <= monthEnd;
    const rangeFirst = hasRange ? index(preview.start < monthStart ? monthStart : preview.start) : -1;
    const rangeLast = hasRange ? index(preview.end > monthEnd ? monthEnd : preview.end) : -1;
    const shownRange = hasRange && preview.start <= monthEnd && preview.end >= monthStart;
    const days = range && complete ? distance(draft.start,draft.end) : 0;
    return <div ref={panel} popover="manual" className="bold_date_picker" role="dialog" aria-labelledby={`${id}-title`} onClick={e=>e.stopPropagation()}>
        <header className="bold_date_picker_heading"><h3 id={`${id}-title`}>{title || (range ? "Seleccionar fechas" : "Seleccionar fecha")}</h3><span className="bold_date_duration" aria-live="polite" title="Días entre la fecha de inicio y fin">{range ? (complete ? (days ? `${days} ${days===1?"día":"días"}` : "Mismo día") : valid ? (draft.start ? "Sin fin" : "Sin inicio") : "Elige un rango") : (draft.start ? "Fecha elegida" : "Sin fecha")}</span><button type="button" aria-label="Cerrar calendario" onClick={close}><X size={15}/></button></header>
        <div className="bold_date_picker_surface">
            <div className={`bold_date_endpoints${range ? " is_range" : ""}`}>
                <button type="button" className={field === "start" ? "is_active" : ""} onClick={()=>{setField("start");setHover("");if(draft.start)showDate(draft.start);}}><small>{range ? "Inicio" : "Fecha"}</small><strong>{shortDate(draft.start)}</strong></button>
                {range && <button type="button" className={field === "end" ? "is_active" : ""} onClick={()=>{setField("end");setHover("");if(draft.end)showDate(draft.end);}}><small>Fin</small><strong>{shortDate(draft.end)}</strong></button>}
                <span className="bold_date_endpoint_line" aria-hidden="true" style={{transform:`translateX(${range && field === "end" ? 100 : 0}%)`}}/>
            </div>
            <div className="bold_date_month_nav"><div><select aria-label="Mes" value={view.month} onChange={e=>{const month=Number(e.target.value);setView({...view,month});setFocusDay(pickerDay(new Date(view.year,month,1,12)));}}>{months.map((name,i)=><option key={name} value={i}>{name}</option>)}</select><select aria-label="Año" value={view.year} onChange={e=>{const year=Number(e.target.value);setView({...view,year});setFocusDay(pickerDay(new Date(year,view.month,1,12)));}}>{Array.from({length:Math.max(2100,view.year)-Math.min(2000,view.year)+1},(_,i)=>Math.min(2000,view.year)+i).map(year=><option key={year} value={year}>{year}</option>)}</select></div><button type="button" aria-label="Mes anterior" onClick={()=>moveMonth(-1)}><ChevronLeft size={16}/></button><button type="button" aria-label="Mes siguiente" onClick={()=>moveMonth(1)}><ChevronRight size={16}/></button></div>
            <div className="bold_date_weekdays" aria-hidden="true">{["L","M","X","J","V","S","D"].map((day,i)=><span key={i}>{day}</span>)}</div>
            <div className="bold_date_days" style={{"--date-rows":rows}} role="group" aria-label={`${months[view.month]} ${view.year}`} onPointerLeave={()=>setHover("")}>
                {Array.from({length:rows},(_,row)=>{
                    const first=Math.max(rangeFirst,row*7), last=Math.min(rangeLast,row*7+6), visible=shownRange && first<=last;
                    const left=first===rangeFirst?(first%7+.5)/7:0, right=last===rangeLast?(last%7+.5)/7:1;
                    return <span key={`fill-${row}`} className="bold_date_range_fill" aria-hidden="true" style={{"--date-row":row,opacity:visible?1:0,transform:`translateX(${left*100}%) scaleX(${visible?right-left:0})`}}/>;
                })}
                {[preview.start,range?preview.end:""].map((day,i)=><span key={`knob-${i}`} className={`bold_date_knob${i===1?" is_end":""}`} aria-hidden="true" style={{opacity:inMonth(day)?1:0,transform:`translate(${inMonth(day)?index(day)%7*100:0}%, ${inMonth(day)?Math.floor(index(day)/7)*100:0}%)`}}/>)}
                {Array.from({length:firstOffset},(_,i)=><span key={`blank-${i}`} aria-hidden="true"/>)}
                {Array.from({length:total},(_,i)=>{
                    const day=`${view.year}-${String(view.month+1).padStart(2,"0")}-${String(i+1).padStart(2,"0")}`, endpoint=day===preview.start || (range && day===preview.end);
                    return <button key={day} type="button" data-day={day} tabIndex={focusDay===day?0:-1} aria-label={pickerDate(day).toLocaleDateString("es",{day:"numeric",month:"long",year:"numeric"})} aria-current={day===today?"date":undefined} aria-pressed={day===draft.start || (range && day===draft.end)} className={endpoint?"is_endpoint":""} onFocus={()=>setFocusDay(day)} onPointerEnter={()=>setHover(day)} onKeyDown={e=>keyboard(e,day)} onClick={()=>pick(day)}>{i+1}</button>;
                })}
            </div>
        </div>
        <div className="bold_date_presets" role="group" aria-label="Fechas rápidas">{(range ? [["weekend","Fin de semana"],[3,"3 días"],[7,"1 semana"],[14,"2 semanas"]] : [[0,"Hoy"],[1,"Mañana"],[7,"+1 semana"],[14,"+2 semanas"]]).map(([kind,label])=><button key={kind} type="button" aria-pressed={shortcut===kind} onClick={()=>preset(kind)}>{label}</button>)}</div>
        <footer className="bold_date_picker_footer"><button type="button" className="bold_date_clear" disabled={!onClear} onClick={()=>onClear?.()}>Limpiar</button><button type="button" className="bold_date_apply" disabled={!valid} onClick={apply}>Aplicar</button></footer>
    </div>;
}

export function CalendarDateField({value="",onChange,disabled=false,ariaLabel="Elegir fecha"}) {
    const [open,setOpen]=useState(false);
    const change=next=>{onChange?.(next);setOpen(false);};
    return <div className="calendar_date_field bold_date_range_field">
        <button type="button" className="bold_date_trigger_btn" disabled={disabled} aria-label={ariaLabel} aria-expanded={open && !disabled} onClick={()=>setOpen(!open)}><CalendarDays size={15}/><span>{value ? shortDate(value):'Seleccionar fecha'}</span></button>
        {open && !disabled && <DatePicker value={value} onApply={change} onClose={()=>setOpen(false)} onClear={()=>change('')}/>}
    </div>;
}

export function CalendarDateRangeField({start, end, defaultStart="", defaultEnd="", startName, endName, onChange, disabled=false, required=false}) {
    const root=useRef(null), [local,setLocal]=useState({start:defaultStart,end:defaultEnd}), [open,setOpen]=useState(false);
    const current={start:start===undefined?local.start:start,end:end===undefined?local.end:end};
    const change=range=>{setLocal(range);onChange?.(range);setOpen(false);};
    useEffect(()=>{const form=root.current?.closest("form"),reset=()=>{setLocal({start:defaultStart,end:defaultEnd});setOpen(false);};form?.addEventListener("reset",reset);return()=>form?.removeEventListener("reset",reset);},[defaultStart,defaultEnd]);
    return <div className="calendar_date_field bold_date_range_field" ref={root}>
        {startName && <input type="hidden" name={startName} value={current.start||""}/>}{endName && <input type="hidden" name={endName} value={current.end||""}/>}
        <button type="button" className="bold_date_trigger_btn" disabled={disabled} aria-label="Elegir inicio y fin" aria-expanded={open} onClick={()=>setOpen(!open)}><CalendarDays size={15}/><span>{current.start || current.end ? `${current.start ? shortDate(current.start) : "Sin inicio"} – ${current.end ? shortDate(current.end) : "Sin fin"}` : "Seleccionar fechas"}</span></button>
        {open && !disabled && <DatePicker range allowPartial={!required} initialField={!current.start && current.end ? "end" : "start"} start={current.start} end={current.end} onApply={change} onClose={()=>setOpen(false)} onClear={required?undefined:()=>change({start:"",end:""})}/>}
    </div>;
}
