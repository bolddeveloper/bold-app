import test from "node:test";
import assert from "node:assert/strict";
import { createPermissionCache } from "../../core/permission_cache.js";
import { createCoreApi } from "../../core/core_api.js";

const query = (overrides = {}) => ({
    assignmentId: "assignment-1",
    permissionCode: "tasks.task.read",
    unitId: "unit-1",
    resourceId: "task-1",
    ...overrides
});

test("permission cache deduplicates concurrent checks and keeps a decision until its TTL expires", async () => {
    let now = 1_000, calls = 0, release;
    const authorize = () => {
        calls++;
        return new Promise(resolve => { release = resolve; });
    };
    const cache = createPermissionCache({ authorize, ttlMs: 5_000, now: () => now });

    const first = cache.can(query());
    const second = cache.can(query());
    assert.equal(calls, 1);
    release({ allowed: true, policy_revision: 7 });
    assert.deepEqual(await Promise.all([first, second]), [true, true]);

    now = 5_999;
    assert.equal(await cache.can(query()), true);
    assert.equal(calls, 1);

    now = 6_000;
    const refreshed = cache.can(query());
    assert.equal(calls, 2);
    release({ allowed: false, policy_revision: 7 });
    assert.equal(await refreshed, false);
});

test("permission cache keys decisions by assignment, permission, unit and resource", async () => {
    const calls = [];
    const cache = createPermissionCache({
        authorize: async value => {
            calls.push(value);
            return { allowed: true, policy_revision: 1 };
        }
    });

    await cache.can(query());
    await cache.can(query({ assignmentId: "assignment-2" }));
    await cache.can(query({ permissionCode: "tasks.task.update" }));
    await cache.can(query({ unitId: "unit-2" }));
    await cache.can(query({ resourceId: "task-2" }));
    await cache.can(query());

    assert.equal(calls.length, 5);
});

test("a changed policy revision invalidates every cached decision, while the same revision does not", async () => {
    let calls = 0;
    const cache = createPermissionCache({
        authorize: async () => ({ allowed: ++calls === 1, policy_revision: 10 })
    });

    assert.equal(await cache.can(query()), true);
    assert.equal(cache.setRevision(10), false);
    assert.equal(await cache.can(query()), true);
    assert.equal(calls, 1);

    assert.equal(cache.setRevision(11), true);
    assert.equal(await cache.can(query()), false);
    assert.equal(calls, 2);
});

test("failed checks are evicted so a temporary error cannot poison authorization", async () => {
    let calls = 0;
    const cache = createPermissionCache({
        authorize: async () => {
            calls++;
            if (calls === 1) throw new Error("temporary failure");
            return { allowed: true, policy_revision: 2 };
        }
    });

    await assert.rejects(cache.can(query()), /temporary failure/);
    assert.equal(await cache.can(query()), true);
    assert.equal(calls, 2);
});

test("a late response from an invalidated generation never overwrites the fresh decision", async () => {
    const pending = [];
    const cache = createPermissionCache({ authorize: () => new Promise(resolve => pending.push(resolve)) });

    const stale = cache.can(query());
    cache.setRevision(2);
    const fresh = cache.can(query());
    assert.equal(pending.length, 2);

    pending[1]({ allowed: false, policy_revision: 2 });
    assert.equal(await fresh, false);
    pending[0]({ allowed: true, policy_revision: 1 });
    await stale;

    assert.equal(await cache.can(query()), false);
    assert.equal(pending.length, 2);
});

test("clear removes decisions when the session or active assignment changes", async () => {
    let calls = 0;
    const cache = createPermissionCache({ authorize: async () => ({ allowed: true, policy_revision: 3, request: ++calls }) });

    await cache.can(query());
    cache.clear();
    await cache.can(query());
    assert.equal(calls, 2);
});

test("core API exposes the global permission-policy revision endpoint", async () => {
    const calls = [];
    const client = {
        request: async (path, options) => {
            calls.push({ path, options });
            return { revision: 42 };
        },
        list: async () => []
    };

    const result = await createCoreApi(client).getPermissionRevision();
    assert.deepEqual(result, { revision: 42 });
    assert.deepEqual(calls, [{ path: "/api/v2/permissions/revision/", options: undefined }]);
});
