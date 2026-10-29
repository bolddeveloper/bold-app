import {http} from '../core/http_client.js';
import {historyDates} from './history_api.js';
import {DOCUMENT_MIMES} from './document_files.js';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fields=new Set(['q','kind','author','after','before','parent']);
const id=value=>{if(!uuid.test(value || ''))throw Error('La referencia del recurso no es válida.');return value;};
const collection=(kind,container)=>{
    if(!['chat','channel'].includes(kind))throw Error('Biblioteca no válida.');
    return `/api/v2/messaging/${kind==='chat' ? 'conversations':'channels'}/${id(container)}/`;
};

export function resourcePath(kind,container,filters={},cursor=null){
    const params=new URLSearchParams();
    for(const [key,value] of Object.entries(filters)){
        if(!fields.has(key))throw Error('Filtro de biblioteca desconocido.');
        if(value!=='' && value!=null)params.set(key,String(value));
    }
    if(cursor){if(typeof cursor!=='string' || cursor.length>4096)throw Error('Página de recursos no válida.');params.set('cursor',cursor);}
    return collection(kind,container)+'library/?'+params;
}
export function resourceFilters({from='',to='',...filters}){return {...filters,...historyDates(from,to)};}
export function resourceHref(value){
    if(typeof value!=='string' || value.length>5008 || /[\s\p{C}\\]/u.test(value))return null;
    try{const url=new URL(value);return ['http:','https:'].includes(url.protocol) && url.hostname && !url.username && !url.password ? url.href:null;}catch{return null;}
}
export function mediaDownloadName(media){
    const extension={'image/webp':'webp','image/png':'png','image/jpeg':'jpg','audio/webm':'webm','audio/ogg':'ogg','audio/mp4':'m4a',...Object.fromEntries(Object.entries(DOCUMENT_MIMES).map(([ext,mime])=>[mime,ext]))}[media?.mime_type];
    if(!extension)throw Error('Formato de descarga no admitido.');
    const base=(media.filename || `bold-${media.kind}`).replace(/\.[^.]*$/,'').replace(/[\p{C}<>:"/\\|?*]/gu,'').replace(/^[. ]+|[. ]+$/g,'').slice(0,150) || 'bold-archivo';
    return base+'.'+extension;
}
export function resourceHint(kind,container,event){
    const envelope=event?.detail,payload=envelope?.payload || {};
    if(kind==='channel')return payload.channel_id===container && ['message.created','message.updated','channel.updated','channel.access_changed'].includes(payload.kind);
    return kind==='chat' && (payload.conversation_id===container && ['messaging.message.created','messaging.message.updated'].includes(envelope?.event_type) || envelope?.event_type==='messaging.sync');
}
export function createResourceApi(client=http){return {
    list:(kind,container,filters,cursor,options)=>client.request(resourcePath(kind,container,filters,cursor),options),
    media:(kind,container,message,options)=>client.request(collection(kind,container)+`messages/${id(message)}/media/`,{...options,responseType:'blob'}),
};}
export const resourceApi=createResourceApi();
