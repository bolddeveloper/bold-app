import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSessionNotifications } from "../../core/session_notifications.js";
import { entranceModule, historyModule, isShellModuleAllowed } from "../../core/shell_navigation_state.js";
import { requiresTaskData } from "./services/task_activity.js";

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const options = { coordinatorOptions: { delayMs: 0 } };
const refresh = store => store.refresh({ immediate: true });

test("cached notifications appear immediately and disappear when authorization becomes uncertain", async () => {
    const store = createSessionNotifications({...options, initialRows: [{id: "cached", is_read: false}], client: {list: async () => []}});
    assert.equal(store.getRows()[0].id, "cached");
    await store.invalidate({uncertain: true});
    assert.deepEqual(store.getRows(), []);
    store.dispose();
});

test("sibling views and validated saved navigation do not bootstrap Tareas", () => {
    for (const module of ["administration", "permissions", "suggestions", "calendar"]) assert.equal(requiresTaskData(module), false);
    for (const module of ["home", "tasks", "projects", "department_projects", "inbox", "workspaces", "reports"]) assert.equal(requiresTaskData(module), true);
    const navigation = [{ id: "home", default: true }, { id: "suggestions" }];
    assert.equal(entranceModule(navigation, "suggestions"), "suggestions");
    assert.equal(entranceModule(navigation, "administration"), "home");
    assert.equal(entranceModule(navigation, "unknown"), "home");
});

test("Core owns control independently of the Tareas data lifecycle", () => {
    const task = readFileSync(new URL("./task_app.jsx", import.meta.url), "utf8");
    const core = readFileSync(new URL("../../core/core_provider.jsx", import.meta.url), "utf8");
    assert.doesNotMatch(task, /connectNotificationStream|disconnectNotificationStream|notificationsApi/);
    assert.match(core, /createNotificationRealtime\(\)/);
    assert.match(core, /bold:control-message/);
    assert.match(core, /bold:permissions-revision/);
});

test("notification write response confirms optimistic UI without another GET", async () => {
    let reads = 0, posts = 0;
    const accepted = { id: "n", is_read: true, title: "Visible" };
    const store = createSessionNotifications({ ...options, client: {
        list: async () => { reads++; return [{ ...accepted, is_read: false }]; },
        request: async () => { posts++; return accepted; },
    } });
    try {
        await refresh(store); await store.setRead("n", true);
        assert.deepEqual(store.getRows(), [accepted]); assert.equal(reads, 1); assert.equal(posts, 1);
        await store.setRead("n", true); assert.equal(posts, 1);
    } finally { store.dispose(); }
});

test("rapid read/unread actions are serialized and the final desired state wins", async () => {
    const pending = [], paths = [];
    const store = createSessionNotifications({ ...options, client: {
        list: async () => [{ id: "n", is_read: false }],
        request: async path => { paths.push(path); const next = deferred(); pending.push(next); return next.promise; },
    } });
    try {
        await refresh(store);
        const write = store.setRead("n", true); store.setRead("n", false);
        assert.equal(paths.length, 1); assert.equal(store.getRows()[0].is_read, false);
        pending[0].resolve({ id: "n", is_read: true }); await tick();
        assert.equal(paths.length, 2); assert.match(paths[1], /mark-unread/);
        pending[1].resolve({ id: "n", is_read: false }); await write;
        assert.equal(store.getRows()[0].is_read, false);
    } finally { store.dispose(); }
});

test("late GET cannot undo a confirmed notification write", async () => {
    const delayed = deferred(); let reads = 0;
    const store = createSessionNotifications({ ...options, client: {
        list: () => ++reads === 1 ? Promise.resolve([{ id: "n", is_read: false }]) : delayed.promise,
        request: async () => ({ id: "n", is_read: true }),
    } });
    try {
        await refresh(store); await tick(); const read = refresh(store); await tick();
        await store.setRead("n", true); delayed.resolve([{ id: "n", is_read: false }, { id: "new", is_read: false }]); await read;
        assert.equal(store.getRows()[0].is_read, true);
        assert.equal(store.getRows()[1].id, "new");
    } finally { store.dispose(); }
});

