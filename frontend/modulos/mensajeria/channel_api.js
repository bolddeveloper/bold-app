import {http} from "../core/http_client.js";
import {newestReactions} from './reaction_model.js';
import {createStagedMediaSender} from './staged_media.js';
import {createMediaDiscarder} from './discard_media.js';

const root = "/api/v2/messaging/channels/";
const id = value => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || "")) throw Error("Identificador de canal no válido.");
    return value;
};

export function channelPage(collection, next, filters = {}) {
    const params = new URLSearchParams(filters);
    if (next) {
        const page = new URL(next, "https://pagination.invalid");
        if (page.pathname !== collection || !page.searchParams.get("cursor")) throw Error("Página de canal no válida.");
        for (const key of ["parent", "archived", "q", "unit", "server", "channel", "department", "purpose", "state", "favorite", "block"]) {
            if ((page.searchParams.get(key) || "") !== (params.get(key) || "")) throw Error("La página pertenece a otra vista.");
        }
        params.set("cursor", page.searchParams.get("cursor"));
    }
    return collection + (params.size ? `?${params}` : "");
}

export function createChannelApi(client = http) {
    const detail = channel => `${root}${id(channel)}/`, messages = channel => detail(channel) + "messages/";
    const sendMedia=createStagedMediaSender(client);
    const discard=createMediaDiscarder(client);
    return {
        serverOrder: options => client.request('/api/v2/auth/interface-settings/',options).then(value=>value.slack_server_order || []),
        saveServerOrder: (order,options) => client.request('/api/v2/auth/interface-settings/',{...options,method:'PATCH',body:{slack_server_order:order}}),
        departments: options => client.request("/api/v2/messaging/departments/", options),
        servers: (options,next,query='') => client.request(channelPage('/api/v2/messaging/servers/',next,query ? {q:query}:{}), options),
        createServer: (values, options) => client.request('/api/v2/messaging/servers/', {...options,method:'POST',body:values}),
        serverIcon: (kind,server,options) => client.request(`/api/v2/messaging/server-icons/${kind==='private' ? 'private':'department'}/${id(server)}/`,options),
        updateServerIcon: (kind,server,values,options) => client.request(`/api/v2/messaging/server-icons/${kind==='private' ? 'private':'department'}/${id(server)}/`,{...options,method:'PATCH',body:values}),
        server: (server, options) => client.request(`/api/v2/messaging/servers/${id(server)}/`,options),
        updateServer: (server, values, options) => client.request(`/api/v2/messaging/servers/${id(server)}/`,{...options,method:'PATCH',body:values}),
        categories: (scope,options)=>client.request(channelPage('/api/v2/messaging/channel-categories/',null,scope),options),
        createCategory: (scope,values,options)=>client.request(channelPage('/api/v2/messaging/channel-categories/',null,scope),{...options,method:'POST',body:values}),
        updateCategory: (scope,category,values,options)=>client.request(channelPage(`/api/v2/messaging/channel-categories/${id(category)}/`,null,scope),{...options,method:'PATCH',body:values}),
        deleteCategory: (scope,category,values,options)=>client.request(channelPage(`/api/v2/messaging/channel-categories/${id(category)}/`,null,scope),{...options,method:'DELETE',body:values}),
        moveCategory: (scope,category,values,options)=>client.request(channelPage(`/api/v2/messaging/channel-categories/${id(category)}/position/`,null,scope),{...options,method:'PUT',body:values}),
        moveChannelCategory: (scope,channel,values,options)=>client.request(channelPage(detail(channel)+'category/',null,scope),{...options,method:'PUT',body:values}),
        managed: (next,options) => client.request(channelPage(root+"managed/",next),options),
        access: (channel,options) => client.request(detail(channel)+"access/",options),
        setAccess: (channel,values,options) => client.request(detail(channel)+"access/",{...options,method:"PATCH",body:values}),
        people: (filters,options,next) => client.request(channelPage(root+"people/",next,filters),options),
        detail: (channel,options) => client.request(detail(channel),options),
        message: (channel,message,options)=>client.request(messages(channel)+id(message)+"/",options),
        threads: (channel,query='',next,options,filters={})=>client.request(channelPage(detail(channel)+'threads/',next,{...filters,...(query ? {q:query}:{})}),options),
        manageThread: (channel,message,values,options)=>client.request(messages(channel)+id(message)+'/thread-settings/',{...options,method:'PATCH',body:values}),
        threadPreferences: (channel,message,values,options)=>client.request(messages(channel)+id(message)+'/thread-preferences/',{...options,method:'PUT',body:values}),
        readThread: (channel,message,options)=>client.request(messages(channel)+id(message)+'/thread-read/',{...options,method:'POST',body:{}}),
        pins: (channel,next,options)=>client.request(channelPage(detail(channel)+'pins/',next),options),
        startThread: (channel,message,title,options)=>client.request(messages(channel)+id(message)+'/thread/',{...options,method:'PUT',body:{title}}),
        pin: (channel,message,pinned,options)=>client.request(messages(channel)+id(message)+'/pin/',{...options,method:'PUT',body:{pinned}}),
        mentionPeople: (channel,query,options)=>{
            if(typeof query!=="string" || query.trim().length>80)throw Error("Usa hasta 80 caracteres para buscar una persona.");
            return client.request(channelPage(detail(channel)+"mention-people/",null,{q:query.trim()}),options);
        },
        follow: (channel,following,options)=>client.request(detail(channel)+"following/",{...options,method:"PUT",body:{following}}),
        threadState: (channel,parent,options)=>client.request(messages(channel)+id(parent)+"/following/",options),
        followThread: (channel,parent,following,options)=>client.request(messages(channel)+id(parent)+"/following/",{...options,method:"PUT",body:{following}}),
        read: (channel,message,options)=>client.request(detail(channel)+"read/",{...options,method:"POST",body:{message_id:id(message)}}),
        list: (archived, next, options,filters={}) => client.request(channelPage(root, next, {...filters,...(archived ? {archived:"true"} : {})}), options),
        create: (values, options) => client.request(root, {...options, method:"POST", body:values}),
        update: (channel, values, options) => client.request(detail(channel), {...options, method:"PATCH", body:values}),
        messages: (channel, parent, next, options) => client.request(channelPage(messages(channel), next, parent ? {parent:id(parent)} : {}), options),
        tasks: (channel, query, next, options, purpose) => client.request(channelPage(detail(channel)+"tasks/",next,{q:query,...(purpose==="page" ? {purpose:"page"}:{})}),options),
        task: (task, options) => client.request(`/api/v2/tasks/${id(task)}/`,options),
        send: (channel, values, options) => client.request(messages(channel), {...options, method:"POST", body:values}),
        sendMedia:(channel,values,file,options)=>sendMedia('channel',id(channel),values,file,options),
        discardMedia:(channel,clientId,options)=>discard('channel',id(channel),clientId,options),
        media: (channel, message, options) => client.request(messages(channel) + id(message) + "/media/", {...options, responseType:"blob"}),
        edit: (channel, message, values, options) => client.request(messages(channel) + id(message) + "/", {...options, method:"PATCH", body:values}),
    };
}
export const channelApi = createChannelApi();

