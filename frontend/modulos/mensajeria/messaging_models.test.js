import assert from "node:assert/strict";
import test from "node:test";
import {applyReceipts, canEditMessage, dayLabel, deliveryState, enterSends, initials, linkParts, mergeMessages, messageError, normalizeQuery, reconcileMessages} from "./messaging_models.js";
import {createMessagingApi, pagePath} from "./messaging_api.js";

const conversation = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", message = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
test("enlaces HTTP, HTTPS y www seguros sin interpretar HTML ni protocolos ejecutables", () => {
    const body = '<script>alert(1)</script> https://example.com/a_(b). www.bold.gt! javascript:alert(1) data:text/html,hi';
    const parts = linkParts(body);
    assert.deepEqual(parts.filter(part => part.href).map(part => part.text), ["https://example.com/a_(b)", "www.bold.gt"]);
    assert.equal(parts.map(part => part.text).join(""), body);
    assert.ok(parts.filter(part => part.href).every(part => /^https?:/.test(part.href)));
    assert.equal(linkParts("https://) y texto").map(part => part.text).join(""), "https://) y texto");
    assert.equal(linkParts("").length, 0);
});

test("edición propia estricta a diez minutos, sin basarse solo en el botón", () => {
    const row = {author_id: "me", can_edit: true, editable_until: "2026-10-19T10:10:00Z"};
    assert.equal(canEditMessage(row, "me", Date.parse("2026-10-19T10:09:59Z")), true);
    assert.equal(canEditMessage(row, "me", Date.parse(row.editable_until)), false);
    assert.equal(canEditMessage(row, "other", 0), false);
    assert.equal(canEditMessage({...row, can_edit: false}, "me", 0), false);
});

test("páginas se fusionan por identificador sin deshacer una versión más reciente", () => {
    const original = {id: "a", body: "original", version: 1, delivered_at:null, read_at:null, created_at: "2026-10-19T10:00:00Z"};
    const updated = {...original, body: "editado", version: 2};
    const next = {id: "b", version: 1, delivered_at:null, read_at:null, created_at: "2026-10-19T10:01:00Z"};
    assert.deepEqual(mergeMessages([updated, next], [original]), [updated, next]);
    assert.deepEqual(mergeMessages([original], [updated, next, next]), [updated, next]);
});

test("late messages cannot erase confirmed read state", () => {
    const message = {id:"a", body:"new", version:2, created_at:"2026-10-19T10:00:00Z", delivered_at:"delivered", read_at:"read"};
    const merged = mergeMessages([message], [{...message, body:"old", version:1, delivered_at:null, read_at:null}])[0];
    assert.equal(merged.body,"new"); assert.equal(deliveryState(merged),"read");
    assert.equal(deliveryState(applyReceipts([message],[{id:"a", delivered_at:null, read_at:null}])[0]),"read");
    assert.equal(deliveryState({}),"sent"); assert.equal(deliveryState({delivered_at:"ok"}),"delivered");
});
test("Enter obeys each user's preference and never submits IME composition", () => {
    const enter = {key:"Enter", shiftKey:false, ctrlKey:false, metaKey:false, isComposing:false};
    assert.equal(enterSends(enter,"send"),true);
    assert.equal(enterSends({...enter,shiftKey:true},"send"),false);
    assert.equal(enterSends(enter,"newline"),false);
    assert.equal(enterSends({...enter,ctrlKey:true},"newline"),true);
    assert.equal(enterSends({...enter,metaKey:true},"newline"),true);
    assert.equal(enterSends({...enter,isComposing:true},"send"),false);
    assert.equal(enterSends(enter,null),false);
});

test("reconnection starts a contiguous page and preserves racing live messages and edits", () => {
    const row = (id, second, version = 1) => ({id, created_at:`2026-10-19T10:00:${second}Z`, version});
    const old = row("old", "00"), latest = row("latest", "30"), racing = row("racing", "40");
    const edited = {...latest, version:2, body:"edited", read_at:"read"};
    const result = reconcileMessages([old, edited, racing], [row("first", "20"), latest]);
    assert.deepEqual(result.map(item => item.id), ["first", "latest", "racing"]);
    assert.equal(result[1].body, "edited"); assert.equal(result[1].read_at,"read");
    assert.deepEqual(reconcileMessages([racing], []), [racing]);
});

test("formato de identidad, búsqueda y fechas locales", () => {
    assert.equal(initials("  Samuel Rivero  "), "SR");
    assert.equal(normalizeQuery("Dirección"), "direccion");
    assert.equal(dayLabel(new Date(2026, 9, 19, 10), new Date(2026, 9, 19, 12)), "Hoy");
    assert.match(dayLabel(new Date(2026, 9, 18), new Date(2026, 9, 19)), /18.*octubre.*2026/);
});

test("la paginación nunca sigue otro recurso ni el host privado", () => {
    const root = `/api/v2/messaging/conversations/${conversation}/messages/`;
    assert.equal(pagePath(root, `http://backend${root}?cursor=abc&employee=other`), root + "?cursor=abc");
    assert.throws(() => pagePath(root, "/api/v2/administration/?cursor=abc"));
    assert.throws(() => pagePath(root, root));
});

test("API deriva autores del servidor y usa rutas anidadas verificadas", async () => {
    const calls = [], api = createMessagingApi({request: async (...args) => {calls.push(args); return {};}});
    await api.open(message);
    await api.send(conversation, "hola", message);
    await api.edit(conversation, message, "hola de nuevo", 2);
    assert.equal(calls[1][0], `/api/v2/messaging/conversations/${conversation}/messages/`);
    assert.deepEqual(calls[1][1].body, {body: "hola", client_id: message});
    assert.deepEqual(calls[2][1].body, {body: "hola de nuevo", version: 2});
    assert.throws(() => api.detail("../../admin"));
});

test("errores comprensibles y sin volcar datos técnicos del servidor", () => {
    assert.match(messageError({status: 409}), /Conservamos tu texto/);
    assert.match(messageError({status: 429}), /espera/);
    assert.doesNotMatch(messageError({status: 500, message: "SECRET TRACE"}), /SECRET/);
    assert.equal(messageError({status: 403, fields: {detail: "Solo puedes editar tus propios mensajes."}}), "Solo puedes editar tus propios mensajes.");
    assert.match(messageError({status:400,fields:["Configura el destino de Drive en Administración → Conectores."]}), /Drive/);
    assert.match(messageError({status:409,fields:{detail:"Vuelve a conectar tu cuenta de Google."}}), /Google/);
});
