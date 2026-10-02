import test from "node:test";
import assert from "node:assert/strict";
import { createTaskEditLoader } from "./task_attachments.js";
import { createPagedComments } from "./paged_comments.js";
import { createTasksApi } from "./tasks_api.js";
import { createHttpClient } from "../../../core/http_client.js";
import { createTaskDataLoader } from "./task_data_loader.js";
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test("HTTP fixture: 5000 files cost 200 bootstrap pages before, zero after, one detail page", async () => {
    let reads = 0;
    const client = createTasksApi(createHttpClient({ baseUrl: "https://fixture.invalid", fetchImpl: async address => {
        const url = new URL(address), resource = url.pathname.split("/").filter(Boolean).at(-1);
        let results = [], count = 0, next = null;
        if (resource === "tasks") { results = [{ id: "task", title: "Task", unit: "unit", status: "status", attachment_count: 5000 }]; count = 1; }
        if (resource === "task-statuses") { results = [{ id: "status", unit: "unit", name: "Pending" }]; count = 1; }
        if (resource === "attachments") {
            reads++;
            const page = Number(url.searchParams.get("page") || 1); count = 5000;
            results = Array.from({ length: 25 }, (_, i) => ({ id: `file${(page - 1) * 25 + i}`, task: "task", file_name: "File", file_url: "https://example.com" }));
            if (page < 200) { url.searchParams.set("page", String(page + 1)); next = url.href; }
        }
        return Response.json({ results, count, next });
    } }));
    const context = { directory: [], units: [{ id: "unit" }] }, notificationClient = { list: async () => [] };
    await createTaskDataLoader(context, { client, notificationClient }).load(); assert.equal(reads, 200);
    reads = 0;
    const loader = createTaskDataLoader(context, { client, notificationClient, deferAttachments: true });
    await loader.load(); for (let poll = 0; poll < 12; poll++) await loader.load();
    assert.equal(reads, 0);
    const detail = createPagedComments({ resource: "attachments", queries: [{ tasks: "task", recent: "1" }], listPage: client.listPage });
    await detail.refresh(); assert.equal(reads, 1); assert.equal(detail.snapshot().rows.length, 25); assert.equal(detail.snapshot().count, 5000);
    for (let poll = 0; poll < 12; poll++) await detail.refresh(); assert.equal(reads, 13);
    detail.dispose();
    reads = 0;
    const editing = await createTaskEditLoader(client).load({ id: "task" });
    assert.equal(reads, 200); assert.equal(editing.attachmentBaseline.length, 5000);
});

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
