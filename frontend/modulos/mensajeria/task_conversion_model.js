import {isTaskReference} from './task_conversion_api.js';
const priorities=['Alta','Media','Baja'],references=['project','section','assignee_assignment','status'];
export const initialTaskReview=()=>({project:'',section:'',section_chosen:false,assignee_assignment:'',due_date:'',status:'',priority:'Media',title:'',description:'',confirmed:false,touched:false,source_version:null});
export const taskMessageTitle=text=>(text || 'Nueva tarea desde mensaje').trim().slice(0,220).replace(/[\uD800-\uDBFF]$/,'');
export function conversionSection(sections,saved){
    const wanted=saved==='unsectioned' ? null:saved;
    return (saved && sections.some(row=>row.id===wanted) ? wanted:sections[0]?.id) || '';
}
export function taskAttempt(form,clientId=crypto.randomUUID()){
    if(!isTaskReference(form.project) || !form.confirmed || !form.title.trim() || !Number.isSafeInteger(form.source_version) || form.source_version<1)throw Error('Revisa el texto, el proyecto y la confirmación antes de crear la tarea.');
    return {client_id:clientId,source_version:form.source_version,project:form.project,section:form.section || null,
        assignee_assignment:form.assignee_assignment || null,due_date:form.due_date || null,status:form.status || null,
        title:form.title.trim(),description:form.description,priority:form.priority,share_confirmed:true};
}
export const taskDraft=(form,attempt)=>form.touched || attempt ? {payload:{version:1,purpose:'message-task',form,attempt},files:[]}:null;
export function restoreTaskReview(payload,files=[]){
    if(payload?.version!==1 || payload.purpose!=='message-task' || files.length || !payload.form || typeof payload.form!=='object')throw Error('La revisión de tarea conservada no es válida.');
    const form={...initialTaskReview(),...payload.form},known=new Set(Object.keys(initialTaskReview()));
    if(Object.keys(payload.form).some(key=>!known.has(key)) || references.some(key=>typeof form[key]!=='string' || form[key] && !isTaskReference(form[key])) ||
        typeof form.title!=='string' || form.title.length>220 || typeof form.description!=='string' || form.description.length>10000 ||
        !priorities.includes(form.priority) || typeof form.due_date!=='string' || form.due_date && !/^\d{4}-\d{2}-\d{2}$/.test(form.due_date) ||
        typeof form.touched!=='boolean' || typeof form.section_chosen!=='boolean' || typeof form.confirmed!=='boolean' || !Number.isSafeInteger(form.source_version) || form.source_version<1)throw Error('La revisión de tarea conservada no está completa.');
    const attempt=payload.attempt;
    if(attempt){
        if(!isTaskReference(attempt.client_id))throw Error('El intento conservado no tiene un identificador válido.');
        const rebuilt=taskAttempt({...form,confirmed:true},attempt.client_id);
        if(JSON.stringify(Object.entries(rebuilt).sort())!==JSON.stringify(Object.entries(attempt).sort()))throw Error('El intento de tarea no coincide con el texto aprobado.');
    }
    return {form:{...form,confirmed:false},attempt:attempt || null};
}
