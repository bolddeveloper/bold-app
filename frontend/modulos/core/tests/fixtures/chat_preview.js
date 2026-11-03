import {historyApi} from '../../../mensajeria/history_api.js';
import {resourceApi} from '../../../mensajeria/resource_api.js';
import {channelApi} from '../../../mensajeria/channel_api.js';
import {taskConversionApi} from '../../../mensajeria/task_conversion_api.js';
import {agreementApi} from '../../../mensajeria/agreement_api.js';
import {reactionApi} from '../../../mensajeria/reaction_api.js';
// Isolated visual fixture. Never imported by the application or its API client.
export function prepareChatPreview(fixture) {
    const choices=[{key:'heart',emoji:'❤️',label:'Corazón'},{key:'thumbs_up',emoji:'👍',label:'Me gusta'},{key:'laugh',emoji:'😂',label:'Risa'},{key:'surprise',emoji:'😮',label:'Sorpresa'}],reactions=new Map();
    reactionApi.state=async(_kind,_container,id)=>({reactions:reactions.get(id) || {version:0,own_version:0,items:[]},choices,can_change:true,max_own:8});
    reactionApi.set=async(_kind,_container,id,attempt)=>{const old=reactions.get(id) || {version:0,own_version:0,items:[]},choice=choices.find(row=>row.key===attempt.key),items=old.items.filter(row=>row.key!==attempt.key);if(attempt.active)items.push({...choice,count:1,mine:true});reactions.set(id,{version:old.version+1,own_version:old.own_version+1,items});return reactionApi.state('chat',null,id);};
    channelApi.list=async()=>({results:[],next:null});
    const target={kind:'chat',conversation_id:fixture.conversation.id,message_id:fixture.getRows()[0].id};
    historyApi.search=async filters=>({results:[{id:'preview-history',kind:'text',title:'Revisión de la propuesta',snippet:'Revisemos las ideas y coordinemos el siguiente paso.',source_id:target.message_id,author:fixture.peer,created_at:new Date().toISOString(),saved:filters.saved,target,conversation:{peer:fixture.peer}}],next_cursor:null,first_cursor:'preview-first'});
    historyApi.context=async value=>({anchor_id:value.message_id,conversation:fixture.conversation,results:fixture.getRows(),has_before:false,has_after:false});
    const resources=[
        {id:'preview-link',source_id:target.message_id,author:fixture.peer,created_at:'2026-11-02T16:00:00Z',excerpt:'Referencias para la propuesta de diseño.',links:[{href:'https://example.com',label:'Propuesta de ejemplo'}],target},
        {id:'preview-document',source_id:target.message_id,author:fixture.peer,created_at:'2026-10-15T16:00:00Z',excerpt:'Documento compartido para revisión.',media:{id:'preview-pdf',kind:'document',mime_type:'application/pdf',filename:'Propuesta de diseño.pdf',size_bytes:245760},links:[],target},
        {id:'preview-older-link',source_id:target.message_id,author:fixture.peer,created_at:'2026-09-10T16:00:00Z',excerpt:'Primera referencia del proyecto.',links:[{href:'https://example.com/referencia',label:'Referencia inicial'}],target},
    ];
    resourceApi.list=async(_kind,_container,filters={},cursor)=>{
        const found=resources.filter(row=>(!filters.author || row.author.employee_id===filters.author) && (!filters.q || `${row.excerpt} ${row.media?.filename || ''}`.toLowerCase().includes(filters.q.toLowerCase())) && (!filters.kind || filters.kind==='all' || filters.kind==='link' && row.links.length || filters.kind==='file' && row.media || filters.kind===row.media?.kind) && (!filters.after || row.created_at>=filters.after) && (!filters.before || row.created_at<filters.before));
        return {results:cursor ? found.slice(2):found.slice(0,2),next_cursor:!cursor && found.length>2 ? 'preview-older':null,first_cursor:'preview-first',snapshot_at:new Date().toISOString()};
    };
    taskConversionApi.links=async()=>({results:[],next:null,source_version:1,source_text:'Revisar la propuesta de diseño.'});
    taskConversionApi.projects=async()=>({results:[],next:null});
    const agreementChannels=[{id:'00000000-0000-4000-8000-000000000111',name:'Acuerdos de diseño',department:'Diseño',visibility:'department'},{id:'00000000-0000-4000-8000-000000000112',name:'Equipo de operaciones',department:'Operaciones',visibility:'public'}];
    agreementApi.review=async(_kind,_container,ids)=>({results:ids.map(id=>{const message=fixture.getRows().find(row=>row.id===id);return {message_id:id,source_version:message.version || 1,text:message.body || ''};})});
    agreementApi.destinations=async query=>({results:agreementChannels.filter(row=>row.name.toLocaleLowerCase('es').includes(query.toLocaleLowerCase('es'))),next:null});
    agreementApi.destination=async id=>agreementChannels.find(row=>row.id===id);

    const bytes = new Uint8Array(44 + 8000 * 10 * 2), view = new DataView(bytes.buffer);
    const word = (offset, value) => [...value].forEach((letter, i) => view.setUint8(offset + i, letter.charCodeAt(0)));
    word(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); word(8, 'WAVE'); word(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 8000, true); view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    word(36, 'data'); view.setUint32(40, bytes.length - 44, true);
    for (let i = 0; i < 80000; i++) view.setInt16(44 + i * 2, Math.sin(i / 8000 * 440 * Math.PI * 2) * 500 * (.6 + .4 * Math.sin(i / 900)), true);
    const originalMedia = globalThis.__messagingApi.media;
    globalThis.__messagingApi.media = (id, message, options) => message === 'preview-audio' ? Promise.resolve(new Blob([bytes], {type:'audio/wav'})) : originalMedia(id, message, options);
    fixture.getRows().push({id:'preview-audio', conversation_id:fixture.conversation.id, author_id:fixture.peer.employee_id, body:'Te comparto una nota para revisar la propuesta.', created_at:new Date().toISOString(), version:1, media:{id:'preview-audio', kind:'audio', mime_type:'audio/wav', size_bytes:bytes.length}});
    fixture.getRows().push({id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',conversation_id:fixture.conversation.id,author_id:fixture.actor,body:'Listo',created_at:new Date().toISOString(),editable_until:new Date(Date.now()+600000).toISOString(),version:1,can_edit:true});
    document.querySelector('#preview-typing').addEventListener('click', () => window.dispatchEvent(new CustomEvent('bold:messaging-event', {detail:{event_type:'messaging.typing', payload:{conversation_id:fixture.conversation.id}}})));
    document.querySelector('#preview-theme').addEventListener('click', () => {
        const dark = document.documentElement.classList.toggle('theme_dark');
        document.body.classList.remove('theme_dark');
    });
}
