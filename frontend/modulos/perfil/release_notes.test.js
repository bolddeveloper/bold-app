import assert from "node:assert/strict";
import test from "node:test";
import {reportsReleaseNotes,supportIntegrationReleaseNotes,pendingSupportReleaseNotes,pendingMcpReleaseNotes,pendingPilotReleaseNotes,multitaskingReleaseNotes,releaseNotes,messagingReleaseNotes,getReleaseNotes} from "./release_notes.js";

test("soportebold y MCP se publican juntos tras verificar producción, conservando límites y permisos",()=>{
    const [note]=supportIntegrationReleaseNotes;
    assert.equal(supportIntegrationReleaseNotes.length,1);
    assert.ok(releaseNotes.includes(note));
    assert.equal(getReleaseNotes({chat_enabled:true}).filter(row=>row.id===note.id).length,1);
    const text=note.sections.flatMap(row=>row.items).join(' ');
    assert.match(text,/Solo lectura/);
    assert.match(text,/No conecta servicios externos/);
    assert.match(text,/activo en producción/);
    assert.match(text,/no amplía tus permisos/);
    assert.match(text,/como máximo en una hora/);
});

test("la corrección de Slack explica ubicación de respuestas y eliminación sin borrar historial",()=>{
    const note=releaseNotes.find(row=>row.id==="2026-11-07-slack-support-placement-channel-removal");
    assert.equal(note.id,"2026-11-07-slack-support-placement-channel-removal");
    const text=note.sections.flatMap(section=>section.items).join(' ');
    assert.match(text,/sin crear un hilo/);
    assert.match(text,/mismo hilo/);
    assert.match(text,/Configurar canal/);
    assert.match(text,/archivos se conservan/);
    assert.match(text,/servidores de departamento siguen protegidos/);
});

test("la recuperación de invitaciones mantiene los canales autorizados y la revocación",()=>{
    const note=releaseNotes.find(row=>row.id==="2026-11-07-slack-invitation-access-recovery");
    assert.equal(note.id,"2026-11-07-slack-invitation-access-recovery");
    const text=note.sections.flatMap(section=>section.items).join(' ');
    assert.match(text,/sin tener que cerrar sesión/);
    assert.match(text,/ya no vacía toda la vista/);
    assert.match(text,/respuestas atrasadas/);
    assert.match(text,/Leer y participar/);
    assert.match(text,/se retira tu acceso/);
});

test("la renovación MCP explica compatibilidad, plazo y revocación sin ampliar permisos",()=>{
    const note=releaseNotes.find(row=>row.id==="2026-11-07-mcp-persistent-renewal");
    assert.equal(note.id,"2026-11-07-mcp-persistent-renewal");
    const text=[note.summary,...note.sections.flatMap(section=>section.items)].join(' ');
    assert.match(text,/clientes MCP compatibles/);
    assert.match(text,/30 días desde la autorización inicial/);
    assert.match(text,/mismo usuario y equipo/);
    assert.match(text,/Cerrar explícitamente la sesión/);
    assert.match(text,/no amplía tus permisos/);
    assert.match(text,/clientes sin renovación conservan el límite de una hora/);
});

test("soporte BOLD prepara una nota sin anunciar un despliegue", () => {
    const [note] = pendingSupportReleaseNotes;
    assert.equal(pendingSupportReleaseNotes.length, 1);
    assert.equal(getReleaseNotes({chat_enabled:true}).some(row => row.id === note.id), false);
    assert.match(note.sections.flatMap(row => row.items).join(" "), /@soporte bold/);
    assert.match(note.sections.flatMap(row => row.items).join(" "), /Todavía sin despliegue/);
});

test("la nota MCP queda preparada fuera de las novedades publicadas", () => {
    assert.equal(pendingMcpReleaseNotes.length, 1);
    const note = pendingMcpReleaseNotes[0];
    assert.equal(getReleaseNotes({chat_enabled:true}).some(row => row.id === note.id), false);
    assert.ok(note.sections.every(section => section.title && section.items.length));
    assert.match(note.sections.flatMap(section => section.items).join(" "), /activación y despliegue/);
});

test("las cinco mejoras generales publicadas incluyen qué probar",()=>{
    assert.equal(multitaskingReleaseNotes.length,5);
    assert.deepEqual(releaseNotes.filter(note => multitaskingReleaseNotes.includes(note)),multitaskingReleaseNotes);
    for(const note of multitaskingReleaseNotes){
        assert.equal(getReleaseNotes({chat_enabled:false}).some(row=>row.id===note.id),true);
        assert.equal(note.date,"2026-10-30");
        assert.ok(note.sections.some(section=>section.title==="Qué probar"));
        assert.notEqual(note.category,"En revisión");
    }
    const background=multitaskingReleaseNotes.find(note=>note.id==="2026-10-30-background-device-notifications");
    assert.match(background.sections.flatMap(section=>section.items).join(" "),/completamente cerrada aún no está habilitada/);
});

