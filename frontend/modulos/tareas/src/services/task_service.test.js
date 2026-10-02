import test from "node:test";
import assert from "node:assert/strict";
import { api } from "./tasks_api.js";
import { loadTaskData, saveTaskDraft } from "./task_service.js";
import { createContextCache } from "../../../core/context_cache.js";
const statuses = [{ id: "s1", unitId: "u1", label: "Pendiente", isFinal: false }, { id: "s2", unitId: "u2", label: "Destino", isFinal: false }];
const data = { statuses, tasks: [], followers: [] };
test("an unloaded attachment list cannot be saved before baseline is loaded", async () => {
    const old = api.updateTask; let writes = 0;
    api.updateTask = async () => { writes++; };
    try {
        await assert.rejects(saveTaskDraft({ title: "Task", unitId: "u1", status: "Pendiente", attachments: [] }, data,
            { id: "t", unitId: "u1", attachments: [], attachmentsLoaded: false }), /Carga los adjuntos completos/);
        assert.equal(writes, 0);
    } finally { api.updateTask = old; }
});
test("editing deferred attachments deletes only explicitly removed baseline files", async () => {
    const old = { updateTask: api.updateTask, create: api.create, remove: api.remove }, removed = [];
    api.updateTask = async () => ({ id: "t", unit: "u1" });
    api.create = async () => { throw new Error("Kept files must not be recreated"); };
    api.remove = async (resource, id) => removed.push([resource, id]);
    try {
        await saveTaskDraft({ title: "Task", unitId: "u1", status: "Pendiente",
            attachmentBaseline: [{ id: "keep" }, { id: "remove" }], attachments: [{ id: "keep" }] }, data,
            { id: "t", unitId: "u1", attachmentsLoaded: false, attachments: [] });
        assert.deepEqual(removed, [["attachments", "remove"]]); // unseen concurrent files are not deletion candidates
    } finally { Object.assign(api, old); }
});
test("acknowledged attachment creates and deletions are not repeated after partial failure", async () => {
    const old = { updateTask: api.updateTask, create: api.create, remove: api.remove }, removed = [], created = [];
    api.updateTask = async () => ({ id: "t", unit: "u1" });
    api.create = async (_, body) => { created.push(body.file_name); return { id: "server-new" }; };
    let fail = true;
    api.remove = async (_, id) => { if (id === "remove2" && fail) { fail = false; throw new Error("Temporary failure"); } removed.push(id); };
    const original = { id: "t", unitId: "u1", attachmentsLoaded: false, attachments: [] };
    let retry;
    try {
        await assert.rejects(saveTaskDraft({ title: "Task", unitId: "u1", status: "Pendiente", attachmentBaseline: [{ id: "remove1" }, { id: "remove2" }],
            attachments: [{ id: "local-new", name: "New", url: "https://example.com/file" }] }, data, original), error => { retry = error.partialDraft; return true; });
        assert.deepEqual(retry.attachmentBaseline.map(item => item.id).sort(), ["remove2", "server-new"]);
        await saveTaskDraft(retry, data, original);
        assert.deepEqual(created, ["New"]); assert.deepEqual(removed, ["remove1", "remove2"]);
    } finally { Object.assign(api, old); }
});
test("reference bootstrap with 13 units and 29 project members costs 37 requests", async () => {
    const previousFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async address => {
        const url = new URL(address), resource = url.pathname.split("/").filter(Boolean).at(-1);
        calls.push(resource);
        const page = Number(url.searchParams.get("page") || 1), total = resource === "project-members" ? 29 : 0;
        const rows = Array.from({ length: Math.max(0, Math.min(25, total - (page - 1) * 25)) }, (_, i) => ({ id: `m${(page - 1) * 25 + i}` }));
        url.searchParams.set("page", String(page + 1));
        return Response.json({ results: rows, next: page * 25 < total ? url.href : null });
    };
    try {
        await loadTaskData({ directory: [], units: Array.from({ length: 13 }, (_, i) => ({ id: `u${i}` })) });
        assert.equal(calls.length, 37);
        assert.equal(calls.filter(resource => resource === "task-statuses").length, 13);
        assert.equal(calls.filter(resource => resource === "tags").length, 13);
    } finally { globalThis.fetch = previousFetch; }
});
test("an hour of five-minute reconciliation reuses catalogs and stays within containment budget", async () => {
    const previousFetch = globalThis.fetch; let calls = 0, now = 0;
    globalThis.fetch = async address => {
        calls++;
        const url = new URL(address), resource = url.pathname.split("/").filter(Boolean).at(-1);
        const page = Number(url.searchParams.get("page") || 1), total = resource === "project-members" ? 29 : 0;
        const results = Array.from({ length: Math.max(0, Math.min(25, total - (page - 1) * 25)) }, (_, i) => ({ id: `m${i}` }));
        url.searchParams.set("page", String(page + 1));
        return Response.json({ results, next: page * 25 < total ? url.href : null });
    };
    try {
        const context = { directory: [], units: Array.from({ length: 13 }, (_, i) => ({ id: `u${i}` })) };
        const catalogCache = createContextCache({ now: () => now });
        await loadTaskData(context, { catalogCache }); assert.equal(calls, 37);
        calls = 0;
        for (let minute = 5; minute <= 60; minute += 5) { now = minute * 60_000; await loadTaskData(context, { catalogCache }); }
        assert.equal(calls, 236);
        assert.equal(calls + 720, 956); // Legacy/degraded control retains the conservative 5s fallback.
        assert.ok(calls + 720 <= 1250);
        assert.equal(calls + 60, 296); // phase 2 stable-hour reference, not live telemetry
    } finally { globalThis.fetch = previousFetch; }
});
test("creating a task does not duplicate the creator follower added by the API", async () => {
    const original = { createTask: api.createTask, create: api.create };
    const followers = [];
    api.createTask = async body => {
        if (body.follow_creator) followers.push("creator");
        return { id: "task-1", unit: body.unit };
    };
    api.create = async (resource, body) => {
        if (resource === "task-followers") followers.push(body.assignment);
        return { id: "follower-1" };
    };
    try {
        await saveTaskDraft({ title: "Sin proyecto", unitId: "u1", status: "Pendiente",
            created_by_assignment: "creator", follow_creator: true,
            collaborator_ids: ["creator", "other"] }, data);
        assert.deepEqual(followers, ["creator", "other"]);
    } finally { Object.assign(api, original); }
});
test("task creation creates the project atomically and persists subtasks separately", async () => {
    const original = { createTask: api.createTask, create: api.create };
    const calls = [];
    api.createTask = async body => { calls.push(body); return { id: `task-${calls.length}`, unit: body.unit }; };
    api.create = async () => { throw new Error("An extra project link must not be created"); };
    try {
        await saveTaskDraft({ title: "Parent", unitId: "u1", project_id: "p", section: "section", status: "Pendiente", subtasks: [{ id: "temporary", title: "Child" }] }, data);
        assert.equal(calls.length, 2); assert.equal(calls[0].project, "p"); assert.equal(calls[0].section, "section");
        assert.equal(calls[1].parent_task, "task-1"); assert.equal(calls[1].project, undefined);
    } finally { Object.assign(api, original); }
});
test("unit handoff uses move before the ordinary patch and retains project links", async () => {
    const original = { moveTask: api.moveTask, updateTask: api.updateTask };
    const calls = [];
    api.moveTask = async (id, body) => { calls.push(["move", body]); };
    api.updateTask = async (id, body) => { calls.push(["patch", body]); return { id, unit: "u2" }; };
    try {
        await saveTaskDraft({ title: "Task", unitId: "u2", status: "Destino", assignee_id: "a2" }, data, { id: "t", unitId: "u1", taskProjects: [{ projectId: "p" }] });
        assert.deepEqual(calls[0], ["move", { unit: "u2", status: "s2", assignee_assignment: "a2" }]);
        assert.equal(calls[1][0], "patch"); assert.equal(calls[1][1].unit, undefined);
    } finally { Object.assign(api, original); }
});
test("partial saves retain server IDs so retry cannot duplicate parent or successful children", async () => {
    const original = { createTask: api.createTask, create: api.create };
    let created = 0;
    api.createTask = async body => ({ id: `server-${++created}`, unit: body.unit });
    api.create = async () => { throw new Error("Follower rejected"); };
    const draft = { title: "Parent", unitId: "u1", status: "Pendiente", collaborator_ids: ["follower"], subtasks: [{ id: "temporary", title: "Child" }] };
    const createdIds = [];
    try {
        await assert.rejects(saveTaskDraft(draft, data, null, { onCreated: dto => createdIds.push(dto.id) }), error => {
            assert.equal(error.partialDraft.id, "server-1");
            assert.equal(error.partialDraft.subtasks[0].id, "server-2");
            assert.equal(draft.subtasks[0].id, "temporary");
            return true;
        });
        assert.deepEqual(createdIds, ["server-1"]);
    } finally { Object.assign(api, original); }
});
