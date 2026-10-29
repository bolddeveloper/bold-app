import {http} from "../core/http_client.js";

const root="/api/v2/messaging/",uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id=value=>{if(!uuid.test(value || ""))throw Error("La referencia de búsqueda no es válida.");return value;};
const fields=new Set(["q","scope","kind","channel","conversation","author","after","before","archived","saved","threads","marked_unread"]);

export function historyPath(filters,cursor){
    const params=new URLSearchParams();
    for(const [key,value] of Object.entries(filters)){
        if(!fields.has(key))throw Error("Filtro de búsqueda desconocido.");
        if(value!=="" && value!=null)params.set(key,String(value));
    }
    if(cursor){if(typeof cursor!=="string" || cursor.length>4096)throw Error("Página de resultados no válida.");params.set("cursor",cursor);}
    return root+"search/?"+params;
}

// Date controls use the viewer's local midnight, not an implicit UTC date that
// silently excludes the evening. The upper boundary is exclusive next midnight.
export function historyDates(from,to){
    const parse=value=>{
        if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error("La fecha no es válida.");
        const date=new Date(value+"T00:00:00");
        if(!Number.isFinite(+date) || date.getFullYear()!==Number(value.slice(0,4)) || date.getMonth()+1!==Number(value.slice(5,7)) || date.getDate()!==Number(value.slice(8,10)))throw Error("La fecha no es válida.");
        return date;
    };
    const after=from ? parse(from):null,before=to ? parse(to):null;
    if(before)before.setDate(before.getDate()+1);
    if(after && before && after>=before)throw Error("La fecha final no puede ser anterior a la inicial.");
    return {...(after ? {after:after.toISOString()}:{}),...(before ? {before:before.toISOString()}: {})};
}

export function createHistoryApi(client=http){return {
    search:(filters,cursor,options)=>client.request(historyPath(filters,cursor),options),
    save:(kind,source,options)=>{
        if(!["chat","channel","page"].includes(kind))throw Error("Tipo de guardado no válido.");
        return client.request(root+"saved-items/",{...options,method:"PUT",body:{kind,source_id:id(source)}});
    },
    unsave:(document,options)=>client.request(root+"saved-items/"+id(document)+"/",{...options,method:"DELETE"}),
    context:(target,options)=>{
        if(target.kind==="page")return client.request(`${root}channels/${id(target.channel_id)}/pages/${id(target.page_id)}/`,options);
        if(target.kind==="chat")return client.request(`${root}conversations/${id(target.conversation_id)}/messages/${id(target.message_id)}/context/`,options);
        if(target.kind==="channel")return client.request(`${root}channels/${id(target.channel_id)}/messages/${id(target.message_id)}/context/`,options);
        throw Error("Este resultado no tiene un contexto admitido.");
    },
};}
export const historyApi=createHistoryApi();

export function historyError(error){
    if([401,403,404].includes(error?.status))return "El resultado ya no está disponible con tus permisos actuales. Vuelve a buscar.";
    if(error?.status===429)return "Se alcanzó el límite de búsqueda. Espera un minuto antes de volver a intentarlo.";
    const fields=error?.fields;
    return [fields?.detail,fields?.q,fields?.non_field_errors].flat().find(value=>typeof value==="string" && value.length<500) || "No se pudo completar la búsqueda. Conservamos los filtros para que puedas reintentar.";
}

export function savedError(error){
    if([401,403,404].includes(error?.status))return "Esta referencia ya no está disponible con tus permisos actuales.";
    if(error?.status===429)return "Demasiadas acciones seguidas. El cambio no está confirmado; espera antes de reintentar.";
    const detail=error?.fields?.detail;
    return typeof detail==="string" && detail.length<500 ? detail:"No se pudo confirmar el cambio en tus guardados. Puedes reintentar sin duplicar la referencia.";
}
