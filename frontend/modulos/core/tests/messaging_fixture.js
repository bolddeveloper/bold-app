// Synthetic fixture only. No company identities, credentials, uploads or API calls.
export function installMessagingFixture(target = globalThis) {
    const actor = "11111111-1111-4111-8111-111111111111", peerId = "22222222-2222-4222-8222-222222222222";
    const conversationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const now = new Date(), calls = [], mediaBlobs = new Map(),stops=new Set();
    const yesterday = new Date(now); yesterday.setDate(yesterday.getDate()-1); yesterday.setHours(12,0,0,0);
    const me = {employee_id: actor, name: "Persona de prueba", avatar_url: null, available: true, departments: ["Equipo demo"]};
    const peer = {employee_id: peerId, name: "Compañera de demostración con nombre extenso", avatar_url: null, available: true, departments: ["Diseño", "Equipo demo"]};
    const conversation = {id: conversationId, me, peer, updated_at: now.toISOString()};
    const forwardPeer = {employee_id:"33333333-3333-4333-8333-333333333333",name:"Destino de prueba IT",avatar_url:null,available:true,departments:["Equipo de IT"]};
    let rows = [
        {id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", conversation_id: conversationId, author_id: peerId, body: "Hola. Revisemos este enlace: https://example.com/una/ruta/que/es/muy/larga?documento=una-propuesta-compartida. <script>no ejecutar</script>\n¿Coordinamos el siguiente paso?", created_at: yesterday.toISOString(), version: 1, can_edit: false},
        // Keep a genuinely current-day message even in the first two minutes
        // after midnight; subtracting two minutes made the day-group test flaky.
        {id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", conversation_id: conversationId, author_id: actor, body: "De acuerdo. Lo reviso y te comento 👍", created_at: now.toISOString(), editable_until: new Date(+now + 600000).toISOString(), version: 1, can_edit: true},
    ];
    const fixture = {actor, peer, conversation, calls, enterBehavior:"send", sendDelay: null, failSend: false, mediaSends:[], failMediaAt:null, failMediaStatus:500, loseMediaResponseAt:null, getRows: () => rows};
    fixture.forwardDestination = {id:"dddddddd-dddd-4ddd-8ddd-dddddddddddd",me,peer:forwardPeer,updated_at:now.toISOString()};
    target.__messagingCore = {
        account: {id: "fixture-account", employee: actor}, employee: {id: actor}, activeAssignment: {id: "fixture-assignment", personId: actor, chat_enabled: true},
        directory: [{id:"fixture-assignment", personId:actor, name:me.name, chat_enabled:true}, {id:"peer-assignment", personId:peerId, name:peer.name, unit_name:"Equipo de IT", job_role_title:"Analista", email:"fixture.peer@bold.gt", chat_enabled:true}, {id:"forward-assignment",personId:forwardPeer.employee_id,name:forwardPeer.name,chat_enabled:true}],
        presence: {rows: [{...peer, status: "online", units:[{id:"it", name:"Equipo de IT"}]}], units: [{id:"it", name:"Equipo de IT"}]},
        messaging: {connection:"open", markDelivered:()=>{}, markRead:()=>{}, unread:{total:2,byEmployee:{[peerId]:2},byConversation:{[conversationId]:{count:2,version:2}}}},
    };
    target.__messagingShell = {chat_target: {employee_id: peerId}, set_active_module:module=>calls.push(`module:${module}`), open_direct_chat: person => {calls.push(`card:${person.employee_id}`);}};
    target.__messagingApi = {
        mentionPeople:async(_id,query,options)=>{calls.push('mention-search');fixture.mentionSignal=options.signal;if(fixture.mentionDelay)return fixture.mentionDelay;return {results:query.toLowerCase().includes('peer') ? [{...peer,email:'fixture.peer@bold.gt',token:'@fixture.peer@bold.gt'}]:[],refine:false};},
        preferences: async () => ({enter_behavior:fixture.enterBehavior}),
        savePreferences: async value => {fixture.enterBehavior=value; return {enter_behavior:value};},
        list: async () => {calls.push("list"); return {results: [{id: conversationId, peer, updated_at: now.toISOString(), preview: "De acuerdo. Lo reviso y te comento 👍"}], next: null};},
        open: async employee => {calls.push("open"); return fixture.forwardDestination?.peer.employee_id === employee ? fixture.forwardDestination : conversation;},
        detail: async id => {calls.push("detail"); return id===fixture.forwardDestination.id ? fixture.forwardDestination : conversation;},
        messages: async id => {calls.push("messages"); return {results: rows.filter(row=>row.conversation_id===id).reverse(), next: null, server_now: new Date().toISOString()};},
        message:async(id,message)=>{const row=rows.find(row=>row.conversation_id===id && row.id===message);if(!row)throw Object.assign(Error('Synthetic missing'),{status:404});return {message:row};},
        resolveIntent:async(id,nonce)=>{const row=rows.find(row=>row.conversation_id===id && row.client_id===nonce);return row ? {message:row}:null;},
        discardMedia:async(id,nonce)=>{const row=rows.find(row=>row.conversation_id===id && row.client_id===nonce);if(row)return {outcome:'published',message:row};stops.add(nonce);return {outcome:'cancelled'};},
        send: async (id, body, clientId) => {
            calls.push("send");
            if (fixture.sendDelay) await fixture.sendDelay;
            if(stops.has(clientId))throw Object.assign(Error('Synthetic stopped'),{status:409});
            if (fixture.failSend) {const error = new Error("Synthetic failure"); error.status = 500; throw error;}
            const duplicate = rows.find(row=>row.client_id===clientId);
            if (duplicate) {if (duplicate.body!==body) {const error=new Error("Synthetic idempotency conflict"); error.status=409; throw error;} return {message:duplicate,server_now:new Date().toISOString()};}
            const sent = new Date();
            const row = {id: clientId, client_id: clientId, conversation_id: id, author_id: actor, body, mentions:body.includes('@fixture.peer@bold.gt') ? [{employee_id:peerId,token:'@fixture.peer@bold.gt',name:peer.name}]:[],created_at: sent.toISOString(), editable_until: new Date(+sent + 600000).toISOString(), version: 1, can_edit: true};
            rows.push(row);if(fixture.loseTextResponse)throw Error('Synthetic text response lost after commit');return {message: row, server_now: sent.toISOString()};
        },
        edit: async (id, messageId, body, version) => {
            calls.push("edit");
            const row = rows.find(message => message.id === messageId);
            Object.assign(row, {body, version: version + 1, edited_at: new Date().toISOString()});
            return {message: {...row}, server_now: new Date().toISOString()};
        },
        media: async (_conversation, message) => {calls.push("media"); return mediaBlobs.get(message) || new Blob(["synthetic voice"], {type:"audio/webm"});},
        sendMedia: async (id, body, clientId, file) => {
            fixture.mediaSends.push({id,body,clientId,file});
            const attempt = fixture.mediaSends.length;
            if (attempt===fixture.failMediaAt) {const error=new Error("Synthetic media failure"); error.status=fixture.failMediaStatus; throw error;}
            const result = await target.__messagingApi.send(id,body,clientId);
            result.message.media = {id:clientId,kind:file.type.startsWith("image/") ? "image" : file.type.startsWith('audio/') ? "audio":'document',mime_type:file.type,size_bytes:file.size,width:200,height:120,filename:file.name};
            mediaBlobs.set(result.message.id,file);
            if (attempt===fixture.loseMediaResponseAt) throw new Error("Synthetic response lost after commit");
            return result;
        },
    };
    return fixture;
}
