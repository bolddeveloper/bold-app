import {http} from "../core/http_client.js";
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
        get:(channel,page,options)=>client.request(detail(channel,page),options),
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

export function pageError(error) {
    if ([401,403,404].includes(error?.status)) return "La página ya no está disponible con tus permisos actuales.";
    const detail=[error?.fields?.detail,error?.fields?.title,error?.fields?.blocks,error?.fields?.non_field_errors].flat().find(value=>typeof value==="string" && value.length<600);
    return detail || (error?.status===429 ? "Espera antes de reintentar. Tu borrador sigue aquí." : "No se pudo confirmar el guardado. Conservamos tu borrador; reintenta para comprobarlo sin duplicar versiones.");
}
