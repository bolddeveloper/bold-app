import {http} from '../core/http_client.js';
const uuid=value=>{if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || ''))throw Error('Identificador de automatización no válido.');return value;};
export function automationPage(path,next,query=''){
    const params=new URLSearchParams(query ? {q:query}:{});
    if(next){
        const page=new URL(next,'https://pagination.invalid');
        if(page.pathname!==path || !page.searchParams.get('cursor') || (page.searchParams.get('q') || '')!==query ||
            [...page.searchParams.keys()].some(key=>!['q','cursor'].includes(key) || page.searchParams.getAll(key).length!==1))throw Error('La página pertenece a otra revisión.');
        params.set('cursor',page.searchParams.get('cursor'));
    }
    return path+(params.size ? '?'+params:'');
}
export function createAutomationApi(client=http){
    const channel=id=>`/api/v2/messaging/channels/${uuid(id)}/`,collection=id=>channel(id)+'automations/',detail=(id,rule)=>collection(id)+uuid(rule)+'/';
    const write=(method,path,body,options)=>client.request(path,{...options,method,body,timeoutMs:15000});
    return {
        list:(id,next,options)=>client.request(automationPage(collection(id),next),options),
        get:(id,rule,options)=>client.request(detail(id,rule),options),
        create:(id,values,options)=>write('POST',collection(id),values,options),
        replace:(id,rule,values,options)=>write('PUT',detail(id,rule),values,options),
        action:(id,rule,values,options)=>write('PATCH',detail(id,rule),values,options),
        runs:(id,rule,next,options)=>client.request(automationPage(detail(id,rule)+'runs/',next),options),
        audit:(id,rule,next,options)=>client.request(automationPage(detail(id,rule)+'audit/',next),options),
        projects:(id,query,next,options)=>{if(typeof query!=='string' || query.trim().length<2 || query.trim().length>120)throw Error('Escribe entre 2 y 120 caracteres.');return client.request(automationPage(channel(id)+'automation-projects/',next,query.trim()),options);},
        project:(id,project,options)=>client.request(channel(id)+'automation-projects/'+uuid(project)+'/',options),
    };
}
export const automationApi=createAutomationApi();
