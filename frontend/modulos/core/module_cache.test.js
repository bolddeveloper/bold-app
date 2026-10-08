import test from "node:test";
import assert from "node:assert/strict";
import {createModuleCache, moduleScope} from "./module_cache.js";

function storage() {
    const rows = new Map();
    return {get length() {return rows.size;}, key: i => [...rows.keys()][i], getItem: key => rows.get(key) ?? null,
        setItem: (key, value) => rows.set(key, value), removeItem: key => rows.delete(key)};
}
test("views survive a new cache instance and remain isolated by account and assignment", () => {
    const store = storage(), cache = createModuleCache(() => store);
    const scope = moduleScope({account: {id: "alice"}, activeAssignment: {id: "it"}});
    cache.write(scope, "tasks", {tasks: [{id: "private"}]});
    const restored = createModuleCache(() => store);
    assert.deepEqual(restored.read(scope, "tasks"), {tasks: [{id: "private"}]});
    assert.equal(restored.read("bob:it", "tasks"), null);
    assert.equal(restored.read("alice:sales", "tasks"), null);
    assert.equal(restored.read("", "tasks"), null);
});
test("logout retains views but stops old writes; permission invalidation removes them", () => {
    const store = storage(), cache = createModuleCache(() => store), generation = cache.generation;
    cache.write("alice:it", "tasks", [1]); cache.suspend();
    cache.write("alice:it", "tasks", [2], generation);
    assert.deepEqual(cache.read("alice:it", "tasks"), [1]);
    cache.invalidate("alice:it");
    cache.write("alice:it", "tasks", [3], generation);
    assert.equal(cache.read("alice:it", "tasks"), null);
});
test("invalidate a resource without deleting other modules and reject oversized views", () => {
    const store = storage(), saved = createModuleCache(() => store);
    saved.write("alice:it", "tasks", [1]); saved.write("alice:it", "suggestions:mine", [2]);
    saved.invalidate("alice:it", "suggestions:");
    assert.deepEqual(saved.read("alice:it", "tasks"), [1]);
    assert.equal(saved.read("alice:it", "suggestions:mine"), null);
    saved.write("alice:it", "huge", "x".repeat(3 * 1024 * 1024));
    assert.equal(saved.read("alice:it", "huge"), null);
});
test("a corrupt browser entry does not prevent saving other views", () => {
    const store = storage(), cache = createModuleCache(() => store);
    store.setItem("bold-module-view:v1:alice:it:broken", "{");
    assert.equal(cache.read("alice:it", "broken"), null);
    cache.write("alice:it", "profile", {name: "Alice"});
    assert.deepEqual(cache.read("alice:it", "profile"), {name: "Alice"});
});
