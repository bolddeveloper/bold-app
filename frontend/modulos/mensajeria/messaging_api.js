import {http} from "../core/http_client.js";
import {createStagedMediaSender} from './staged_media.js';
import {createMediaDiscarder} from './discard_media.js';

const root = "/api/v2/messaging/conversations/";
const identity = value => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || "")) throw new Error("Identificador de conversación no válido.");
    return value;
};

// A proxy can return its private hostname in pagination. Keep only the exact
// authenticated collection path and cursor, never follow a third-party origin.
export function pagePath(collection, next) {
    if (!next) return collection;
    const url = new URL(next, "https://pagination.invalid");
    if (url.pathname !== collection || !url.searchParams.get("cursor")) throw new Error("Página de conversación no válida.");
    return `${collection}?${new URLSearchParams({cursor: url.searchParams.get("cursor")})}`;
}

export function createMessagingApi(client = http) {
    const messagesPath = conversation => `${root}${identity(conversation)}/messages/`;
    const sendMedia=createStagedMediaSender(client);
    const discard=createMediaDiscarder(client);
    return {
        preferences: options => client.request("/api/v2/messaging/preferences/", options),
        savePreferences: (enterBehavior, options) => client.request("/api/v2/messaging/preferences/", {...options, method: "PUT", body: {enter_behavior: enterBehavior}}),
        list: (next, options) => client.request(pagePath(root, next), options),
        open: (employee, options) => client.request(root, {...options, method: "POST", body: {employee_id: identity(employee)}}),
        detail: (conversation, options) => client.request(`${root}${identity(conversation)}/`, options),
        mentionPeople: (conversation, query, options) => {
            const term=typeof query==='string' ? query.trim():'';
            if(term.length<2 || term.length>80)throw new Error('Escribe entre 2 y 80 caracteres para buscar una persona.');
            return client.request(`${root}${identity(conversation)}/mention-people/?${new URLSearchParams({q:term})}`,options);
        },
        messages: (conversation, next, options) => client.request(pagePath(messagesPath(conversation), next), options),
        message:(conversation,message,options)=>client.request(`${messagesPath(conversation)}${identity(message)}/`,options),
        resolveIntent:async(conversation,clientId,options)=>{
            const value=await client.request(`${root}${identity(conversation)}/uploads/?${new URLSearchParams({client_id:identity(clientId)})}`,options);
            options?.signal?.throwIfAborted();
            if(!value.message_id)return null;
            const result=await client.request(`${messagesPath(conversation)}${identity(value.message_id)}/`,options);
            options?.signal?.throwIfAborted();
            if(result?.message?.id!==value.message_id || result.message.client_id!==clientId)throw Error('No se pudo verificar el mensaje reenviado. Conservamos su intento.');
            return result;
        },
        send: (conversation, body, clientId, options) => client.request(messagesPath(conversation), {...options, method: "POST", body: {body, client_id: clientId}}),
        sendMedia: (conversation,body,clientId,file,options)=>sendMedia('chat',identity(conversation),{body,client_id:clientId},file,options),
        discardMedia:(conversation,clientId,options)=>discard('chat',identity(conversation),clientId,options),
        media: (conversation, message, options) => client.request(`${messagesPath(conversation)}${identity(message)}/media/`, {...options, responseType: "blob"}),
        edit: (conversation, message, body, version, options) => client.request(`${messagesPath(conversation)}${identity(message)}/`, {...options, method: "PATCH", body: {body, version}}),
    };
}

export const messagingApi = createMessagingApi();
