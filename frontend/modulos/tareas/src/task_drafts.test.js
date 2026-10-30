import test from "node:test";
import assert from "node:assert/strict";
import {createTaskDraftController} from "./task_drafts.js";
import {createDraftVault} from "../../mensajeria/draft_vault.js";

function fixture() {
    const records = new Map(), timers = new Map(); let next = 0, key = "a";
    const storage = {get: async id => records.get(id), put: async row => {records.set(row.id, row); return true;},
        remove: async id => records.delete(id), purge: async predicate => {for (const [id, row] of records) if (predicate(row)) records.delete(id);}};
    const vault = createDraftVault({storage}), scope = {account_id: "account-a", assignment_id: "assignment-a", kind: "task-create", resource_id: "assignment-a"};
    let grants = 0;
    const open = () => vault.open(scope, async () => {grants++; return {scope, key: btoa(key.repeat(32)), key_id: key.repeat(32), retention_seconds: 604800, can_write: true};});
    return {records, timers, vault, get grants() {return grants;}, rotate: () => {key = "b";},
        controller: onStatus => createTaskDraftController({open, onStatus, schedule: callback => {const id = ++next; timers.set(id, callback); return id;}, cancel: id => timers.delete(id)})};
}

test("creation draft with description, inline image, audio, collaborators and attachments survives reopening after keys are suspended", async () => {
    const s = fixture(), first = s.controller(); await first.ready;
    const draft = {_draft_id: "one", title: "Trabajo privado", description: '<!--bold-rich-text--><p>Texto</p><img src="data:image/png;base64,aQ==">',
        voice_notes: [{id: "local-audio", data_url: "data:audio/webm;base64,aQ=="}], collaborator_ids: ["person-a"],
        attachments: [{name: "Guía", url: "https://example.com/guia"}], subtasks: [{id: "child", title: "Revisar"}], section: "section-a"};
    first.update(draft); assert.equal(first.isProtected(), false);
    assert.equal(await first.flush(), true); assert.equal(first.isProtected(), true);
    const stored = [...s.records.values()][0];
    assert.doesNotMatch(JSON.stringify(stored), /Trabajo privado|person-a|data:image|Guía/);
    s.vault.suspend(); assert.equal(first.isProtected(), false);
    const second = s.controller(); assert.deepEqual(await second.ready, draft); assert.equal(s.grants, 2);
    assert.equal(await second.flush(), true); first.close(); second.close();
});

test("typing coalesces writes; in-flight encryption never counts as protected and later text wins", async () => {
    const s = fixture(), controller = s.controller(); await controller.ready;
    for (const title of ["a", "ab", "abc"]) controller.update({title});
    assert.equal(s.timers.size, 1); assert.equal(s.records.size, 0);
    const pending = controller.flush(); assert.equal(controller.isProtected(), false);
    await Promise.resolve();
    controller.update({title: "abcd"}); await pending;
    assert.equal(controller.isProtected(), false);
    await controller.flush(); assert.equal(controller.isProtected(), true);
    const recovered = s.controller(); assert.deepEqual(await recovered.ready, {title: "abcd"});
    controller.close(); recovered.close();
});

test("discard cannot resurrect a draft on close; credential rotation makes old ciphertext unrecoverable", async () => {
    const s = fixture(), controller = s.controller(); await controller.ready;
    controller.update({_draft_id: "one", title: "Conservar"}); await controller.flush();
    await controller.discard(); controller.update({title: "Must not return"}); controller.close();
    await new Promise(resolve => setImmediate(resolve)); assert.equal(s.records.size, 0);
    const again = s.controller(); await again.ready; again.update({title: "Old credential"}); await again.flush();
    s.vault.suspend(); s.rotate();
    const rotated = s.controller(); assert.equal(await rotated.ready, null); assert.equal(s.records.size, 0);
    again.close(); rotated.close();
});

test("failed storage cannot claim protection; explicit flush retries without losing the draft", async () => {
    let saved = false, active = true, attempts = 0;
    const controller = createTaskDraftController({open: async () => ({isActive: () => active, recover: async () => null,
        save: async value => {attempts++; if (attempts === 1) throw new Error("quota"); saved = value; return true;}, clear: async () => {}, close: () => {active = false;}})});
    await controller.ready; controller.update({title: "Último cambio"});
    assert.equal(await controller.flush(), false); assert.equal(controller.isProtected(), false);
    assert.equal(await controller.flush(), true); assert.deepEqual(saved, {title: "Último cambio"}); controller.close();
});

test("closing a form returns its final pending write and cannot accept changes after closure begins", async () => {
    let finish, value, active = true;
    const controller = createTaskDraftController({open: async () => ({isActive: () => active, recover: async () => null,
        save: next => new Promise(resolve => {value = next; finish = () => resolve(true);}),
        clear: async () => {}, close: () => {active = false;}})});
    await controller.ready; controller.update({title: "Última letra antes de cambiar de módulo"});
    const closing = controller.close();
    assert.equal(controller.close(), closing, "Every exit guard must wait for the same final write");
    controller.update({title: "Late unmounted change"});
    await Promise.resolve(); assert.equal(active, true);
    assert.equal(value.title, "Última letra antes de cambiar de módulo");
    finish(); assert.equal(await closing, true); assert.equal(active, false);
});

test("a suspended key requires a fresh grant and preserves newer local text instead of restoring an older checkpoint", async () => {
    const s = fixture(), controller = s.controller(); await controller.ready;
    controller.update({title: "Antes de reconectar"}); await controller.flush();
    s.vault.suspend(); controller.update({title: "Último texto durante reconexión"});
    assert.equal(controller.isProtected(), false);
    assert.equal(await controller.flush(), true); assert.equal(s.grants, 2);
    const reopened = s.controller(); assert.deepEqual(await reopened.ready, {title: "Último texto durante reconexión"});
    await controller.close(); await reopened.close();
});
