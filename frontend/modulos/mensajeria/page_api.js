import {http,api_base_url} from "../core/http_client.js";
import {channelPage} from "./channel_api.js";
const uuid = value => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || "")) throw Error("Identificador de página no válido.");
    return value;
};
export function createPageApi(client=http) {
    const list=channel=>`/api/v2/messaging/channels/${uuid(channel)}/pages/`;
    const detail=(channel,page)=>`${list(channel)}${uuid(page)}/`;
    return {
        list:(channel,archived,next,options)=>client.request(channelPage(list(channel),next,archived ? {archived:"true"}:{}),options),
        branch:(channel,parent,archived,next,options)=>client.request(channelPage(list(channel),next,{parent:parent ? uuid(parent):"root",...(archived ? {archived:"true"}:{})}),options),
        structure:(channel,page,options)=>client.request(detail(channel,page)+"structure/",options),
        move:(channel,page,values,options)=>client.request(detail(channel,page)+"structure/",{...options,method:"PUT",body:values,timeoutMs:15000}),
        parents:(channel,page,query,next,options)=>{
            if(typeof query!=="string" || query.trim().length>80)throw Error('La búsqueda admite hasta 80 caracteres.');
            return client.request(channelPage(detail(channel,page)+"parent-options/",next,query.trim() ? {q:query.trim()}:{}),options);
        },
        get:(channel,page,options)=>client.request(detail(channel,page),options),
        linkOptions:(channel,page,query,next,options)=>{
            if(typeof query!=='string' || query.trim().length>80)throw Error('La búsqueda admite hasta 80 caracteres.');
            return client.request(channelPage(detail(channel,page)+'link-options/',next,query.trim() ? {q:query.trim()}:{}),options);
        },
        backlinks:(channel,page,next,options)=>client.request(channelPage(detail(channel,page)+'backlinks/',next),options),
        mentionPeople:(channel,page,query,options)=>{
            const term=typeof query==='string' ? query.trim():'';
            if(term.length<2 || term.length>80)throw Error('Escribe entre 2 y 80 caracteres para buscar una persona.');
            return client.request(`${detail(channel,page)}mention-people/?${new URLSearchParams({q:term})}`,options);
        },
        ticket:(channel,page,options)=>client.request(detail(channel,page)+"ticket/",{...options,method:"POST",body:{},timeoutMs:15000}),
        create:(channel,values,options)=>client.request(list(channel),{...options,method:"POST",body:values,timeoutMs:15_000}),
        save:(channel,page,values,options)=>client.request(detail(channel,page),{...options,method:"PUT",body:values,timeoutMs:15_000}),
        action:(channel,page,values,options)=>client.request(detail(channel,page),{...options,method:"PATCH",body:values,timeoutMs:15_000}),
        history:(channel,page,next,options)=>client.request(channelPage(detail(channel,page)+"history/",next),options),
        revision:(channel,page,version,options)=>{
            if(!Number.isSafeInteger(version) || version<1)throw Error("Versión no válida.");
            return client.request(`${detail(channel,page)}history/${version}/`,options);
        },
    };
}
export const pageApi=createPageApi();
export async function connectPage(channel,page,options){
    const result=await pageApi.ticket(channel,page,options),url=new URL(api_base_url);
    url.protocol=url.protocol==="https:" ? "wss:":"ws:";url.pathname=`/ws/pages/${uuid(page)}/`;url.search="";url.hash="";url.searchParams.set("ticket",result.ticket);
    if(options?.signal?.aborted)throw new DOMException("Contexto cancelado","AbortError");
    return new WebSocket(url.href);
}

export function pageError(error) {
    if ([401,403,404].includes(error?.status)) return "La página ya no está disponible con tus permisos actuales.";
    const detail=[error?.fields?.detail,error?.fields?.title,error?.fields?.blocks,error?.fields?.parent_id,error?.fields?.non_field_errors].flat().find(value=>typeof value==="string" && value.length<600);
    return detail || (error?.status===429 ? "Espera antes de reintentar. Tu borrador sigue aquí." : "No se pudo confirmar el guardado. Conservamos tu borrador; reintenta para comprobarlo sin duplicar versiones.");
}
