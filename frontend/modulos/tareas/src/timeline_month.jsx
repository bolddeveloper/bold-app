import {useEffect,useMemo,useRef,useState} from "react";
import {Check,X} from "lucide-react";
import {useAnchoredPopover} from "../../core/shared/use_anchored_popover.js";
import {dateFromISO} from "./services/task_models.js";
import {timelineMonthWeeks,timelineTaskColor} from "./timeline_data.js";

const dateLabel=day=>dateFromISO(day).toLocaleDateString("es",{day:"numeric",month:"long",year:"numeric"});
const weekdays=["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];

export function TimelineMonth({tasks,start,today,onSelect}) {
    const weeks=useMemo(()=>timelineMonthWeeks(tasks,start),[tasks,start]);
    const [openDay,setOpenDay]=useState(null),anchor=useRef(null),panel=useRef(null);
    useAnchoredPopover(Boolean(openDay),anchor,panel,{minWidth:280,maxWidth:360,maxHeight:320,overlapAnchor:true});
    useEffect(()=>setOpenDay(null),[start]);
    const opened=weeks.flatMap(week=>week.items).filter(item=>openDay && item.range.start<=openDay && item.range.end>=openDay);
    const uniqueOpened=[...new Map(opened.map(item=>[item.task.id,item])).values()];
    const close=()=>{setOpenDay(null);anchor.current?.focus({preventScroll:true});};
    let barOrder=0;
    return <div className="bold_timeline_month" role="region" aria-label="Calendario mensual del cronograma" tabIndex={0}>
        <div className="bold_month_weekdays">{weekdays.map(day=><span key={day} aria-label={day}><span className="bold_month_weekday_full">{day}</span><span className="bold_month_weekday_short" aria-hidden="true">{day.slice(0,3)}</span></span>)}</div>
        <div className="bold_month_weeks">{weeks.map((week,row)=>{
            const visibleLanes=Math.min(3,week.lanes),hidden=week.items.filter(item=>item.lane>=3);
            return <div className="bold_month_week" key={`${start}:${row}`} style={{"--month-height":`${Math.max(112,34+visibleLanes*27+(hidden.length?30:0))}px`}}>
                {week.days.map((day,column)=>{
                    if(!day)return <div key={`blank-${column}`} className="bold_month_cell is_blank" aria-hidden="true"/>;
                    const items=week.items.filter(item=>item.range.start<=day && item.range.end>=day),extra=hidden.filter(item=>item.range.start<=day && item.range.end>=day);
                    return <div key={day} className={`bold_month_cell${day===today?" is_today":""}${[0,6].includes(column)?" is_weekend":""}`} data-day={day} aria-label={dateLabel(day)}>
                        <span className="bold_month_day_number" aria-current={day===today?"date":undefined}>{dateFromISO(day).getDate()}</span>
                        {extra.length>0 && <button type="button" className="bold_month_overflow" aria-label={`Ver las ${items.length} tareas del ${dateLabel(day)}`} onClick={event=>{anchor.current=event.currentTarget;setOpenDay(day);}}><span className="bold_month_dots" aria-hidden="true">{extra.slice(0,3).map(item=><i key={item.task.id} style={{background:timelineTaskColor(item.task)}}/>)}</span><small>+{extra.length}</small></button>}
                    </div>;
                })}
                {week.items.filter(item=>item.lane<3).map(item=><button key={item.task.id} type="button" className={`bold_month_task${item.task.completed?" is_completed":""}${item.continuesBefore?" continues_before":""}${item.continuesAfter?" continues_after":""}`} style={{"--timeline-color":timelineTaskColor(item.task),"--bold-timeline-delay":`${200+Math.min(700,barOrder++*30)}ms`,gridColumn:`${item.column+1}/span ${item.span}`,top:`${30+item.lane*27}px`}} title={`${item.task.title}. ${dateLabel(item.range.start)} – ${dateLabel(item.range.end)}`} aria-label={`${item.task.title}. ${dateLabel(item.range.start)} – ${dateLabel(item.range.end)}. ${item.task.completed?"Completada":"Pendiente"}`} onClick={()=>onSelect(item.task.id)}><i aria-hidden="true"/>{item.task.completed && <Check size={11} aria-hidden="true"/>}<span>{item.task.title}</span></button>)}
            </div>;
        })}</div>
        {openDay && <div ref={panel} popover="auto" className="bold_month_day_popup" role="group" aria-label={`Tareas del ${dateLabel(openDay)}`} onToggle={event=>{if(event.newState==="closed")setOpenDay(null);}} onKeyDown={event=>{if(event.key==="Escape"){event.preventDefault();event.stopPropagation();close();}}}>
            <header><strong>{dateLabel(openDay)}</strong><button type="button" aria-label="Cerrar tareas del día" onClick={close}><X size={15}/></button></header>
            {uniqueOpened.map(item=><button key={item.task.id} type="button" className="bold_month_day_task" style={{"--timeline-color":timelineTaskColor(item.task)}} onClick={()=>{setOpenDay(null);onSelect(item.task.id);}}><i aria-hidden="true"/><span>{item.task.title}</span>{item.task.completed && <Check size={13} aria-label="Completada"/>}</button>)}
        </div>}
    </div>;
}
