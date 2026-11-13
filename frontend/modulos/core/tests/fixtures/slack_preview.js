import {channelApi} from '../../../mensajeria/channel_api.js';
import {automationApi} from '../../../mensajeria/automation_api.js';
import {pageApi} from '../../../mensajeria/page_api.js';
import {discussionApi} from '../../../mensajeria/page_discussion_api.js';

// Synthetic visual data only. These handlers never reach the application backend.
export function prepareSlackPreview(fixture){
    const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
    const units=[{id:id(101),name:'Creativo',color:'#9771d7',can_create:true,can_edit_icon:true},{id:id(102),name:'Producción',color:'#3fa58e',can_create:true,can_edit_icon:true},{id:id(103),name:'Equipo de IT',color:'#e73535',can_create:true,can_edit_icon:true}];
    const names=['General','Diseño y marca','Producción','Lanzamientos','Desarrollo','Referencias','Fotografía','Contenido','Proyectos','Comunicados','Ideas','Equipo'];
    const channels=names.map((name,i)=>({id:id(i+1),name,description:i===0 ? 'Un espacio para coordinar el día y compartir contexto.':'Ideas, avances y conversaciones del equipo.',department:units[i%3],color:units[i%3].color,version:1,activity_version:1,visibility:i===4 ? 'private':'public',archived_at:null,can_manage:true,can_configure:true,can_manage_access:true,can_send:true,can_read_automations:true,can_manage_automations:true,following:i===0,unread_count:i%4===0 ? i+2:0}));
    const privateServer={id:id(901),name:'Equipo de lanzamiento',color:'#e73535',private:true,can_manage:true,can_create:true,version:1};
    channels.push({...channels[0],id:id(90),name:'Coordinación privada',server:privateServer,department:null,visibility:'private'});
    const categoryScopes=new Map();
    const keys=[...units.map(row=>row.id),'server:'+privateServer.id,'independent'];
    keys.forEach((key,index)=>categoryScopes.set(key,[{id:id(950+index*10),name:'App BOLD',position:0,version:1},{id:id(951+index*10),name:'Recursos',position:1,version:1}]));
    channels.forEach((channel,index)=>{const key=channel.server ? 'server:'+channel.server.id:channel.department.id;channel.category_id=index<6 ? categoryScopes.get(key)[0].id:index<9 ? categoryScopes.get(key)[1].id:null;});
    const categoryKey=scope=>scope.server ? 'server:'+scope.server:scope.unit;
    const categoryCatalog=scope=>({scope:categoryKey(scope),can_manage:true,results:categoryScopes.get(categoryKey(scope)).map(row=>({...row}))});
    const rows=new Map(),now=Date.now();
    for(const channel of channels){
        rows.set(channel.id,[
            {id:id(201+Number(channel.id.slice(-3))*10),sequence:1,channel_id:channel.id,parent_id:null,version:1,author:{employee_id:fixture.peer.employee_id,name:'Compañera de diseño',avatar_url:null},department:units[0],created_at:new Date(now-900000).toISOString(),body:'Buenos días, equipo. La propuesta está lista para revisar. Dejemos aquí los comentarios para conservar el contexto.',can_edit:false,reply_count:3,thread_title:"Revisión de la propuesta",thread_started_at:new Date(now-800000).toISOString(),pinned_at:new Date(now-600000).toISOString()},
            {id:id(202+Number(channel.id.slice(-3))*10),sequence:2,channel_id:channel.id,parent_id:null,version:1,author:{employee_id:fixture.actor,name:'Persona de prueba',avatar_url:null},department:units[2],created_at:new Date(now-300000).toISOString(),editable_until:new Date(now+600000).toISOString(),body:'Perfecto, revisaré los ajustes esta mañana. 👍',can_edit:true,reply_count:0},
            {id:id(203+Number(channel.id.slice(-3))*10),sequence:3,channel_id:channel.id,parent_id:null,version:1,author:{employee_id:fixture.peer.employee_id,name:'Compañera de diseño',avatar_url:null},department:units[0],created_at:new Date(now-60000).toISOString(),body:'Referencias para la reunión: https://example.com/propuesta',can_edit:false,reply_count:0},
        ]);
    }
    const find=channel=>channels.find(row=>row.id===channel);
    const preferences=new Map();let serverOrder=[];
    const project=message=>({...message,can_manage_thread:true,can_edit_thread:true,can_close_thread:!message.thread_deleted_at,
        can_reply_thread:!(message.thread_closed_at || message.thread_locked || message.thread_deleted_at),
        ...Object.fromEntries(Object.entries(preferences.get(message.id) || {}).filter(([key])=>key!=='parent_id').map(([key,value])=>['thread_'+key,value]))});
    Object.assign(channelApi,{
        mentionPeople:async(_,query)=>({results:[{employee_id:fixture.actor,name:'Persona de prueba',email:'persona@example.test',token:'@persona@example.test'},{employee_id:fixture.peer.employee_id,name:'Compañera de diseño',email:'diseno@example.test',token:'@diseno@example.test'}].filter(row=>!query || `${row.name} ${row.email}`.toLowerCase().includes(query.toLowerCase())),refine:false}),
        serverOrder:async()=>serverOrder,
        saveServerOrder:async order=>{serverOrder=[...order];return {slack_server_order:serverOrder};},
        categories:async scope=>categoryCatalog(scope),
        createCategory:async(scope,values)=>{const rows=categoryScopes.get(categoryKey(scope));if(!rows.some(row=>row.id===values.client_id))rows.push({id:values.client_id,name:values.name,position:rows.length,version:1});return categoryCatalog(scope);},
        updateCategory:async(scope,id,values)=>{const row=categoryScopes.get(categoryKey(scope)).find(item=>item.id===id);Object.assign(row,{name:values.name,version:row.version+1});return categoryCatalog(scope);},
        deleteCategory:async(scope,id)=>{const key=categoryKey(scope);categoryScopes.set(key,categoryScopes.get(key).filter(row=>row.id!==id));channels.filter(row=>row.category_id===id).forEach(row=>Object.assign(row,{category_id:null,version:row.version+1}));return categoryCatalog(scope);},
        moveCategory:async(scope,id,values)=>{const rows=categoryScopes.get(categoryKey(scope)),row=rows.find(item=>item.id===id),rest=rows.filter(item=>item.id!==id),index=rest.findIndex(item=>item.id===values.before_id);rest.splice(index<0 ? rest.length:index,0,row);categoryScopes.set(categoryKey(scope),rest.map((item,i)=>({...item,position:i,version:item.version+1})));return categoryCatalog(scope);},
        moveChannelCategory:async(scope,channel,values)=>({channel:Object.assign(find(channel),{category_id:values.category_id,version:find(channel).version+1})}),
        serverIcon:async()=>({avatar_url:null,icon_version:0,can_edit_icon:true}),
        updateServerIcon:async()=>{throw Error('Esta vista no modifica imágenes.');},
        servers:async()=>({results:[privateServer],next:null}),
        server:async()=>({...privateServer,members:[{employee_id:fixture.actor,name:'Persona de prueba',owner:true,access:'write',departments:[units[2]]}]}),
        createServer:async()=>{throw Error('Esta vista de prueba no crea servidores.');},
        updateServer:async()=>{throw Error('Esta vista de prueba no cambia invitaciones.');},
        departments:async()=>({results:units,can_create_independent:true}),
        list:async(_archived,_next,_options,filters={})=>({results:channels.filter(row=>(!filters.unit || (filters.unit==='independent' ? !row.department && !row.server:row.department?.id===filters.unit)) && (!filters.server || row.server?.id===filters.server) && (!filters.q || row.name.toLocaleLowerCase('es').includes(filters.q.toLocaleLowerCase('es')))),departments:units,next:null}),
        detail:async channel=>find(channel),
        messages:async(channel,parent)=>({results:parent ? [{...rows.get(channel)[0],id:id(999),parent_id:parent,pinned_at:null,thread_started_at:null,thread_title:'',body:'Lo revisamos en este hilo para mantener el canal ordenado.',sequence:4}]:rows.get(channel).map(project),next:null,channel:find(channel),thread_source:parent ? project(rows.get(channel).find(row=>row.id===parent)):undefined,thread:parent ? {parent_id:parent,following:false,state_version:0,...preferences.get(parent)}:undefined}),
        message:async(channel,message)=>({message:project(rows.get(channel).find(row=>row.id===message))}),
        read:async(channel,message)=>({channel:{...find(channel),unread_count:0},read_sequence:rows.get(channel).find(row=>row.id===message)?.sequence || 0,parent_id:null}),
        follow:async(channel,following)=>Object.assign(find(channel),{following,state_version:2}),
        threads:async(channel,query='',_next,_options,filters={})=>({results:rows.get(channel).filter(row=>row.reply_count && row.thread_title.toLowerCase().includes(query.toLowerCase()) && (filters.state==='deleted' ? !!row.thread_deleted_at:!row.thread_deleted_at) && (filters.state==='closed' ? !!row.thread_closed_at:filters.state==='active' ? !row.thread_closed_at:true) && (!filters.favorite || preferences.get(row.id)?.favorite)).map(project),next:null}),
        threadPreferences:async(_channel,parent,values)=>{const previous=preferences.get(parent) || {following:false,state_version:0};const value={...previous,parent_id:parent,state_version:previous.state_version+1,...(values.favorite!=null ? {favorite:values.favorite}:{}),...(values.left!=null ? {left:values.left,following:!values.left}:{}),...(values.notifications ? {notifications:values.notifications}:{}),...(values.mute ? {muted_forever:values.mute==='forever',muted_until:values.mute==='off' || values.mute==='forever' ? null:new Date(Date.now()+3600000).toISOString()}:{})};preferences.set(parent,value);return value;},
        manageThread:async(channel,parent,values)=>{const row=rows.get(channel).find(message=>message.id===parent);Object.assign(row,values.action==='rename' ? {thread_title:values.title}:values.action==='close' ? {thread_closed_at:new Date().toISOString()}:values.action==='open' ? {thread_closed_at:null}:values.action==='lock' ? {thread_locked:true,thread_closed_at:new Date().toISOString()}:values.action==='unlock' ? {thread_locked:false}:values.action==='delete' ? {thread_deleted_at:new Date().toISOString(),thread_closed_at:new Date().toISOString()}:{thread_deleted_at:null});row.version++;return {message:project(row)};},
        readThread:async(channel,parent)=>({message:{...project(rows.get(channel).find(row=>row.id===parent)),unread_reply_count:0},channel:find(channel)}),
        pins:async channel=>({results:rows.get(channel).filter(row=>row.pinned_at),next:null}),
        startThread:async()=>{throw Error('Esta vista de prueba no crea hilos.');},
        pin:async()=>{throw Error('Esta vista de prueba no modifica fijados.');},
        followThread:async(_channel,parent,following)=>({parent_id:parent,following,state_version:2}),
        managed:async()=>({results:channels,next:null}),
        access:async channel=>({...find(channel),members:[]}),
        people:async()=>({results:[],departments:units,next:null}),
        tasks:async()=>({results:[],next:null}),
        send:async()=>{throw Error('Esta vista de prueba no envía mensajes.');},
        create:async()=>{throw Error('Esta vista de prueba no guarda canales.');},
        update:async()=>{throw Error('Esta vista de prueba no modifica canales.');},
        setAccess:async()=>{throw Error('Esta vista de prueba no cambia permisos.');},
    });
    globalThis.__messagingShell.slack_target=null;
    automationApi.list=async()=>({results:[],next:null});
    const page={id:id(801),title:'Guía de coordinación',icon:'note',blocks:[{id:id(802),type:'paragraph',text:'Reunimos aquí los acuerdos, responsables y siguientes pasos del equipo.'},{id:id(803),type:'paragraph',text:'Cada canal conserva su conversación y sus permisos. Las páginas ayudan a mantener el contexto a mano.'}],version:1,can_edit:true,can_manage:true,updated_at:new Date().toISOString(),updated_by:'Persona de prueba',collaboration_enabled:false};
    Object.assign(pageApi,{
        branch:async()=>({results:[page],next:null,can_create:true,can_edit_icon:true}),
        structure:async()=>({ancestors:[],parent_id:null,structure_version:1}),
        get:async()=>structuredClone(page),
        backlinks:async()=>({results:[],next:null}),
        history:async()=>({results:[{version:1,title:page.title,actor:'Persona de prueba',created_at:page.updated_at}],next:null}),
        revision:async()=>structuredClone(page),
        save:async()=>{throw Error('Esta vista de prueba no guarda páginas.');},
        create:async()=>{throw Error('Esta vista de prueba no crea páginas.');},
    });
    discussionApi.summary=async()=>({blocks:[],can_read:true,can_comment:true});
}
