import {CheckSquare,Square} from "lucide-react";
import {linkParts} from "./messaging_models.js";
export function PageText({value}){return linkParts(value || "").map((part,i)=>part.href ? <a key={i} href={part.href} target="_blank" rel="noopener noreferrer">{part.text}</a>:part.text);}
export function ReadBlocks({blocks,onTask}){
    return <div className="slack_page_read">{blocks.map(row=>{
        if(row.type==="task")return row.task?.available ? <button type="button" className="slack_task_card" key={row.id} onClick={()=>onTask?.(row.task)}><CheckSquare size={18} aria-hidden="true"/>{row.task.title}<small>{row.task.status}</small></button>:<p key={row.id}>Tarea no disponible para tu asignación activa.</p>;
        const content=<PageText value={row.text}/>;
        if(row.type==="heading"){const Heading=`h${row.level || 2}`;return <Heading key={row.id}>{content}</Heading>;}
        if(row.type==="check"){const Mark=row.checked ? CheckSquare:Square;return <p key={row.id}><Mark size={18} aria-label={row.checked ? "Completado":"Pendiente"}/> {content}</p>;}
        if(row.type==="bullet")return <ul key={row.id}><li>{content}</li></ul>;
        return <p key={row.id}>{content || <br/>}</p>;
    })}</div>;
}
