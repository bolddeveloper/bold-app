import {TimelineMonth} from "./timeline_month.jsx";
import {useMemo,useRef,useState} from "react";
import {CalendarDays,Check,ChevronLeft,ChevronRight,UserRound} from "lucide-react";
import {dateFromISO} from "./services/task_models.js";
import {initialTimelineDay,shiftTimelinePeriod,timelineDay,timelineRows,timelineWindow,timelineTaskColor} from "./timeline_data.js";
import "./task_timeline.css";

const displayDate = value => dateFromISO(value)?.toLocaleDateString("es",{day:"numeric",month:"short",year:"numeric"}) || "Sin fecha";

export function TaskTimeline({tasks,members=[],projects=[],renderAvatar,onSelect}) {
    const [anchor,setAnchor]=useState(()=>initialTimelineDay(tasks)), [scale,setScale]=useState("14"), [status,setStatus]=useState("all");
    const scroll=useRef(null), window=useMemo(()=>timelineWindow(anchor,scale),[anchor,scale]);
    const viewTasks=useMemo(()=>tasks.filter(task=>status==="all" || Boolean(task.completed)===(status==="completed")),[tasks,status]);
    const {rows,undated}=useMemo(()=>timelineRows(viewTasks,members,window),[viewTasks,members,window]);
    const today=timelineDay(new Date()), visibleCount=rows.reduce((count,row)=>count+row.items.length,0), datedCount=rows.reduce((count,row)=>count+row.total,0);
    const todayIndex=window.days.indexOf(today);
    let barOrder=0;
    const projectMap=new Map(projects.map(project=>[String(project.id),project]));
    const navigate=next=>{setAnchor(next);if(scroll.current)scroll.current.scrollLeft=0;};
    const goToday=()=>{
        navigate(today);
        requestAnimationFrame(()=>{
            const track=scroll.current, marker=track?.querySelector(".bold_timeline_day.is_today");
            if(track && marker){const label=track.querySelector(".bold_timeline_corner").getBoundingClientRect().width;track.scrollLeft=Math.max(0,track.scrollLeft+marker.getBoundingClientRect().left-track.getBoundingClientRect().left-label);}
        });
    };
    const rangeLabel=scale==="month" ? dateFromISO(window.start).toLocaleDateString("es",{month:"long",year:"numeric"}) : `${displayDate(window.start)} – ${displayDate(window.end)}`;
    const navigation=<div className="bold_timeline_navigation">
        {scale==="month" && <button type="button" onClick={goToday}>Hoy</button>}
        <button type="button" aria-label="Período anterior del cronograma" onClick={()=>navigate(shiftTimelinePeriod(window.start,scale,-1))}><ChevronLeft size={16}/></button>
        {scale==="month" ? <strong className="bold_timeline_month_label" aria-live="polite">{rangeLabel}</strong> : <button type="button" onClick={goToday}>Hoy</button>}
        <button type="button" aria-label="Período siguiente del cronograma" onClick={()=>navigate(shiftTimelinePeriod(window.start,scale,1))}><ChevronRight size={16}/></button>
    </div>;
    const projectFor=task=>projectMap.get(String(task.project_id || task.taskProjects?.[0]?.projectId));
    return <section className="bold_timeline" aria-label="Cronograma de tareas">
        <div className="bold_timeline_toolbar">
            {scale!=="month" && <div className="bold_timeline_period" aria-live="polite"><CalendarDays size={15} aria-hidden="true"/><strong>{rangeLabel}</strong></div>}
            <span className="bold_timeline_count">{visibleCount} de {datedCount} con fecha</span>
            <label className="bold_timeline_status"><span>Estado</span><select aria-label="Estado de tareas del cronograma" value={status} onChange={event=>setStatus(event.target.value)}><option value="all">Todos</option><option value="pending">Pendientes</option><option value="completed">Completadas</option></select></label>
            <label className="bold_timeline_scale"><span>Vista</span><select aria-label="Período del cronograma" value={scale} onChange={event=>{navigate(window.start);setScale(event.target.value);}}><option value="7">Semana</option><option value="14">2 semanas</option><option value="month">Mes</option></select></label>
            {scale==="month" && navigation}
        </div>
        {scale==="month" ? <TimelineMonth tasks={viewTasks} start={window.start} today={today} onSelect={onSelect}/> : <div ref={scroll} className="bold_timeline_scroll" role="region" aria-label="Cronograma por responsable, desplazable" tabIndex={0} style={{"--timeline-days":window.days.length}}>
            <div className="bold_timeline_grid">
                {todayIndex>=0 && rows.length>0 && <span key={`${scale}:${window.start}`} className="bold_timeline_today" aria-hidden="true" style={{left:`calc(var(--timeline-person) + (100% - var(--timeline-person)) * ${todayIndex/window.days.length})`}}/>}
                <div className="bold_timeline_header">
                    <div className="bold_timeline_corner"><span>Responsable</span>{navigation}</div>
                    <div className="bold_timeline_dates">{window.days.map(day=>{const date=dateFromISO(day),weekend=[0,6].includes(date.getDay());return <div key={day} className={`bold_timeline_day${day===today?" is_today":""}${weekend?" is_weekend":""}`} aria-current={day===today?"date":undefined}><span>{date.toLocaleDateString("es",{weekday:"short"})}</span><strong>{date.getDate()} <small>{date.toLocaleDateString("es",{month:"short"})}</small></strong></div>;})}</div>
                </div>
                {rows.map(row=><div className="bold_timeline_row" key={row.id} aria-label={`Tareas de ${row.name}`}>
                    <div className="bold_timeline_person"><div><strong title={row.name}>{row.name}</strong><small>{row.total} {row.total===1?"tarea":"tareas"}</small></div>{row.person && renderAvatar ? renderAvatar(row.person) : <span className="bold_timeline_empty_avatar"><UserRound size={16} aria-hidden="true"/></span>}</div>
                    <div className="bold_timeline_track" style={{height:`${row.lanes*48+24}px`}}>
                        {window.days.map((day,index)=>{const weekend=[0,6].includes(dateFromISO(day).getDay());return weekend || day===today ? <span key={day} className={`bold_timeline_day_shade${day===today?" is_today":""}`} aria-hidden="true" style={{left:`${index/window.days.length*100}%`,width:`${100/window.days.length}%`}}/> : null;})}
                        {!row.items.length && <span className="bold_timeline_row_empty">Sin tareas en este período</span>}
                        {row.items.map(item=>{
                            const project=projectFor(item.task), dates=item.range.start===item.range.end ? displayDate(item.range.start) : `${displayDate(item.range.start)} – ${displayDate(item.range.end)}`;
                            const description=`${item.task.title}. ${dates}. ${item.task.completed?"Completada":"Pendiente"}. Prioridad ${item.task.priority || "sin definir"}${project?`. ${project.label || project.name}`:""}`;
                            return <button key={`${scale}:${window.start}:${item.task.id}`} type="button" className={`bold_timeline_bar${item.task.completed?" is_completed":""}${item.clippedStart?" continues_before":""}${item.clippedEnd?" continues_after":""}`} style={{"--timeline-color":timelineTaskColor(item.task),"--bold-timeline-delay":`${200+Math.min(700,barOrder++*30)}ms`,left:`calc(${item.offset/window.days.length*100}% + 4px)`,width:`calc(${item.span/window.days.length*100}% - 8px)`,top:`${12+item.lane*48}px`}} aria-label={description} title={description} onClick={()=>onSelect(item.task.id)}>
                                {item.clippedStart && <ChevronLeft size={12} aria-hidden="true"/>}{item.task.completed && <Check size={12} aria-hidden="true"/>}<span>{item.task.title}</span>{item.clippedEnd && <ChevronRight size={12} aria-hidden="true"/>}
                            </button>;
                        })}
                    </div>
                </div>)}
                {!rows.length && <p className="bold_timeline_no_dates">Las tareas sin fecha se muestran debajo.</p>}
            </div>
        </div>}
        {!visibleCount && datedCount>0 && <div className="bold_timeline_empty_period"><span>No hay tareas en este período.</span><button type="button" onClick={()=>navigate(initialTimelineDay(viewTasks))}>Ir a la primera tarea</button></div>}
        {undated.length>0 && <details className="bold_timeline_undated" open><summary>{undated.some(item=>item.range.kind==="invalid") ? "Sin fecha o por revisar" : "Sin fecha"} <span>{undated.length}</span></summary><div>{undated.map(({task,range})=><button key={task.id} type="button" onClick={()=>onSelect(task.id)} title={range.kind==="invalid"?`Revisar fechas: ${range.start} – ${range.end}`:task.title}><CalendarDays size={13} aria-hidden="true"/><span>{task.title}</span><small>{range.kind==="invalid"?"Revisar fechas":"Sin fecha"}</small></button>)}</div></details>}
    </section>;
}
