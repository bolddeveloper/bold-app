import test from "node:test";
import assert from "node:assert/strict";
import { createTaskEditLoader } from "./task_attachments.js";
import { createPagedComments } from "./paged_comments.js";
import { createTasksApi } from "./tasks_api.js";
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test("attachment detail requests one page with true count, never all pages automatically", async () => {
    const calls = [];
    const pages = createPagedComments({ resource: "attachments", queries: [{ tasks: "task", recent: "1" }],
        listPage: async (...args) => { calls.push(args); return { results: Array.from({ length: 25 }, (_, id) => ({ id, task: "task" })), count: 5000, next: "next" }; } });
    await pages.refresh();
    assert.equal(calls.length, 1); assert.equal(calls[0][0], "attachments");
    assert.equal(pages.snapshot().count, 5000); assert.equal(pages.snapshot().rows.length, 25);
    pages.dispose();
});

test("editor loads complete baseline only for one task and preserves description and subtree", async () => {
    const calls = [], files = Array.from({ length: 63 }, (_, id) => ({ id: `f${id}`, task: "task", file_name: "File", file_url: "https://example.com" }));
    const loader = createTaskEditLoader({ list: async (...args) => { calls.push(args); return files; } });
    const task = { id: "task", description: "Searchable text", subtasks: [{ id: "child" }], attachmentsLoaded: false };
    const loaded = await loader.load(task);
    assert.equal(calls.length, 1); assert.deepEqual(calls[0].slice(0, 2), ["attachments", { tasks: "task", recent: "1" }]);
    assert.equal(loaded.attachmentBaseline.length, 63); assert.equal(loaded.attachmentsLoaded, true);
    assert.equal(loaded.description, task.description); assert.equal(loaded.subtasks, task.subtasks);
    assert.equal(task.attachmentsLoaded, false);
});

test("editor coalesces duplicate opening and cancels late data on context change", async () => {
    const reading = deferred(), calls = [];
    const loader = createTaskEditLoader({ list: (...args) => { calls.push(args); return reading.promise; } });
    const one = loader.load({ id: "one" });
    assert.equal(loader.load({ id: "one" }), one); assert.equal(calls.length, 1);
    loader.cancel(); assert.equal(calls[0][2].signal.aborted, true);
    const rejected = assert.rejects(one, { name: "AbortError" });
    reading.resolve([{ id: "f", task: "one" }]); await rejected;
});

test("editor rejects foreign, deleted and duplicated attachment rows", async () => {
    for (const rows of [[{ id: "f", task: "foreign" }], [{ id: "f", task: "task", deleted_at: "now" }], [{ id: "f", task: "task" }, { id: "f", task: "task" }]]) {
        const loader = createTaskEditLoader({ list: async () => rows });
        await assert.rejects(loader.load({ id: "task" }), /no pertenece/);
    }
});

test("task list composes editor-local abort with module abort", async () => {
    let signal;
    const api = createTasksApi({ list: async (_, __, options) => { signal = options.signal; return []; } });
    const local = new AbortController();
    await api.list("attachments", { tasks: "task" }, { signal: local.signal });
    local.abort(); assert.equal(signal.aborted, true);
    await api.list("attachments", { tasks: "task" }); api.cancelRequests(); assert.equal(signal.aborted, true);
});
