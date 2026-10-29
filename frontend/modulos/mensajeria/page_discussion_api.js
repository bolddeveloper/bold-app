import {http} from '../core/http_client.js';
import {channelPage} from './channel_api.js';
const id=value=>{if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || ''))throw Error('Identificador de comentario no válido.');return value;};
export function createDiscussionApi(client=http){
    const base=(channel,page)=>`/api/v2/messaging/channels/${id(channel)}/pages/${id(page)}/`;
    const threads=(channel,page)=>base(channel,page)+'discussions/';
    const write=(path,method,values,options)=>client.request(path,{...options,method,body:values,timeoutMs:15000});
    return {
        summary:(channel,page,options)=>client.request(threads(channel,page)+'summary/',options),
        list:(channel,page,state,block,next,options)=>{
            if(!['open','resolved','all'].includes(state))throw Error('Estado de comentarios no válido.');
            return client.request(channelPage(threads(channel,page),next,{state,...(block ? {block:id(block)}:{})}),options);
        },
        comments:(channel,page,thread,next,options)=>client.request(channelPage(threads(channel,page)+id(thread)+'/comments/',next),options),
        create:(channel,page,values,options)=>write(threads(channel,page),'POST',values,options),
        reply:(channel,page,thread,values,options)=>write(threads(channel,page)+id(thread)+'/comments/','POST',values,options),
        edit:(channel,page,comment,values,options)=>write(base(channel,page)+'discussion-comments/'+id(comment)+'/','PUT',values,options),
        remove:(channel,page,comment,values,options)=>write(base(channel,page)+'discussion-comments/'+id(comment)+'/delete/','POST',values,options),
        resolve:(channel,page,thread,values,options)=>write(threads(channel,page)+id(thread)+'/resolution/','PUT',values,options),
    };
}
export const discussionApi=createDiscussionApi();
export const commentOnlyDenial=error=>error?.status===403 && error.fields?.resource==='page_comments';
export function discussionError(error){
    const detail=[error?.fields?.detail,error?.fields?.body,error?.fields?.non_field_errors].flat().find(value=>typeof value==='string' && value.length<600);
    return detail || ([401,403,404].includes(error?.status) ? 'Los comentarios ya no están disponibles con tus permisos actuales.':error?.status===429 ? 'Espera antes de reintentar. Conservamos tu comentario.':'No se pudo confirmar la operación. Reintenta el mismo intento sin duplicarlo.');
}
