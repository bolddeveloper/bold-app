import {http} from "../core/http_client.js";
import {channelPage} from "./channel_api.js";
const id=value=>{if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || ""))throw Error("Identificador no válido.");return value;};
const templateId=value=>/^builtin-(meeting|brief|weekly|process|delivery|handoff)$/.test(value || "") ? value:id(value);
export function createTemplateApi(client=http){
    const collection=channel=>`/api/v2/messaging/channels/${id(channel)}/templates/`,detail=(channel,template)=>collection(channel)+templateId(template)+"/";
    return {
        list:(channel,archived,next,options)=>client.request(channelPage(collection(channel),next,archived ? {archived:"true"}:{}),options),
        get:(channel,template,options)=>client.request(detail(channel,template),options),
        capture:(channel,values,options)=>client.request(collection(channel),{...options,method:"POST",body:values,timeoutMs:15000}),
        replace:(channel,template,values,options)=>client.request(detail(channel,template),{...options,method:"PUT",body:values,timeoutMs:15000}),
        update:(channel,template,values,options)=>client.request(detail(channel,template),{...options,method:"PATCH",body:values,timeoutMs:15000}),
        instantiate:(channel,template,token,options)=>client.request(detail(channel,template)+"pages/",{...options,method:"POST",body:{client_id:id(token)},timeoutMs:15000}),
    };
}
export const templateApi=createTemplateApi();
