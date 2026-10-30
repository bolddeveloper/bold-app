import assert from "node:assert/strict";
import test from "node:test";
import {pendingPilotReleaseNotes,multitaskingReleaseNotes,releaseNotes,itPilotReleaseNotes,getReleaseNotes} from "./release_notes.js";

test("las cinco mejoras generales publicadas incluyen qué probar sin abrir el piloto",()=>{
    assert.equal(multitaskingReleaseNotes.length,5);
    assert.deepEqual(releaseNotes.slice(0,5),multitaskingReleaseNotes);
    for(const note of multitaskingReleaseNotes){
        assert.equal(getReleaseNotes({chat_enabled:false}).some(row=>row.id===note.id),true);
        assert.equal(note.date,"2026-10-30");
        assert.ok(note.sections.some(section=>section.title==="Qué probar"));
        assert.notEqual(note.category,"En revisión");
    }
    const background=multitaskingReleaseNotes.find(note=>note.id==="2026-10-30-background-device-notifications");
    assert.match(background.sections.flatMap(section=>section.items).join(" "),/completamente cerrada aún no está habilitada/);
});

test("las siete novedades del 30 de octubre solo se ofrecen a la asignación piloto habilitada",()=>{
    assert.equal(itPilotReleaseNotes.length,7);
    for(const assignment of [undefined,null,{}, {chat_enabled:false},{chat_enabled:"true"},{unit_name:"IT"},{account_is_superuser:true}]){
        assert.deepEqual(getReleaseNotes(assignment),releaseNotes);
    }
    const notes=getReleaseNotes({id:"it",chat_enabled:true});
    assert.deepEqual(notes,[...itPilotReleaseNotes,...releaseNotes]);
    assert.equal(new Set(notes.map(note=>note.id)).size,notes.length);
    for(const note of itPilotReleaseNotes){
        assert.equal(note.date,"2026-10-30");assert.equal(note.category,"Piloto IT");
        assert.ok(note.title && note.summary && note.sections.length>=3);
        assert.ok(note.sections.some(section=>section.title==="Qué probar"));
        for(const section of note.sections)assert.ok(section.title && section.items.every(item=>typeof item==="string" && item.trim()));
        assert.equal(releaseNotes.some(row=>row.id===note.id),false);
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

test("el chat piloto no se anuncia como lanzamiento público", () => {
    assert.equal(releaseNotes.some(note => ["2026-10-19-live-messaging-receipts", "2026-10-19-direct-messaging-foundation"].includes(note.id)), false);
    assert.ok(releaseNotes.some(note => note.id === "2026-10-19-notification-push-recovery"));
});

test("las notas conservan campos completos, identificadores únicos y fechas válidas", () => {
    assert.ok(releaseNotes.length > 0);
    assert.equal(new Set(releaseNotes.map(note => note.id)).size, releaseNotes.length);
    for (const note of [...itPilotReleaseNotes,...releaseNotes]) {
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
