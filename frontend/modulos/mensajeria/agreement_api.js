import {http} from '../core/http_client.js';
const root='/api/v2/messaging/',pattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const agreementId=value=>typeof value==='string' && pattern.test(value);
const id=value=>{if(!agreementId(value))throw Error('Referencia de acuerdo no válida.');return value;};
function source(kind,container){if(!['chat','channel'].includes(kind))throw Error('Origen de acuerdos no válido.');return `${root}${kind==='chat' ? 'conversations':'channels'}/${id(container)}/`;}
export function createAgreementApi(client=http){return {
    review:(kind,container,identities,options)=>{if(!Array.isArray(identities) || !identities.length || identities.length>20 || new Set(identities).size!==identities.length)throw Error('Selecciona entre uno y veinte mensajes distintos.');return client.request(source(kind,container)+'agreement-review/?'+new URLSearchParams({message_ids:identities.map(id).join(',')}),options);},
    destinations:(q='',next,options)=>{if(q.length>80)throw Error('Busca con hasta 80 caracteres.');const path=root+'agreement-destinations/',params=new URLSearchParams({q});
        if(next){const url=new URL(next,'https://pagination.invalid');if(url.pathname!==path || !url.searchParams.get('cursor') || (url.searchParams.get('q') || '')!==q)throw Error('El cursor no pertenece a esta búsqueda.');params.set('cursor',url.searchParams.get('cursor'));}return client.request(path+'?'+params,options);},
    destination:(channel,options)=>client.request(root+'agreement-destinations/'+id(channel)+'/',options),
    create:(kind,container,attempt,options)=>client.request(source(kind,container)+'agreements/',{...options,method:'POST',body:attempt}),
};}
export const agreementApi=createAgreementApi();
export function agreementError(err){
    const detail=[err?.fields?.detail,err?.fields?.title,err?.fields?.entries,err?.fields?.non_field_errors].flat().find(value=>typeof value==='string' && value.length<600);
    if(detail)return detail;
    if([401,403,404].includes(err?.status))return 'La selección o el canal de destino ya no están disponibles con tus permisos actuales.';
    if(err?.status===409)return 'Cambió el origen o este intento. Conservamos la revisión; actualiza las fuentes antes de confirmar de nuevo.';
    return 'No se pudo confirmar la creación. Conservamos el intento para reintentar sin duplicar la página.';
}
