import test from "node:test";
import assert from "node:assert/strict";
import { api } from "./tasks_api.js";
import { loadTaskData, saveTaskDraft } from "./task_service.js";
const statuses = [{ id: "s1", unitId: "u1", label: "Pendiente", isFinal: false }, { id: "s2", unitId: "u2", label: "Destino", isFinal: false }];
const data = { statuses, tasks: [], followers: [] };
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
