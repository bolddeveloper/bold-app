import {dateFromISO,isMyTask} from "./services/task_models.js";

export function localDay(date) {
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}
function taskDay(value) {
    if(value==="undated")return value;
    return dateFromISO(value) ? value : null;
}
export function readTaskDay(key) {
    try{return taskDay(JSON.parse(globalThis.localStorage?.getItem(key) || "null"));}catch{return null;}
}
export function writeTaskDay(key,value) {
    try{globalThis.localStorage?.setItem(key,JSON.stringify(taskDay(value)));}catch{/* Keep filtering available when browser storage is disabled. */}
}
export function weekDays(date) {
    const start=new Date(date.getFullYear(),date.getMonth(),date.getDate());
    start.setDate(start.getDate()-(start.getDay()+6)%7);
    return Array.from({length:7},(_,index)=>{const day=new Date(start);day.setDate(day.getDate()+index);return day;});
}
export function dailyProgress(tasks, assignmentId, dates) {
    return dates.map(date=>{
        const key=localDay(date), seen=new Set();
        const rows=tasks.filter(task=>!task.parentTaskId && task.due_date===key && isMyTask(task,assignmentId) && !seen.has(task.id) && seen.add(task.id));
        const completed=rows.filter(task=>task.completed).length;
        return {date:key,total:rows.length,completed,percent:rows.length ? Math.round(completed/rows.length*100) : null};
    });
}
export function cardProgress(task) {
    const rows=task.pipeline_progress || [];
    const projects=rows.filter(row=>row.project);
    const candidates=task.pipelineContext ? projects.filter(row=>row.project===task.pipelineContext) : projects.length ? projects : rows.filter(row=>!row.project);
    return candidates.length===1 ? candidates[0] : {percent:null,label:candidates.length>1 ? "Varios flujos" : "Sin progreso disponible"};
}

