import {useEffect,useState,useRef} from "react";
import {ChevronLeft,ChevronRight,MessageCircle,Paperclip,ListChecks,X,Plus,MoreHorizontal,Pencil,Trash2} from "lucide-react";
import {useAnchoredPopover} from "../../core/shared/use_anchored_popover.js";
import {cardProgress,dailyProgress,localDay,weekDays} from "./task_progress.js";

export function DailyTaskProgress({tasks,assignmentId,value,onChange}) {
    const [week,setWeek]=useState(()=>new Date());
    useEffect(()=>{
        if(value && value!=="undated")setWeek(current=>weekDays(current).some(day=>localDay(day)===value) ? current : new Date(`${value}T12:00:00`));
    },[value]);
    const dates=weekDays(week), rows=dailyProgress(tasks,assignmentId,dates), today=localDay(new Date());
    const move=days=>setWeek(current=>{const next=new Date(current);next.setDate(next.getDate()+days);return next;});
    const range=`${dates[0].toLocaleDateString("es",{day:"numeric",month:"short"})} – ${dates[6].toLocaleDateString("es",{day:"numeric",month:"short",year:"numeric"})}`;
    return <nav className="bold_daily" aria-label="Progreso de tareas por fecha límite">
        <div className="bold_daily_heading"><span>{range}<small>Por fecha límite</small></span><div className="bold_daily_actions">
            <button type="button" aria-label="Semana anterior" onClick={()=>move(-7)}><ChevronLeft size={16} aria-hidden="true"/></button>
            <button type="button" onClick={()=>{setWeek(new Date());onChange(today);}}>Hoy</button>
            <button type="button" aria-label="Semana siguiente" onClick={()=>move(7)}><ChevronRight size={16} aria-hidden="true"/></button>
        </div></div>
        <div className="bold_daily_controls"><div className="bold_daily_days">{rows.map((row,index)=><button type="button" key={row.date} aria-pressed={value===row.date} aria-current={row.date===today ? "date" : undefined} onClick={()=>onChange(row.date)} title={`${row.completed} de ${row.total} tareas completadas`} aria-label={`${dates[index].toLocaleDateString("es",{weekday:"long",day:"numeric",month:"long"})}: ${row.total ? `${row.percent}% completado` : "Sin tareas"}`}>
            <span>{dates[index].toLocaleDateString("es",{weekday:"short"})}</span><span className={`bold_daily_ring${row.percent===null ? " is_empty" : ""}`} style={{"--progress":row.percent||0}}><span>{row.percent===null ? "—" : `${row.percent}%`}</span></span><strong>{dates[index].getDate()}</strong>
        </button>)}</div><div className="bold_daily_filters">
            <button type="button" aria-pressed={value===null} onClick={()=>onChange(null)}>Todas</button><button type="button" aria-pressed={value==="undated"} onClick={()=>onChange("undated")}>Sin fecha</button>
        </div></div>
    </nav>;
}
export function TaskSubtaskCount({task}) {
    const subtasks = task.subtasks || [];
    if (!subtasks.length) return null;
    const completed = subtasks.filter(row => row.completed).length;
    return <span className="bold_subtask_count" aria-label={`${completed} de ${subtasks.length} subtareas completadas`}><ListChecks size={14} aria-hidden="true"/>{completed}/{subtasks.length}</span>;
}
export function TaskCardProgress({task,children,showSubtasks=true}) {
    const progress=cardProgress(task), subtasks=task.subtasks || [];
    if(progress.percent===null && !(showSubtasks && subtasks.length) && !children)return null;
    return <div className="bold_card_progress">
        {progress.percent!==null ? <span className="bold_progress_value" role="progressbar" aria-label={`Progreso de etapa: ${progress.label}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent} title={progress.label}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle className="bold_progress_arc" cx="12" cy="12" r="9" pathLength="100" strokeDasharray="100" strokeDashoffset={100-progress.percent}/></svg><span>{progress.percent}%</span>
        </span> : children && <span className="bold_progress_empty">{progress.label==="Sin progreso disponible" ? "Sin etapa" : progress.label}</span>}
        {showSubtasks && <TaskSubtaskCount task={task}/>}
        {children && <span className="bold_progress_person">{children}</span>}
    </div>;
}
export function TaskQuickComposer({label,value,onChange,onSave,onCancel,className=""}) {
    return <form className={`bold_task_composer ${className}`} onSubmit={event=>{event.preventDefault();if(value.trim())onSave();}}>
        <textarea autoFocus rows="1" aria-label={label} placeholder="Nombre de tarea…" title="Escribe una tarea o pega varias líneas" value={value} onChange={event=>onChange(event.target.value)} onKeyDown={event=>{
            if(event.key==="Escape"){event.preventDefault();event.stopPropagation();onCancel();}
            else if(event.key==="Enter" && !event.shiftKey && !event.nativeEvent.isComposing){event.preventDefault();event.currentTarget.form.requestSubmit();}
        }}/>
        <button type="submit" aria-label="Agregar tareas" disabled={!value.trim()}><Plus size={16} aria-hidden="true"/></button>
        <button type="button" aria-label="Cancelar nuevas tareas" onClick={onCancel}><X size={16} aria-hidden="true"/></button>
    </form>;
}

export function TaskListDetails({task,showTags=true,showActivity=true}) {
    const tags=task.tags || [], comments=task.comments?.length, attachments=task.attachmentCount ?? task.attachments?.length;
    if(!(showTags && tags.length) && !(showActivity && (comments || attachments)))return null;
    return <div className="bold_task_details">
        {showTags && tags.slice(0,2).map((tag,index)=><span className="bold_task_tag" key={`${tag}:${index}`}>{tag}</span>)}
        {showTags && tags.length>2 && <span title={tags.slice(2).join(", ")}>+{tags.length-2}</span>}
        {showActivity && comments>0 && <span aria-label={`${comments} comentarios`}><MessageCircle size={12}/>{comments}</span>}
        {showActivity && attachments>0 && <span aria-label={`${attachments} archivos adjuntos`}><Paperclip size={12}/>{attachments}</span>}
    </div>;
}

export function TaskActionsMenu({label,section=false,onEdit,onDelete}) {
    const [open,setOpen]=useState(false),anchor=useRef(null),panel=useRef(null);
    useAnchoredPopover(open,anchor,panel,{minWidth:176,maxHeight:160});
    return <span className="bold_section_actions" onClick={event=>event.stopPropagation()} onKeyDown={event=>event.stopPropagation()}>
        <button ref={anchor} type="button" aria-label={`Opciones de ${section ? "sección" : "tarea"} ${label}`} aria-expanded={open} onClick={()=>setOpen(value=>!value)}><MoreHorizontal size={16} aria-hidden="true"/></button>
        {open && <div ref={panel} popover="auto" className="bold_section_menu" role="group" aria-label={`Opciones de ${label}`} onToggle={event=>{if(event.newState==="closed")setOpen(false);}} onKeyDown={event=>{if(event.key==="Escape"){event.preventDefault();setOpen(false);anchor.current?.focus({preventScroll:true});}}}>
            <button type="button" onClick={()=>{setOpen(false);onEdit();}}><Pencil size={14} aria-hidden="true"/>{section ? "Renombrar sección" : "Editar tarea"}</button>
            <button type="button" className="bold_section_delete" onClick={()=>{setOpen(false);onDelete();}}><Trash2 size={14} aria-hidden="true"/>{section ? "Eliminar sección" : "Eliminar tarea"}</button>
        </div>}
    </span>;
}