export function mergeChannelDetails(current,incoming) {
    if(!current || current.id!==incoming.id) return incoming;
    const personal=(incoming.state_version || 0)>=(current.state_version || 0);
    const activity=(incoming.activity_version || 0)>=(current.activity_version || 0);
    return {...((incoming.version || 0)>=(current.version || 0) ? incoming : current),
        activity_version:Math.max(incoming.activity_version || 0,current.activity_version || 0),
        state_version:Math.max(incoming.state_version || 0,current.state_version || 0),
        following:personal ? incoming.following : current.following,
        unread_count:personal && activity ? incoming.unread_count : current.unread_count};
}

export function channelError(error) {
    if (error?.status === 404) return "Este canal o hilo ya no está disponible para tu asignación activa.";
    if (error?.status === 429) return "Demasiadas acciones seguidas. Conservamos el texto; espera antes de reintentar.";
    const fields = error?.fields;
    const detail = (Array.isArray(fields) ? fields:[fields?.detail,fields?.name,fields?.title,fields?.thread_title,fields?.description,fields?.unit_id,fields?.server_id,fields?.image,fields?.version,fields?.visibility,fields?.members,fields?.body,fields?.file,fields?.non_field_errors].flat()).find(value => typeof value === "string" && value.length <= 500);
    if (detail) return detail;
    if (error?.status === 403) return "Tu asignación activa no permite esta acción en Slack.";
    if (error?.status === 409) return "El contenido cambió en otra ventana. Conservamos tu texto; actualiza antes de volver a guardar.";
    return "No se pudo confirmar la operación. Conservamos tu texto y el identificador del envío para reintentar sin duplicarlo.";
}

export function followError(error){
    if([401,403,404].includes(error?.status))return channelError(error);
    if(error?.status===429)return "Demasiados cambios de seguimiento. Espera antes de volver a intentarlo.";
    const detail=error?.fields?.detail;
    return typeof detail==="string" && detail.length<=500 ? detail:"No se pudo confirmar el seguimiento. Actualiza la vista antes de decidir si necesitas reintentar.";
}

export function mergeChannelMessages(current, incoming, {recent = false} = {}) {
    const floor = Math.min(...incoming.map(row => row.sequence));
    const retained = recent && incoming.length ? current.filter(row => row.sequence >= floor) : current;
    const rows = new Map(retained.map(row => [row.id,row]));
    for (const row of incoming) {
        rows.set(row.id,mergeChannelMessage(rows.get(row.id),row));
    }
    return [...rows.values()].sort((a,b) => a.sequence-b.sequence);
}

// Content and a person's thread preference have independent revision clocks.
export function mergeChannelMessage(current,incoming){
    if(!current || current.id!==incoming.id)return incoming;
    const content={...((current.version || 0)>(incoming.version || 0) ? current:incoming),
        ...(current.reactions || incoming.reactions ? {reactions:newestReactions(current.reactions,incoming.reactions)}:{})};
    const personal=(incoming.thread_state_version ?? -1)>=(current.thread_state_version ?? -1) ? incoming:current;
    return personal.thread_state_version==null ? content:{...content,...Object.fromEntries(['following','state_version','favorite','left','notifications','muted_until','muted_forever'].filter(key=>('thread_'+key) in personal).map(key=>['thread_'+key,personal['thread_'+key]]))};
}

export function threadPreferenceMessage(message,value){
    return {...message,...Object.fromEntries(['following','favorite','left','notifications','muted_until','muted_forever'].filter(key=>key in value).map(key=>['thread_'+key,value[key]])),thread_state_version:value.state_version};
}

// A coalesced refresh after a real event, never a periodic polling loop.
export function createChannelRefresh(refresh, onError) {
    let running = null, dirty = false, closed = false;
    const controller = new AbortController();
    function request() {
        if (closed) return Promise.resolve();
        dirty = true;
        if (running) return running;
        running = (async () => {
            while (dirty && !closed) {
                dirty = false;
                try {await refresh(controller.signal);}
                catch (error) {dirty = false; if (!closed && error.name !== "AbortError") onError(error);}
            }
        })().finally(() => {running = null;});
        return running;
    }
    return {request, dispose() {closed = true; dirty = false; controller.abort();}};
}
