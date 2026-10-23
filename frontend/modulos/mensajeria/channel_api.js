import {http} from "../core/http_client.js";

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
        for (const key of ["parent", "archived", "q", "unit", "channel", "department", "purpose"]) {
            if ((page.searchParams.get(key) || "") !== (params.get(key) || "")) throw Error("La página pertenece a otra vista.");
        }
        params.set("cursor", page.searchParams.get("cursor"));
    }
    return collection + (params.size ? `?${params}` : "");
}

export function createChannelApi(client = http) {
    const detail = channel => `${root}${id(channel)}/`, messages = channel => detail(channel) + "messages/";
    return {
        departments: options => client.request("/api/v2/messaging/departments/", options),
        managed: (next,options) => client.request(channelPage(root+"managed/",next),options),
        access: (channel,options) => client.request(detail(channel)+"access/",options),
        setAccess: (channel,values,options) => client.request(detail(channel)+"access/",{...options,method:"PATCH",body:values}),
        people: (filters,options,next) => client.request(channelPage(root+"people/",next,filters),options),
        detail: (channel,options) => client.request(detail(channel),options),
        message: (channel,message,options)=>client.request(messages(channel)+id(message)+"/",options),
        follow: (channel,following,options)=>client.request(detail(channel)+"following/",{...options,method:"PUT",body:{following}}),
        read: (channel,message,options)=>client.request(detail(channel)+"read/",{...options,method:"POST",body:{message_id:id(message)}}),
        list: (archived, next, options,filters={}) => client.request(channelPage(root, next, {...filters,...(archived ? {archived:"true"} : {})}), options),
        create: (values, options) => client.request(root, {...options, method:"POST", body:values}),
        update: (channel, values, options) => client.request(detail(channel), {...options, method:"PATCH", body:values}),
        messages: (channel, parent, next, options) => client.request(channelPage(messages(channel), next, parent ? {parent:id(parent)} : {}), options),
        tasks: (channel, query, next, options, purpose) => client.request(channelPage(detail(channel)+"tasks/",next,{q:query,...(purpose==="page" ? {purpose:"page"}:{})}),options),
        task: (task, options) => client.request(`/api/v2/tasks/${id(task)}/`,options),
        send: (channel, values, options) => client.request(messages(channel), {...options, method:"POST", body:values}),
        sendMedia: (channel, values, file, options) => {
            const data = new FormData();
            for (const key of ["body", "client_id", "parent_id", "task_id"]) if (values[key] != null) data.set(key, values[key]);
            data.set("file", file, file.name || "nota-de-voz.webm");
            return client.request(messages(channel), {...options, method:"POST", body:data});
        },
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
    const detail = [fields?.detail,fields?.name,fields?.description,fields?.unit_id,fields?.visibility,fields?.members,fields?.body,fields?.file,fields?.non_field_errors].flat().find(value => typeof value === "string" && value.length <= 500);
    if (detail) return detail;
    if (error?.status === 403) return "Tu asignación activa no permite esta acción en Slack.";
    if (error?.status === 409) return "El contenido cambió en otra ventana. Conservamos tu texto; actualiza antes de volver a guardar.";
    return "No se pudo confirmar la operación. Conservamos tu texto y el identificador del envío para reintentar sin duplicarlo.";
}

export function mergeChannelMessages(current, incoming, {recent = false} = {}) {
    const floor = Math.min(...incoming.map(row => row.sequence));
    const retained = recent && incoming.length ? current.filter(row => row.sequence >= floor) : current;
    const rows = new Map(retained.map(row => [row.id,row]));
    for (const row of incoming) {
        if (!rows.has(row.id) || rows.get(row.id).version <= row.version) rows.set(row.id,row);
    }
    return [...rows.values()].sort((a,b) => a.sequence-b.sequence);
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
