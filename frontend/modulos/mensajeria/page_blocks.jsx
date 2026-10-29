import {CheckSquare,Square,FileText} from "lucide-react";
import MentionText from "./mention_text.jsx";
import {RichPageText,CodeBlock} from './page_rich_text.jsx';
export function PageText({value,mentions}){return <MentionText text={value || ''} mentions={mentions}/>;}
export function ReadBlocks({blocks,onTask,onPage,mentions,renderComment}){
    const renderBlock=row=>{
        if(row.type==="task")return row.task?.available ? <button type="button" className="slack_task_card" key={row.id} onClick={()=>onTask?.(row.task)}><CheckSquare size={18} aria-hidden="true"/>{row.task.title}<small>{row.task.status}</small></button>:<p key={row.id}>Tarea no disponible para tu asignación activa.</p>;
        if(row.type==='page'){
            if(!row.page?.available)return <p key={row.id} data-page-block={row.id} tabIndex={-1}>{row.page_id ? 'Enlace pendiente de validar.':'Página no disponible para tu asignación activa.'}</p>;
            const content=<><FileText size={18} aria-hidden="true"/><span><strong>{row.text || row.page.title}</strong><small>{row.page.channel_name}{row.page.archived ? ' · Página archivada':''}{row.page.channel_archived ? ' · Canal archivado':''}</small></span></>;
            return onPage ? <button type="button" className="slack_task_card slack_page_link" key={row.id} data-page-block={row.id} onClick={()=>onPage({kind:'page',channel_id:row.page.channel_id,page_id:row.page.id})}>{content}</button>:<div className="slack_task_card slack_page_link" key={row.id} data-page-block={row.id} tabIndex={-1}>{content}</div>;
        }
        if(row.type==='code')return <CodeBlock key={row.id} row={row}/>;
        const content=<RichPageText text={row.text} formats={row.formats} mentions={mentions}/>;
        if(row.type==="heading"){const Heading=`h${row.level || 2}`;return <Heading key={row.id} tabIndex={-1} data-page-block={row.id}>{content}</Heading>;}
        if(row.type==="check"){const Mark=row.checked ? CheckSquare:Square;return <p key={row.id} tabIndex={-1} data-page-block={row.id}><Mark size={18} aria-label={row.checked ? "Completado":"Pendiente"}/> {content}</p>;}
        if(row.type==="bullet")return <ul key={row.id} tabIndex={-1} data-page-block={row.id}><li>{content}</li></ul>;
        return <p key={row.id} tabIndex={-1} data-page-block={row.id}>{content || <br/>}</p>;
    };
    return <div className="slack_page_read">{blocks.map((row,index)=>renderComment ? <div key={row.id} className="slack_read_comment_block">{renderBlock(row)}<div className="slack_read_comment_control">{renderComment(row,index)}</div></div>:renderBlock(row))}</div>;
}
