import {http} from '../core/http_client.js';
const root='/api/v2/messaging/reading-reminders/',uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id=value=>{if(!uuid.test(value || ''))throw Error('La referencia de lectura no es válida.');return value;};
const source=(kind,sourceId)=>{if(!['chat','channel'].includes(kind))throw Error('Solo se marcan mensajes de Chat, canales e hilos.');return {kind,source_id:id(sourceId)};};
const change=value=>{if(!Number.isSafeInteger(value.version) || value.version<0)throw Error('La versión de lectura no es válida.');return {version:value.version,client_id:id(value.client_id)};};
export function createReadingApi(client=http){return {
    state:(kind,sourceId,options)=>client.request(root+'?'+new URLSearchParams(source(kind,sourceId)),options),
    mark:(kind,sourceId,attempt,options)=>client.request(root,{...options,method:'PUT',body:{...source(kind,sourceId),...change(attempt)}}),
    clear:(reminder,attempt,options)=>client.request(root+id(reminder)+'/',{...options,method:'PUT',body:change(attempt)}),
    recover:options=>client.request('/api/v2/messaging/unread/',options),
};}
export const readingApi=createReadingApi();
export function applyReadingResult(result){
    if(result?.reading)window.dispatchEvent(new CustomEvent('bold:messaging-event',{
        detail:{event_version:2,event_type:'messaging.reminder.changed',payload:{reading:result.reading}}}));
}
export function readingError(error){
    if([401,403,404].includes(error?.status))return 'El mensaje ya no está disponible con tus permisos actuales.';
    if(error?.status===409)return 'La marca cambió en otro dispositivo. Hemos actualizado su estado; vuelve a elegir la acción.';
    if(error?.status===429)return 'Demasiadas acciones seguidas. La marca no está confirmada; espera antes de reintentar.';
    const detail=error?.fields?.detail;
    return typeof detail==='string' && detail.length<500 ? detail:'No se pudo confirmar la marca de lectura. Puedes reintentar sin duplicar el cambio.';
}
