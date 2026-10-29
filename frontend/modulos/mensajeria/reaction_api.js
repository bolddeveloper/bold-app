import {http} from '../core/http_client.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id=value=>{if(!uuid.test(value || ''))throw Error('Referencia de reacción no válida.');return value;};
const route=(kind,container,message)=>{
    if(!['chat','channel'].includes(kind))throw Error('Solo se reacciona a mensajes.');
    return `/api/v2/messaging/${kind==='chat' ? 'conversations':'channels'}/${id(container)}/messages/${id(message)}/reactions/`;
};
export function createReactionApi(client=http){return {
    state:(kind,container,message,options)=>client.request(route(kind,container,message),options),
    set:(kind,container,message,attempt,options)=>{
        if(typeof attempt.active!=='boolean' || !/^[a-z_]{1,24}$/.test(attempt.key) || !Number.isSafeInteger(attempt.version) || attempt.version<0)throw Error('Reacción no válida.');
        return client.request(route(kind,container,message),{...options,method:'PUT',body:{key:attempt.key,active:attempt.active,version:attempt.version,client_id:id(attempt.client_id)}});
    },
};}
export const reactionApi=createReactionApi();
export function reactionError(err){
    if([401,403,404].includes(err?.status))return 'El mensaje no permite modificar reacciones con tus permisos actuales.';
    if(err?.status===409)return 'Tus reacciones cambiaron en otra ventana. Revisa el estado actualizado y vuelve a elegir.';
    const detail=err?.fields?.detail;
    return typeof detail==='string' && detail.length<500 ? detail:'No se pudo confirmar la reacción. Reintenta para comprobarla sin duplicarla.';
}
