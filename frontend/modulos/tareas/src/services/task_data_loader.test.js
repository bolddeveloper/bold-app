import test from "node:test";
import assert from "node:assert/strict";
import { createTaskDataLoader, resourcesForTaskEvent, TASK_RESOURCES } from "./task_data_loader.js";
import { createContextCache } from "../../../core/context_cache.js";
import { settleCommittedTaskChanges } from "./task_models.js";

const context = { directory: [{ id: "a", name: "Persona" }], units: [{ id: "u" }] };
test("unrelated, failed or pre-write reads cannot retire committed optimistic changes", () => {
    const mutations = new Map([["written", { committed: true }], ["saving", { committed: false }]]);
    settleCommittedTaskChanges(mutations, { reconciled: false, startedRevision: 2, currentRevision: 2 });
    assert.equal(mutations.size, 2);
    settleCommittedTaskChanges(mutations, { reconciled: true, startedRevision: 1, currentRevision: 2 });
    assert.equal(mutations.size, 2);
    settleCommittedTaskChanges(mutations, { reconciled: true, startedRevision: 2, currentRevision: 2 });
    assert.deepEqual([...mutations.keys()], ["saving"]);
});
function fixture() {
    const rows = {
        tasks: [{ id: "t1", unit: "u", status: "s", title: "Primera" }, { id: "t2", unit: "u", status: "s", title: "Segunda" }],
        "task-statuses": [{ id: "s", unit: "u", name: "Pendiente" }],
        comments: [{ id: "c1", task: "t1", author_assignment: "a", body: "Anterior" }],
        projects: [{ id: "p", unit: "u", name: "Proyecto" }],
        "task-projects": [{ id: "l1", task: "t1", project: "p" }],
        "task-followers": [{ id: "f", task: "t1", assignment: "a" }],
        notifications: [{ id: "n", task: "t1", title: "Aviso", created_at: "2026-10-01T00:00:00Z", is_read: false }],
    };
    const calls = [];
    const client = { async list(resource, params) {
        calls.push({ resource, params });
        const ids = (params?.ids || params?.tasks)?.split(",");
        return structuredClone((rows[resource] || []).filter(row => !ids || ids.includes(resource === "tasks" ? row.id : row.task)));
    } };
    const loader = createTaskDataLoader(context, { client, notificationClient: { list: () => client.list("notifications") } });
    return { rows, calls, client, loader };
}
test("a comment fetches only its authorized task comments and preserves unrelated tasks/totals", async () => {
    const { rows, calls, loader } = fixture(); const first = await loader.load(); calls.length = 0;
    rows.comments.push({ id: "c2", task: "t1", author_assignment: "a", body: "Nuevo" });
    const next = await loader.load(resourcesForTaskEvent({ event_type: "comment.created", entity_type: "comment", entity_id: "c2", payload: { task: "t1", body: "UNTRUSTED" } }));
    assert.deepEqual(calls, [{ resource: "comments", params: { tasks: "t1" } }]);
    assert.equal(next.tasks.length, 2); assert.equal(next.tasks[0].comments[1].body, "Nuevo");
    assert.equal(next.tasks[1], first.tasks[1]); assert.equal(next.projects, first.projects);
    assert.equal(next.notifications, first.notifications);
});
test("a notification does not load tasks, catalogs or project relations", async () => {
    const { rows, calls, loader } = fixture(); const first = await loader.load(); calls.length = 0;
    rows.notifications[0].is_read = true;
    const next = await loader.load(["notifications"]);
    assert.deepEqual(calls.map(call => call.resource), ["notifications"]);
    assert.equal(next.notifications[0].is_read, true); assert.equal(next.tasks[0], first.tasks[0]);
});
test("catalog changes refresh only the indicated unit and keep catalogs of other units", async () => {
    const calls = [];
    const client = { async list(resource, params) {
        calls.push({ resource, params });
        return resource === "task-statuses" ? params.units.split(",").map(unit => ({ id: `s-${unit}`, unit, name: "Estado" })) : [];
    } };
    const loader = createTaskDataLoader({ directory: [], units: [{ id: "u1" }, { id: "u2" }] }, { client, notificationClient: { list: async () => [] } });
    await loader.load(); calls.length = 0;
    const next = await loader.load(resourcesForTaskEvent({ event_type: "catalog.changed", payload: { units: ["u1", "u1"] } }));
    assert.deepEqual(calls, [{ resource: "task-statuses", params: { units: "u1" } }, { resource: "tags", params: { units: "u1" } }]);
    assert.equal(next.statuses.length, 2);
});
test("relation and project invalidations use their own resource groups", () => {
    assert.deepEqual(resourcesForTaskEvent({ event_type: "attachment.changed", payload: { tasks: ["t1", "t2", "t1"] } }), ["attachments@t1", "attachments@t2"]);
    assert.deepEqual(resourcesForTaskEvent({ event_type: "project.changed" }), ["projects", "sections", "members", "links"]);
});
test("updating a child preserves unaffected objects and updates its parent's subtree", async () => {
    const { rows, loader } = fixture(); rows.tasks[1].parent_task = "t1";
    const first = await loader.load(); rows.tasks[1].title = "Subtarea editada";
    const next = await loader.load(["tasks@t2"]);
    assert.notEqual(next.tasks[0], first.tasks[0]);
    assert.equal(next.tasks[0].subtasks[0], next.tasks[1]);
    assert.equal(next.tasks[0].subtasks[0].title, "Subtarea editada");
    assert.deepEqual(next.tasks.map(task => task.id), ["t1", "t2"]);
});
test("a removed or no-longer-visible task is pruned with its old relations", async () => {
    const { rows, calls, loader } = fixture(); await loader.load(); calls.length = 0;
    rows.tasks = rows.tasks.filter(task => task.id !== "t1");
    const next = await loader.load(resourcesForTaskEvent({ event_type: "task.deleted", entity_type: "task", entity_id: "t1" }));
    assert.deepEqual(calls.map(call => call.resource).sort(), ["task-projects", "tasks"]);
    assert.deepEqual(next.tasks.map(task => task.id), ["t2"]); assert.deepEqual(next.links, []); assert.deepEqual(next.followers, []);
});
test("project deletion prunes stale links without deleting tasks or their totals", async () => {
    const { rows, loader } = fixture(); await loader.load(); rows.projects = [];
    const next = await loader.load(["projects"]);
    assert.equal(next.tasks.length, 2); assert.deepEqual(next.links, []);
    assert.deepEqual(next.tasks[0].taskProjects, []);
});
test("coalesced status/update events query one task and its links without catalogs", async () => {
    const { rows, calls, loader } = fixture(); await loader.load(); calls.length = 0;
    rows.tasks[0].title = "Último estado";
    const event = { entity_type: "task", entity_id: "t1" };
    const next = await loader.load([...resourcesForTaskEvent({ ...event, event_type: "task.updated" }), ...resourcesForTaskEvent({ ...event, event_type: "task.status_changed" })]);
    assert.equal(calls.length, 2); assert.equal(next.tasks[0].title, "Último estado");
});
test("failed rounds are atomic and clear rejects responses from an old authorization generation", async () => {
    const { rows, client, loader } = fixture(); await loader.load();
    const original = client.list; let release;
    client.list = async (resource, params) => resource === "tasks" ? new Promise(resolve => { release = resolve; }) : original(resource, params);
    const pending = loader.load(["tasks@t1"]); loader.clear(); release([rows.tasks[0]]);
    await assert.rejects(pending, { name: "AbortError" });
    client.list = original; rows.tasks = [];
    assert.deepEqual((await loader.load(["notifications"])).tasks, []); // clear forces a full new scope
});
test("failed relation fetch does not publish a partially updated task", async () => {
    const { rows, client, loader } = fixture(); await loader.load(); const original = client.list;
    rows.tasks[0].title = "Changed";
    client.list = (resource, params) => resource === "comments" ? Promise.reject(new Error("offline")) : original(resource, params);
    await assert.rejects(loader.load(["tasks@t1", "comments@t1"]), /offline/);
    client.list = original;
    assert.equal((await loader.load(["notifications"])).tasks[0].title, "Primera");
});
test("50-ID batching is bounded and global-resource requests dominate their scoped variants", async () => {
    const { calls, loader } = fixture(); await loader.load(); calls.length = 0;
    await loader.load(Array.from({ length: 51 }, (_, i) => `comments@t${i}`));
    assert.equal(calls.length, 2); assert.equal(calls[0].params.tasks.split(",").length, 50);
    calls.length = 0; await loader.load(["tasks@t1", "tasks", "tasks@t2"]);
    assert.equal(calls.length, 1); assert.equal(calls[0].params, undefined);
    assert.deepEqual(resourcesForTaskEvent({ event_type: "unrecognized" }), TASK_RESOURCES);
});
test("phase 3 reference hour stays below 250 including 60 healthy permission reads", async () => {
    const previousFetch = globalThis.fetch; let calls = 0, now = 0;
    globalThis.fetch = async address => {
        calls++; const url = new URL(address), resource = url.pathname.split("/").filter(Boolean).at(-1);
        const page = Number(url.searchParams.get("page") || 1);
        const total = resource === "project-members" ? 29 : resource === "task-statuses" ? 65 : 0;
        const results = Array.from({ length: Math.max(0, Math.min(25, total - (page - 1) * 25)) }, (_, i) => ({ id: `${resource}-${(page - 1) * 25 + i}` }));
        url.searchParams.set("page", String(page + 1));
        return Response.json({ results, next: page * 25 < total ? url.href : null });
    };
    try {
        const loader = createTaskDataLoader({ directory: [], units: Array.from({ length: 13 }, (_, i) => ({ id: `u${i}` })) }, { catalogCache: createContextCache({ now: () => now }) });
        await loader.load(); assert.equal(calls, 15); calls = 0;
        for (let minute = 5; minute <= 60; minute += 5) { now = minute * 60_000; await loader.load(); }
        assert.equal(calls, 148); assert.equal(calls + 60, 208); assert.ok(calls + 60 <= 250);
    } finally { globalThis.fetch = previousFetch; }
});