test("authorization failure rolls back the read flag", async () => {
    const forbidden = Object.assign(new Error("Sin permiso"), { status: 403 });
    const store = createSessionNotifications({ ...options, client: {
        list: async () => [{ id: "n", is_read: false }], request: async () => { throw forbidden; },
    } });
    try {
        await refresh(store); await assert.rejects(store.setRead("n", true), error => error === forbidden);
        assert.equal(store.getRows()[0].is_read, false);
    } finally { store.dispose(); }
});

test("permission uncertainty purges hidden data and blocks old reads and writes", async () => {
    const delayed = deferred(); let reads = 0;
    const store = createSessionNotifications({ ...options, canRun: () => false, client: {
        list: () => { reads++; return delayed.promise; }, request: async () => { throw new Error("Must not write"); },
    } });
    try {
        const read = store.refresh({ immediate: true, force: true }); await tick();
        await store.invalidate({ uncertain: true });
        delayed.resolve([{ id: "secret", is_read: false }]); await read;
        assert.deepEqual(store.getRows(), []); await refresh(store); assert.equal(reads, 1);
        await assert.rejects(store.setRead("secret", true), { name: "AbortError" });
    } finally { store.dispose(); }
});

test("confirmed security revision refreshes even hidden, without reusing other assignments", async () => {
    let reads = 0;
    const first = createSessionNotifications({ ...options, canRun: () => false, client: { list: async () => { reads++; return [{ id: "first" }]; } } });
    const second = createSessionNotifications({ ...options, client: { list: async () => [{ id: "second" }] } });
    try {
        await first.invalidate(); await refresh(second);
        assert.equal(reads, 1); assert.deepEqual(first.getRows(), [{ id: "first" }]); assert.deepEqual(second.getRows(), [{ id: "second" }]);
    } finally { first.dispose(); second.dispose(); }
});

test("disposal ignores an in-flight old-context response", async () => {
    const delayed = deferred(); const published = [];
    const store = createSessionNotifications({ ...options, onChange: rows => published.push(rows), client: { list: () => delayed.promise } });
    const read = refresh(store); const handled = assert.rejects(read, { name: "AbortError" }); await tick();
    store.dispose(); delayed.resolve([{ id: "old" }]); await handled;
    assert.deepEqual(store.getRows(), []); assert.deepEqual(published, []);
});


test("browser history restores only modules authorized in the current department", () => {
    const navigation = [{id: "home"}, {id: "drive"}, {id: "docs"}];
    const target = {context: "employee-a:department-1", module: "drive", index: 2};
    assert.equal(historyModule(target, target.context, navigation), "drive");
    assert.equal(historyModule({...target, module: "profile"}, target.context, navigation), "profile");
    assert.equal(historyModule({...target, module: "administration"}, target.context, navigation), null);
    assert.equal(historyModule(target, "employee-b:department-1", navigation), null);
    assert.equal(historyModule({...target, index: undefined}, target.context, navigation), null);
    assert.equal(historyModule(null, target.context, navigation), null);
});


test("nested task modules work through sidebar, restored session and browser history", () => {
    const navigation = [{id: "home", default: true}, {id: "tasks"}];
    for (const module of ["projects", "department_projects", "workspaces", "schedules"]) {
        assert.equal(isShellModuleAllowed(module, navigation), true);
        assert.equal(entranceModule(navigation, module), module);
        assert.equal(historyModule({context: "employee", module, index: 1}, "employee", navigation), module);
        assert.equal(isShellModuleAllowed(module, [{id: "home"}]), false);
    }
    assert.equal(isShellModuleAllowed("administration", navigation), false);
    assert.equal(isShellModuleAllowed("unknown", navigation), false);
});


test("clearing notifications confirms server cleanup and refreshes without clearing another session", async () => {
    let current = [{id: "first", is_read: false}], cleared = 0;
    const store = createSessionNotifications({...options, client: {
        list: async () => current,
        request: async path => {assert.equal(path, "/api/v2/notifications/clear/"); cleared++; current = []; return {updated: 1};},
    }});
    try {await refresh(store); await store.clear(); assert.equal(cleared, 1); assert.deepEqual(store.getRows(), []);}
    finally {store.dispose();}
});
