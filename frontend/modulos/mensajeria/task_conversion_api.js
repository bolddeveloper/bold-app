import {http} from '../core/http_client.js';
const root='/api/v2/messaging/',uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isTaskReference=value=>uuid.test(value || '');
const id=value=>{if(!isTaskReference(value))throw Error('Referencia de mensaje o tarea no válida.');return value;};
const collection=(kind,container,message)=>{
    if(!['chat','channel'].includes(kind))throw Error('Selecciona un mensaje de Chat o Slack.');
    return `${root}${kind==='chat' ? 'conversations':'channels'}/${id(container)}/messages/${id(message)}/tasks/`;
};
function page(path,next,filters={}){
    const params=new URLSearchParams(filters);
    if(next){const url=new URL(next,'https://pagination.invalid');if(url.pathname!==path || !url.searchParams.get('cursor'))throw Error('La página no pertenece a esta lista.');
        if((url.searchParams.get('q') || '')!==(params.get('q') || ''))throw Error('La página pertenece a otra búsqueda.');params.set('cursor',url.searchParams.get('cursor'));}
    return path+(params.size ? '?'+params:'');
}
export function createTaskConversionApi(client=http){return {
    links:(kind,container,message,next,options)=>client.request(page(collection(kind,container,message),next),options),
    projects:(q='',next,options)=>{if(q.length>120)throw Error('Busca con hasta 120 caracteres.');return client.request(page(root+'task-conversion-projects/',next,{q}),options);},
    project:(project,options)=>client.request(root+'task-conversion-projects/'+id(project)+'/',options),
    create:(kind,container,message,attempt,options)=>client.request(collection(kind,container,message),{...options,method:'POST',body:attempt}),
    origins:(task,options)=>client.request(`/api/v2/tasks/${id(task)}/message-origins/`,options),
    task:(task,options)=>client.request(`/api/v2/tasks/${id(task)}/`,options),
};}
export const taskConversionApi=createTaskConversionApi();
export function conversionError(err){
    const fields=err?.fields,detail=[fields?.detail,fields?.project,fields?.section,fields?.status,fields?.assignee_assignment,fields?.due_date,fields?.share_confirmed,fields?.non_field_errors].flat().find(value=>typeof value==='string' && value.length<600);
    if(detail)return detail;
    if([401,403,404].includes(err?.status))return 'El mensaje, proyecto o tarea no están disponibles con tus permisos actuales.';
    if(err?.status===409)return 'Cambió el mensaje o este intento. Conservamos la revisión; comprueba su origen antes de volver a crear.';
    return 'No se pudo confirmar la creación. Conservamos el intento para comprobarlo sin duplicar la tarea.';
}