test("las siete funciones publicadas se ofrecen a toda la organización conservando sus IDs",()=>{
    assert.equal(messagingReleaseNotes.length,7);
    for(const assignment of [undefined,null,{}, {chat_enabled:false},{chat_enabled:true},{chat_enabled:"true"},{unit_name:"Marketing"},{account_is_superuser:true}]){
        assert.deepEqual(getReleaseNotes(assignment),releaseNotes);
    }
    const notes=getReleaseNotes({id:"marketing",chat_enabled:true});
    assert.equal(new Set(notes.map(note=>note.id)).size,notes.length);
    for(const note of messagingReleaseNotes){
        assert.equal(note.date,"2026-10-30");assert.match(note.id,/^2026-10-30-it-/);
        assert.notEqual(note.category,"Piloto IT");
        assert.ok(note.title && note.summary && note.sections.length>=3);
        assert.ok(note.sections.some(section=>section.title==="Qué probar"));
        for(const section of note.sections)assert.ok(section.title && section.items.every(item=>typeof item==="string" && item.trim()));
        assert.equal(releaseNotes.some(row=>row.id===note.id),true);
    }
});

test("las notas preparadas del piloto conservan el formato sin publicarse",()=>{
    assert.ok(pendingPilotReleaseNotes.length>0);
    for(const note of pendingPilotReleaseNotes){
        assert.equal(releaseNotes.some(row=>row.id===note.id),false);
        assert.equal(note.category,"Piloto IT");assert.match(note.date,/^\d{4}-\d{2}-\d{2}$/);
        assert.ok(note.title && note.summary && note.icon && note.sections.every(section=>section.title && section.items.length));
    }
});

test("el lanzamiento reemplaza las referencias vigentes al piloto sin publicar borradores antiguos", () => {
    const launch=releaseNotes.find(note=>note.id==="2026-11-06-chat-slack-organization-launch");
    assert.equal(launch.id,"2026-11-06-chat-slack-organization-launch");
    assert.equal(launch.date,"2026-11-06");
    assert.match(launch.summary,/dejan de ser un piloto/);
    for(const note of releaseNotes.filter(note=>note.id!==launch.id && note.id!=="2026-10-19-sheets-it-pilot")){
        assert.doesNotMatch(JSON.stringify([note.category,note.title,note.summary,note.sections]),/piloto|Solo IT|solo para IT|únicamente para el departamento de IT/i);
    }
    assert.equal(releaseNotes.some(note => ["2026-10-19-live-messaging-receipts", "2026-10-19-direct-messaging-foundation"].includes(note.id)), false);
    assert.ok(releaseNotes.some(note => note.id === "2026-10-19-notification-push-recovery"));
});

test("las notas conservan campos completos, identificadores únicos y fechas válidas", () => {
    assert.ok(releaseNotes.length > 0);
    assert.equal(new Set(releaseNotes.map(note => note.id)).size, releaseNotes.length);
    for (const note of releaseNotes) {
        for (const key of ["id", "date", "category", "icon", "title", "summary"]) {
            assert.equal(typeof note[key], "string", `${note.id}: ${key}`);
            assert.ok(note[key].trim(), `${note.id}: ${key} vacío`);
        }
        assert.match(note.date, /^\d{4}-\d{2}-\d{2}$/);
        assert.equal(new Date(`${note.date}T12:00:00Z`).toISOString().slice(0, 10), note.date);
        assert.ok(["keyboard", "bell", "profile", "update"].includes(note.icon));
        assert.ok(Array.isArray(note.sections) && note.sections.length > 0);
        const titles = note.sections.map(section => section.title);
        assert.equal(new Set(titles).size, titles.length);
        for (const section of note.sections) {
            assert.equal(typeof section.title, "string");
            assert.ok(section.title.trim());
            assert.ok(Array.isArray(section.items) && section.items.length > 0);
            assert.equal(new Set(section.items).size, section.items.length);
            for (const item of section.items) assert.ok(typeof item === "string" && item.trim());
        }
    }
});

test("la nota más reciente encabeza la lista y las fechas son descendentes", () => {
    for (let index = 1; index < releaseNotes.length; index++) {
        assert.ok(releaseNotes[index - 1].date >= releaseNotes[index].date);
    }
});

test("el historial publicado conserva sus identificadores para las novedades leídas", () => {
    const ids = new Set(releaseNotes.map(note => note.id));
    for (const id of ["2026-10-08-community-patch", "2026-10-05-major-update", "2026-10-05-shortcuts", "2026-10-05-notifications", "2026-10-05-profile"]) {
        assert.ok(ids.has(id), `Falta la nota histórica ${id}`);
    }
});


test("Informes y Etapas encabezan las novedades con sus límites y sin borradores",()=>{
    assert.equal(reportsReleaseNotes.length,2);
    assert.deepEqual(releaseNotes.slice(0,2),reportsReleaseNotes);
    for(const note of reportsReleaseNotes){assert.equal(note.date,'2026-11-11');assert.ok(releaseNotes.includes(note));assert.doesNotMatch(JSON.stringify(note),/pendiente de autorización|Nota preparada localmente/);}
    assert.match(reportsReleaseNotes[0].sections.flatMap(section=>section.items).join(' '),/no importa el calendario personal de Google/);
});
