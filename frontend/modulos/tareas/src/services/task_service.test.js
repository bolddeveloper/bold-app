import test from "node:test";
import assert from "node:assert/strict";
import { api } from "./tasks_api.js";
import { saveTaskDraft } from "./task_service.js";
const statuses = [{ id: "s1", unitId: "u1", label: "Pendiente", isFinal: false }, { id: "s2", unitId: "u2", label: "Destino", isFinal: false }];
const data = { statuses, tasks: [], followers: [] };
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
    try {
        await assert.rejects(saveTaskDraft(draft, data), error => {
            assert.equal(error.partialDraft.id, "server-1");
            assert.equal(error.partialDraft.subtasks[0].id, "server-2");
            assert.equal(draft.subtasks[0].id, "temporary");
            return true;
        });
    } finally { Object.assign(api, original); }
});
