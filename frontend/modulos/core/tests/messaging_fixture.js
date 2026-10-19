// Synthetic fixture only. No company identities, credentials, uploads or API calls.
export function installMessagingFixture(target = globalThis) {
    const actor = "11111111-1111-4111-8111-111111111111", peerId = "22222222-2222-4222-8222-222222222222";
    const conversationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const now = new Date(), calls = [];
    const me = {employee_id: actor, name: "Persona de prueba", avatar_url: null, available: true, departments: ["Equipo demo"]};
    const peer = {employee_id: peerId, name: "Compañera de demostración con nombre extenso", avatar_url: null, available: true, departments: ["Diseño", "Equipo demo"]};
    const conversation = {id: conversationId, me, peer, updated_at: now.toISOString()};
    let rows = [
        {id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", conversation_id: conversationId, author_id: peerId, body: "Hola. Revisemos este enlace: https://example.com/una/ruta/que/es/muy/larga?documento=una-propuesta-compartida. <script>no ejecutar</script>\n¿Coordinamos el siguiente paso?", created_at: new Date(now - 86400000).toISOString(), version: 1, can_edit: false},
        {id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", conversation_id: conversationId, author_id: actor, body: "De acuerdo. Lo reviso y te comento 👍", created_at: new Date(now - 120000).toISOString(), editable_until: new Date(+now + 480000).toISOString(), version: 1, can_edit: true},
    ];
    const fixture = {actor, peer, conversation, calls, enterBehavior:"send", sendDelay: null, failSend: false, getRows: () => rows};
    target.__messagingCore = {
        account: {id: "fixture-account", employee: actor}, employee: {id: actor}, activeAssignment: {id: "fixture-assignment", personId: actor}, directory: [],
        presence: {rows: [{...peer, status: "online"}], units: []},
    };
    target.__messagingShell = {chat_target: {employee_id: peerId}};
    target.__messagingApi = {
        preferences: async () => ({enter_behavior:fixture.enterBehavior}),
        savePreferences: async value => {fixture.enterBehavior=value; return {enter_behavior:value};},
        list: async () => {calls.push("list"); return {results: [{id: conversationId, peer, updated_at: now.toISOString(), preview: "De acuerdo. Lo reviso y te comento 👍"}], next: null};},
        open: async () => {calls.push("open"); return conversation;},
        detail: async () => {calls.push("detail"); return conversation;},
        messages: async () => {calls.push("messages"); return {results: [...rows].reverse(), next: null, server_now: new Date().toISOString()};},
        send: async (id, body, clientId) => {
            calls.push("send");
            if (fixture.sendDelay) await fixture.sendDelay;
            if (fixture.failSend) {const error = new Error("Synthetic failure"); error.status = 500; throw error;}
            const sent = new Date();
            const row = {id: clientId, client_id: clientId, conversation_id: id, author_id: actor, body, created_at: sent.toISOString(), editable_until: new Date(+sent + 600000).toISOString(), version: 1, can_edit: true};
            rows.push(row); return {message: row, server_now: sent.toISOString()};
        },
        edit: async (id, messageId, body, version) => {
            calls.push("edit");
            const row = rows.find(message => message.id === messageId);
            Object.assign(row, {body, version: version + 1, edited_at: new Date().toISOString()});
            return {message: {...row}, server_now: new Date().toISOString()};
        },
    };
    return fixture;
}
