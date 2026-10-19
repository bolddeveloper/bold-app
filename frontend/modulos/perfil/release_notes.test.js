import assert from "node:assert/strict";
import test from "node:test";
import {releaseNotes} from "./release_notes.js";

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
